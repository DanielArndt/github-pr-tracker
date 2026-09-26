// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { storeToken, loadToken, deleteToken } from './src/api/keyring.js';
import { GithubClient } from './src/api/githubClient.js';

export default class GitHubPRExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const client = new GithubClient();

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-other-symbolic',
        });
        window.add(page);

        // --- Group 1: Authentication ---
        const authGroup = new Adw.PreferencesGroup({
            title: 'Authentication',
            description: 'Access token is securely stored in your GNOME Keyring.',
        });
        page.add(authGroup);

        const tokenRow = new Adw.PasswordEntryRow({
            title: 'Personal Access Token',
        });

        const saveBtn = new Gtk.Button({
            label: 'Save',
            valign: Gtk.Align.CENTER,
        });
        saveBtn.add_css_class('suggested-action');

        const clearBtn = new Gtk.Button({
            label: 'Clear',
            valign: Gtk.Align.CENTER,
        });
        clearBtn.add_css_class('destructive-action');

        tokenRow.add_suffix(saveBtn);
        tokenRow.add_suffix(clearBtn);
        authGroup.add(tokenRow);

        const statusRow = new Adw.ActionRow({
            title: 'Connection Status',
            subtitle: 'Checking keyring...',
        });

        const testBtn = new Gtk.Button({
            label: 'Test Connection',
            valign: Gtk.Align.CENTER,
        });
        statusRow.add_suffix(testBtn);
        authGroup.add(statusRow);

        // Load token from keyring on open
        loadToken().then(token => {
            if (token) {
                tokenRow.set_text(token);
                statusRow.set_subtitle('Token loaded from keyring. Click "Test Connection" to verify.');
            } else {
                statusRow.set_subtitle('No token saved. Please enter a Personal Access Token.');
            }
        }).catch(err => {
            statusRow.set_subtitle(`Keyring error: ${err.message}`);
        });

        // Test connection helper
        const verifyCurrentToken = async (token) => {
            if (!token || token.trim().length === 0) {
                statusRow.set_subtitle('Please enter a valid token first.');
                return;
            }
            statusRow.set_subtitle('Verifying token with GitHub API...');
            testBtn.set_sensitive(false);
            try {
                const user = await client.verifyToken(token);
                if (user && user.login) {
                    const nameStr = user.name ? ` (${user.name})` : '';
                    statusRow.set_subtitle(`✓ Connected as @${user.login}${nameStr}`);
                    settings.set_string('last-username', user.login);
                } else {
                    statusRow.set_subtitle('Connected, but could not determine user login.');
                }
            } catch (err) {
                statusRow.set_subtitle(`⚠️ Error: ${err.message}`);
            } finally {
                testBtn.set_sensitive(true);
            }
        };

        saveBtn.connect('clicked', async () => {
            const token = tokenRow.get_text().trim();
            if (!token) {
                statusRow.set_subtitle('Token cannot be empty.');
                return;
            }
            saveBtn.set_sensitive(false);
            try {
                await storeToken(token);
                await verifyCurrentToken(token);
            } catch (err) {
                statusRow.set_subtitle(`Failed to store token: ${err.message}`);
            } finally {
                saveBtn.set_sensitive(true);
            }
        });

        clearBtn.connect('clicked', async () => {
            clearBtn.set_sensitive(false);
            try {
                await deleteToken();
                tokenRow.set_text('');
                statusRow.set_subtitle('Token removed from keyring.');
            } catch (err) {
                statusRow.set_subtitle(`Failed to clear token: ${err.message}`);
            } finally {
                clearBtn.set_sensitive(true);
            }
        });

        testBtn.connect('clicked', () => {
            const token = tokenRow.get_text().trim();
            verifyCurrentToken(token);
        });

        // --- Group 2: Repository Filtering ---
        const filterGroup = new Adw.PreferencesGroup({
            title: 'Repository Filters',
            description: 'Optionally restrict which repositories or organizations are tracked.',
        });
        page.add(filterGroup);

        const includeRow = new Adw.EntryRow({
            title: 'Include Repositories / Orgs',
        });
        settings.bind('include-repos', includeRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        filterGroup.add(includeRow);

        const excludeRow = new Adw.EntryRow({
            title: 'Exclude Repositories',
        });
        settings.bind('exclude-repos', excludeRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        filterGroup.add(excludeRow);

        const archivedRow = new Adw.SwitchRow({
            title: 'Ignore Archived Repositories',
            subtitle: 'Exclude pull requests in read-only/archived repos',
        });
        settings.bind('ignore-archived', archivedRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        filterGroup.add(archivedRow);

        const forksRow = new Adw.SwitchRow({
            title: 'Ignore Forked Repositories',
            subtitle: 'Exclude pull requests in repository forks',
        });
        settings.bind('ignore-forks', forksRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        filterGroup.add(forksRow);

        const teamReviewsRow = new Adw.SwitchRow({
            title: 'Include Team Review Requests',
            subtitle: 'Include pull requests requested from teams you belong to, in addition to direct requests',
        });
        settings.bind('include-team-reviews', teamReviewsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        filterGroup.add(teamReviewsRow);

        // --- Group 3: Polling & Behavior ---
        const behaviorGroup = new Adw.PreferencesGroup({
            title: 'Behavior and Polling',
        });
        page.add(behaviorGroup);

        const spinAdjustment = new Gtk.Adjustment({
            lower: 1,
            upper: 60,
            step_increment: 1,
            page_increment: 5,
            value: settings.get_int('refresh-interval') || 5,
        });

        const refreshRow = new Adw.SpinRow({
            title: 'Refresh Interval (minutes)',
            subtitle: 'Time between automatic background updates',
            adjustment: spinAdjustment,
        });
        settings.bind('refresh-interval', refreshRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        behaviorGroup.add(refreshRow);
    }
}
