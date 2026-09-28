// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { Indicator } from './src/ui/indicator.js';
import { GithubClient, RequestCancelledError } from './src/api/githubClient.js';
import { loadToken } from './src/api/keyring.js';
import { syncClientToken, TOKEN_CHANGED_KEY } from './src/api/tokenSync.js';
import { RepoFilter } from './src/ui/repoFilter.js';
import { PRItem, CATEGORIES } from './src/models/prItem.js';
import {
    recordDismissal,
    removeDismissal,
    categorizeAndPruneDismissed,
} from './src/models/dismissTracker.js';

export default class GitHubPRExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._rawPRItems = [];
        this._viewerLogin = this._settings.get_string('last-username') || '';

        // Configure Repo Filter
        this._repoFilter = new RepoFilter({
            includeStr: this._settings.get_string('include-repos'),
            excludeStr: this._settings.get_string('exclude-repos'),
            ignoreArchived: this._settings.get_boolean('ignore-archived'),
            ignoreForks: this._settings.get_boolean('ignore-forks'),
        });

        // Initialize API client
        this._githubClient = new GithubClient();

        // Initialize Indicator in GNOME top panel
        this._indicator = new Indicator(
            this,
            () => this.refreshData(true),
            {
                onDismiss: (pr) => this.dismissPR(pr),
                onUndo: (pr) => this.restorePR(pr),
            }
        );
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        if (this._viewerLogin) {
            this._indicator.menuView.setUsername(this._viewerLogin);
        }

        // Connect settings change listeners
        this._settingsChangedIds = [
            this._settings.connect('changed::refresh-interval', () => this._restartTimer()),
            this._settings.connect('changed::include-repos', () => this._onFilterSettingsChanged()),
            this._settings.connect('changed::exclude-repos', () => this._onFilterSettingsChanged()),
            this._settings.connect('changed::ignore-archived', () => this._onFilterSettingsChanged()),
            this._settings.connect('changed::ignore-forks', () => this._onFilterSettingsChanged()),
            this._settings.connect('changed::include-team-reviews', () => this._onFilterSettingsChanged()),
            this._settings.connect(`changed::${TOKEN_CHANGED_KEY}`, () => this.refreshData(true)),
        ];

        // Load token from keyring and start
        this._initSession();
    }

    async _initSession() {
        await this.refreshData();
        this._startTimer();
    }

    /**
     * Drops cached PR data and clears the panel badges and menu sections.
     */
    _clearData() {
        this._rawNodes = [];
        this._rawPRItems = [];
        this._indicator.updateCounts(new Map());
    }

    _onFilterSettingsChanged() {
        this._repoFilter.updateSettings({
            includeStr: this._settings.get_string('include-repos'),
            excludeStr: this._settings.get_string('exclude-repos'),
            ignoreArchived: this._settings.get_boolean('ignore-archived'),
            ignoreForks: this._settings.get_boolean('ignore-forks'),
        });

        // Re-classify and re-filter cached PR items without making another network request
        if (this._rawNodes && this._rawNodes.length > 0) {
            const includeTeamReviews = this._settings.get_boolean('include-team-reviews');
            this._rawPRItems = this._rawNodes.map(
                node => new PRItem(node, this._viewerLogin, { includeTeamReviews })
            );
            this._applyFilterAndDisplay(this._rawPRItems);
        }
    }

    _startTimer() {
        this._stopTimer();
        const intervalMinutes = Math.max(1, this._settings.get_int('refresh-interval') || 5);
        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            intervalMinutes * 60,
            () => {
                this.refreshData();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _stopTimer() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = null;
        }
    }

    _restartTimer() {
        this._startTimer();
    }

    /**
     * Invalidates any refresh currently in flight so its results are dropped.
     * @returns {number} the new refresh generation
     */
    _bumpRefreshGeneration() {
        this._refreshGeneration = (this._refreshGeneration ?? 0) + 1;
        return this._refreshGeneration;
    }

    /**
     * Fetches fresh PR data from GitHub GraphQL API.
     *
     * Overlapping calls are allowed (timer, manual refresh, token change);
     * only the most recent one updates the UI.
     * @param {boolean} [isManual]
     */
    async refreshData(isManual = false) {
        const generation = this._bumpRefreshGeneration();
        const isCurrent = () => generation === this._refreshGeneration;

        // Always re-read the keyring so tokens saved, replaced or cleared in
        // Preferences take effect without re-enabling the extension.
        let hasToken;
        try {
            hasToken = await syncClientToken(this._githubClient, loadToken);
        } catch (err) {
            if (!isCurrent()) return;
            console.error('[GitHub PR Tracker] Keyring load error:', err);
            this._indicator.menuView.showError('Failed to access system keyring.');
            return;
        }

        if (!isCurrent()) return;

        if (!hasToken) {
            this._clearData();
            this._indicator.menuView.showTokenRequired();
            return;
        }

        this._indicator.menuView.setLoading(true);

        try {
            const data = await this._githubClient.fetchAllPRs();
            if (!isCurrent() || !data) return;

            const viewerLogin = data.viewer?.login || '';
            if (viewerLogin && viewerLogin !== this._viewerLogin) {
                this._viewerLogin = viewerLogin;
                this._settings.set_string('last-username', viewerLogin);
            }
            this._indicator.menuView.setUsername(this._viewerLogin);

            // Collect all unique PR nodes
            const rawNodesMap = new Map();

            const authoredNodes = data.viewer?.pullRequests?.nodes || [];
            for (const node of authoredNodes) {
                if (node && node.id) rawNodesMap.set(node.id, node);
            }

            const requestedNodes = data.reviewRequested?.nodes || [];
            for (const node of requestedNodes) {
                if (node && node.id) rawNodesMap.set(node.id, node);
            }

            this._rawNodes = Array.from(rawNodesMap.values());
            const includeTeamReviews = this._settings.get_boolean('include-team-reviews');
            this._rawPRItems = this._rawNodes.map(
                node => new PRItem(node, this._viewerLogin, { includeTeamReviews })
            );

            this._applyFilterAndDisplay(this._rawPRItems);
        } catch (err) {
            // A superseded or cancelled request leaves the UI to the newer one.
            if (!isCurrent() || err instanceof RequestCancelledError) return;
            console.error('[GitHub PR Tracker] Error fetching data:', err);
            this._indicator.menuView.showError(err.message || 'Error fetching data.');
        } finally {
            if (isCurrent()) {
                this._indicator.menuView.setLoading(false);
            }
        }
    }

    _loadDismissedMap() {
        try {
            const jsonStr = this._settings ? this._settings.get_string('dismissed-prs') : '{}';
            return jsonStr ? JSON.parse(jsonStr) : {};
        } catch (err) {
            console.error('[GitHub PR Tracker] Error parsing dismissed-prs:', err);
            return {};
        }
    }

    _saveDismissedMap(map) {
        try {
            if (this._settings) {
                this._settings.set_string('dismissed-prs', JSON.stringify(map || {}));
            }
        } catch (err) {
            console.error('[GitHub PR Tracker] Error saving dismissed-prs:', err);
        }
    }

    /**
     * Dismisses a pull request until it receives a new update on GitHub.
     * @param {PRItem} prItem
     */
    dismissPR(prItem) {
        if (!prItem) return;
        const dismissedMap = this._loadDismissedMap();
        recordDismissal(prItem, dismissedMap);
        this._saveDismissedMap(dismissedMap);
        this._applyFilterAndDisplay(this._rawPRItems);
    }

    /**
     * Restores a dismissed pull request back to its active category.
     * @param {PRItem} prItem
     */
    restorePR(prItem) {
        if (!prItem) return;
        const dismissedMap = this._loadDismissedMap();
        removeDismissal(prItem, dismissedMap);
        this._saveDismissedMap(dismissedMap);
        this._applyFilterAndDisplay(this._rawPRItems);
    }

    /**
     * Applies repository filters, handles dismissed PRs, and distributes PRs to categories.
     * @param {Array<PRItem>} prItems
     */
    _applyFilterAndDisplay(prItems) {
        const filtered = prItems.filter(item => item && item.category && this._repoFilter.matches(item));
        const dismissedMap = this._loadDismissedMap();
        const { categorizedMap, mapChanged } = categorizeAndPruneDismissed(filtered, dismissedMap);

        if (mapChanged) {
            this._saveDismissedMap(dismissedMap);
        }

        this._indicator.updateCounts(categorizedMap);
    }

    disable() {
        this._stopTimer();

        // Drop results of any refresh still in flight; destroying the client
        // below rejects its pending request.
        this._bumpRefreshGeneration();

        if (this._settingsChangedIds && this._settings) {
            for (const id of this._settingsChangedIds) {
                this._settings.disconnect(id);
            }
            this._settingsChangedIds = [];
        }

        if (this._githubClient) {
            this._githubClient.destroy();
            this._githubClient = null;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        this._settings = null;
        this._rawPRItems = [];
    }
}
