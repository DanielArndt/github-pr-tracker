// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { Indicator } from './src/ui/indicator.js';
import { GithubClient } from './src/api/githubClient.js';
import { loadToken } from './src/api/keyring.js';
import { RepoFilter } from './src/ui/repoFilter.js';
import { PRItem, CATEGORIES } from './src/models/prItem.js';

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
        this._indicator = new Indicator(this, () => this.refreshData(true));
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
        ];

        // Load token from keyring and start
        this._initSession();
    }

    async _initSession() {
        try {
            const token = await loadToken();
            if (token && token.trim().length > 0) {
                this._githubClient.setToken(token);
                await this.refreshData();
            } else {
                this._indicator.menuView.showTokenRequired();
            }
        } catch (err) {
            console.error('[GitHub PR Tracker] Keyring load error:', err);
            this._indicator.menuView.showError('Failed to access system keyring.');
        }

        this._startTimer();
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
     * Fetches fresh PR data from GitHub GraphQL API.
     * @param {boolean} [isManual]
     */
    async refreshData(isManual = false) {
        if (!this._githubClient || !this._githubClient.hasToken()) {
            // Check keyring again in case token was saved recently in Preferences
            try {
                const token = await loadToken();
                if (token && token.trim().length > 0) {
                    this._githubClient.setToken(token);
                } else {
                    this._indicator.menuView.showTokenRequired();
                    return;
                }
            } catch (e) {
                this._indicator.menuView.showTokenRequired();
                return;
            }
        }

        this._indicator.menuView.setLoading(true);

        try {
            const data = await this._githubClient.fetchAllPRs();
            if (!data) return;

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
            console.error('[GitHub PR Tracker] Error fetching data:', err);
            this._indicator.menuView.showError(err.message || 'Error fetching data.');
        } finally {
            this._indicator.menuView.setLoading(false);
        }
    }

    /**
     * Applies repository filters and distributes PRs to categories.
     * @param {Array<PRItem>} prItems
     */
    _applyFilterAndDisplay(prItems) {
        const filtered = prItems.filter(item => item && item.category && this._repoFilter.matches(item));

        const categorizedMap = new Map();
        for (const catId of Object.values(CATEGORIES)) {
            categorizedMap.set(catId, []);
        }

        for (const item of filtered) {
            const list = categorizedMap.get(item.category);
            if (list) {
                list.push(item);
            }
        }

        // Sort items inside each category by updatedAt descending
        for (const list of categorizedMap.values()) {
            list.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        }

        this._indicator.updateCounts(categorizedMap);
    }

    disable() {
        this._stopTimer();

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
