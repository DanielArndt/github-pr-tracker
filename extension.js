// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { Indicator } from './src/ui/indicator.js';
import { GithubClient, RequestCancelledError } from './src/api/githubClient.js';
import { loadToken } from './src/api/keyring.js';
import { syncClientToken, TOKEN_CHANGED_KEY } from './src/api/tokenSync.js';
import { RepoFilter } from './src/models/repoFilter.js';
import { PRItem } from './src/models/prItem.js';
import { collectPRNodes } from './src/models/prNodes.js';
import {
    getPRKey,
    recordSnooze,
    removeSnooze,
    recordDismissal,
    removeDismissal,
    pruneMissingKeys,
    categorizeAndPruneDismissed,
} from './src/models/dismissTracker.js';

export default class GitHubPRExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._rawNodes = [];
        this._rawPRItems = [];
        this._viewerLogin = this._settings.get_string('last-username') || '';

        this._repoFilter = new RepoFilter({
            includeStr: this._settings.get_string('include-repos'),
            excludeStr: this._settings.get_string('exclude-repos'),
            ignoreArchived: this._settings.get_boolean('ignore-archived'),
            ignoreForks: this._settings.get_boolean('ignore-forks'),
        });

        this._githubClient = new GithubClient();

        this._indicator = new Indicator(
            this,
            () => this.refreshData(),
            {
                onSnooze: (pr) => this.snoozePR(pr),
                onDismiss: (pr) => this.dismissPR(pr),
                onRestore: (pr) => this.restorePR(pr),
                onUndo: (pr) => this.restorePR(pr),
            }
        );
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        if (this._viewerLogin) {
            this._indicator.menuView.setUsername(this._viewerLogin);
        }

        this._settingsChangedIds = [
            this._settings.connect('changed::refresh-interval', () => this._startTimer()),
            this._settings.connect('changed::include-repos', () => this._onFilterSettingsChanged()),
            this._settings.connect('changed::exclude-repos', () => this._onFilterSettingsChanged()),
            this._settings.connect('changed::ignore-archived', () => this._onFilterSettingsChanged()),
            this._settings.connect('changed::ignore-forks', () => this._onFilterSettingsChanged()),
            this._settings.connect('changed::include-team-reviews', () => this._onFilterSettingsChanged()),
            this._settings.connect('changed::include-assigned-prs', () => this._onFilterSettingsChanged()),
            this._settings.connect(`changed::${TOKEN_CHANGED_KEY}`, () => this.refreshData()),
        ];

        // Start polling synchronously so nothing needs to run after an await
        // if the extension is disabled while the first refresh is pending.
        this._startTimer();
        this.refreshData();
    }

    disable() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = null;
        }

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
        this._repoFilter = null;
        this._rawNodes = [];
        this._rawPRItems = [];
    }

    /**
     * Drops cached PR data and clears the panel badges and menu sections.
     */
    _clearData() {
        this._rawNodes = [];
        this._rawPRItems = [];
        this._indicator.updateCounts(new Map());
        this._indicator.menuView.setLastUpdated(null);
    }

    _onFilterSettingsChanged() {
        this._repoFilter.updateSettings({
            includeStr: this._settings.get_string('include-repos'),
            excludeStr: this._settings.get_string('exclude-repos'),
            ignoreArchived: this._settings.get_boolean('ignore-archived'),
            ignoreForks: this._settings.get_boolean('ignore-forks'),
        });

        // Re-classify and re-filter cached PR items without making another network request
        if (this._rawNodes.length > 0) {
            const includeTeamReviews = this._settings.get_boolean('include-team-reviews');
            const includeAssignedPRs = this._settings.get_boolean('include-assigned-prs');
            this._rawPRItems = this._rawNodes.map(
                node => new PRItem(node, this._viewerLogin, { includeTeamReviews, includeAssignedPRs })
            );
            this._applyFilterAndDisplay(this._rawPRItems);
        }
    }

    _startTimer() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = null;
        }
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
     */
    async refreshData() {
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
            const { data, errors } = await this._githubClient.fetchAllPRs();
            if (!isCurrent()) return;

            const viewerLogin = data.viewer?.login || '';
            if (viewerLogin && viewerLogin !== this._viewerLogin) {
                this._viewerLogin = viewerLogin;
                this._settings.set_string('last-username', viewerLogin);
            }
            this._indicator.menuView.setUsername(this._viewerLogin);

            const { nodes, truncated } = collectPRNodes(data);
            this._rawNodes = nodes;
            const includeTeamReviews = this._settings.get_boolean('include-team-reviews');
            const includeAssignedPRs = this._settings.get_boolean('include-assigned-prs');
            this._rawPRItems = this._rawNodes.map(
                node => new PRItem(node, this._viewerLogin, { includeTeamReviews, includeAssignedPRs })
            );

            // Forget snoozes/dismissals of PRs that are gone (merged, closed, review
            // no longer requested), but only when nothing could be missing
            // from this response
            if (errors.length === 0 && !truncated) {
                const { snoozed, dismissed } = this._loadMaps();
                const fetchedKeys = new Set(this._rawPRItems.map(getPRKey));
                const snoozedPruned = pruneMissingKeys(snoozed, fetchedKeys);
                const dismissedPruned = pruneMissingKeys(dismissed, fetchedKeys);
                if (snoozedPruned || dismissedPruned) {
                    this._saveMaps(snoozed, dismissed);
                }
            }

            this._applyFilterAndDisplay(this._rawPRItems);
            this._indicator.menuView.setLastUpdated(new Date(), truncated);

            // Partial results: show what loaded, but flag what did not
            if (errors.length > 0) {
                for (const e of errors) {
                    console.warn('[GitHub PR Tracker] Partial GraphQL error:', e.message);
                }
                this._indicator.menuView.showError(
                    `Some pull requests could not be loaded: ${errors[0].message}`
                );
            }
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

    _loadMaps() {
        let snoozed = {};
        let dismissed = {};
        if (this._settings) {
            try {
                const sStr = this._settings.get_string('snoozed-prs');
                snoozed = sStr ? JSON.parse(sStr) : {};
            } catch (err) {
                console.error('[GitHub PR Tracker] Error parsing snoozed-prs:', err);
                snoozed = {};
            }
            try {
                const dStr = this._settings.get_string('dismissed-prs');
                dismissed = dStr ? JSON.parse(dStr) : {};
            } catch (err) {
                console.error('[GitHub PR Tracker] Error parsing dismissed-prs:', err);
                dismissed = {};
            }

            // Migration: if snoozed-prs is empty but dismissed-prs contains ISO timestamp strings
            // (the old format from previous versions which behaved as snooze), migrate them to snoozed-prs.
            if (Object.keys(snoozed).length === 0 && Object.keys(dismissed).length > 0) {
                let migrated = false;
                for (const [key, val] of Object.entries(dismissed)) {
                    if (typeof val === 'string') {
                        snoozed[key] = val;
                        delete dismissed[key];
                        migrated = true;
                    }
                }
                if (migrated) {
                    this._settings.set_string('snoozed-prs', JSON.stringify(snoozed));
                    this._settings.set_string('dismissed-prs', JSON.stringify(dismissed));
                }
            }
        }
        return { snoozed, dismissed };
    }

    _saveMaps(snoozed, dismissed) {
        if (this._settings) {
            if (snoozed !== undefined) {
                this._settings.set_string('snoozed-prs', JSON.stringify(snoozed || {}));
            }
            if (dismissed !== undefined) {
                this._settings.set_string('dismissed-prs', JSON.stringify(dismissed || {}));
            }
        }
    }

    /**
     * Snoozes a pull request until it receives a new update on GitHub.
     * @param {PRItem} prItem
     */
    snoozePR(prItem) {
        if (!prItem) return;
        const { snoozed, dismissed } = this._loadMaps();
        recordSnooze(prItem, snoozed);
        removeDismissal(prItem, dismissed);
        this._saveMaps(snoozed, dismissed);
        this._applyFilterAndDisplay(this._rawPRItems);
    }

    /**
     * Permanently dismisses a pull request.
     * @param {PRItem} prItem
     */
    dismissPR(prItem) {
        if (!prItem) return;
        const { snoozed, dismissed } = this._loadMaps();
        recordDismissal(prItem, dismissed);
        removeSnooze(prItem, snoozed);
        this._saveMaps(snoozed, dismissed);
        this._applyFilterAndDisplay(this._rawPRItems);
    }

    /**
     * Restores a snoozed or dismissed pull request back to its active category.
     * @param {PRItem} prItem
     */
    restorePR(prItem) {
        if (!prItem) return;
        const { snoozed, dismissed } = this._loadMaps();
        removeSnooze(prItem, snoozed);
        removeDismissal(prItem, dismissed);
        this._saveMaps(snoozed, dismissed);
        this._applyFilterAndDisplay(this._rawPRItems);
    }

    /**
     * Applies repository filters, handles snoozed/dismissed PRs, and distributes PRs to categories.
     * @param {Array<PRItem>} prItems
     */
    _applyFilterAndDisplay(prItems) {
        const filtered = prItems.filter(item => item && item.category && this._repoFilter.matches(item));
        const { snoozed, dismissed } = this._loadMaps();
        const { categorizedMap, snoozedChanged, dismissedChanged } = categorizeAndPruneDismissed(
            filtered,
            snoozed,
            dismissed
        );

        if (snoozedChanged || dismissedChanged) {
            this._saveMaps(snoozed, dismissed);
        }

        this._indicator.updateCounts(categorizedMap);
    }
}
