// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import * as keyring from './src/api/keyring.js';
import { notifyTokenChanged } from './src/api/tokenSync.js';
import { GithubClient, RequestCancelledError } from './src/api/githubClient.js';
import { getDebugLogs } from './src/utils/debugLogs.js';

export const GITHUB_NEW_TOKEN_URL =
    'https://github.com/settings/tokens/new?description=GitHub%20PR%20Tracker&scopes=repo';

export default class GitHubPRExtensionPreferences extends ExtensionPreferences {
    /**
     * Token storage used by the window; tests replace this to avoid touching
     * the real keyring.
     * @returns {{storeToken: Function, loadToken: Function, deleteToken: Function}}
     */
    getKeyring() {
        return keyring;
    }

    /**
     * Diagnostic logs retriever used by the window; tests replace this to avoid
     * querying the real system journal.
     * @param {Object} metadata
     * @returns {Promise<string>}
     */
    getDebugLogs(metadata) {
        return getDebugLogs(metadata);
    }

    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const { storeToken, loadToken, deleteToken } = this.getKeyring();
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
            icon_name: 'dialog-information-symbolic',
            // Subtitle shows GitHub display names and error messages verbatim
            use_markup: false,
        });

        window.connect('close-request', () => {
            client.destroy();
        });

        const testBtn = new Gtk.Button({
            label: 'Test Connection',
            valign: Gtk.Align.CENTER,
        });
        statusRow.add_suffix(testBtn);
        authGroup.add(statusRow);

        const generateTokenRow = new Adw.ActionRow({
            title: 'Generate Token',
            subtitle: 'Open GitHub to create a classic token with required scopes pre-populated',
            activatable: true,
        });

        const linkBtn = new Gtk.LinkButton({
            uri: GITHUB_NEW_TOKEN_URL,
            icon_name: 'adw-external-link-symbolic',
            valign: Gtk.Align.CENTER,
            focusable: false,
        });
        generateTokenRow.add_suffix(linkBtn);

        generateTokenRow.connect('activated', () => {
            try {
                Gio.AppInfo.launch_default_for_uri(GITHUB_NEW_TOKEN_URL, null);
            } catch (err) {
                console.error(`Failed to open token URL: ${err.message}`);
            }
        });
        authGroup.add(generateTokenRow);

        // Load token from keyring on open
        loadToken().then(token => {
            if (token) {
                tokenRow.set_text(token);
                statusRow.set_icon_name('dialog-information-symbolic');
                statusRow.set_subtitle('Token loaded from keyring. Click "Test Connection" to verify.');
            } else {
                statusRow.set_icon_name('dialog-warning-symbolic');
                statusRow.set_subtitle('No token saved. Please enter a Personal Access Token.');
            }
        }).catch(err => {
            statusRow.set_icon_name('dialog-error-symbolic');
            statusRow.set_subtitle(`Keyring error: ${err.message}`);
        });

        // Test connection helper
        const verifyCurrentToken = async (token) => {
            if (!token || token.trim().length === 0) {
                statusRow.set_icon_name('dialog-warning-symbolic');
                statusRow.set_subtitle('Please enter a valid token first.');
                return;
            }
            statusRow.set_icon_name('dialog-information-symbolic');
            statusRow.set_subtitle('Verifying token with GitHub API...');
            testBtn.set_sensitive(false);
            try {
                const user = await client.verifyToken(token);
                if (user && user.login) {
                    const nameStr = user.name ? ` (${user.name})` : '';
                    statusRow.set_icon_name('emblem-ok-symbolic');
                    statusRow.set_subtitle(`Connected as @${user.login}${nameStr}`);
                    settings.set_string('last-username', user.login);
                } else {
                    statusRow.set_icon_name('dialog-warning-symbolic');
                    statusRow.set_subtitle('Connected, but could not determine user login.');
                }
            } catch (err) {
                // Superseded by a newer verification, which will set the status.
                if (err instanceof RequestCancelledError) return;
                statusRow.set_icon_name('dialog-error-symbolic');
                statusRow.set_subtitle(`Error: ${err.message}`);
            } finally {
                testBtn.set_sensitive(true);
            }
        };

        saveBtn.connect('clicked', async () => {
            const token = tokenRow.get_text().trim();
            if (!token) {
                statusRow.set_icon_name('dialog-warning-symbolic');
                statusRow.set_subtitle('Token cannot be empty.');
                return;
            }
            saveBtn.set_sensitive(false);
            try {
                await storeToken(token);
                notifyTokenChanged(settings);
                await verifyCurrentToken(token);
            } catch (err) {
                statusRow.set_icon_name('dialog-error-symbolic');
                statusRow.set_subtitle(`Failed to store token: ${err.message}`);
            } finally {
                saveBtn.set_sensitive(true);
            }
        });

        clearBtn.connect('clicked', async () => {
            clearBtn.set_sensitive(false);
            try {
                await deleteToken();
                notifyTokenChanged(settings);
                tokenRow.set_text('');
                statusRow.set_icon_name('dialog-information-symbolic');
                statusRow.set_subtitle('Token removed from keyring.');
            } catch (err) {
                statusRow.set_icon_name('dialog-error-symbolic');
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

        const assignedPrsRow = new Adw.SwitchRow({
            title: 'Include Assigned Pull Requests',
            subtitle: 'Include pull requests assigned to you',
        });
        settings.bind('include-assigned-prs', assignedPrsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        filterGroup.add(assignedPrsRow);

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

        // --- Group 4: Troubleshooting ---
        const debugGroup = new Adw.PreferencesGroup({
            title: 'Troubleshooting',
            description: 'Export diagnostic logs to share in bug reports. Sensitive tokens and credentials are automatically redacted.',
        });
        page.add(debugGroup);

        const exportRow = new Adw.ActionRow({
            title: 'Export Logs',
            subtitle: 'Save extension log messages from the system journal to a file or clipboard',
        });

        const copyLogsBtn = new Gtk.Button({
            label: 'Copy',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Copy logs to clipboard',
        });

        const exportLogsBtn = new Gtk.Button({
            label: 'Export…',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Save logs to a file',
        });

        exportRow.add_suffix(copyLogsBtn);
        exportRow.add_suffix(exportLogsBtn);
        debugGroup.add(exportRow);

        copyLogsBtn.connect('clicked', async () => {
            copyLogsBtn.set_sensitive(false);
            exportLogsBtn.set_sensitive(false);
            try {
                const logs = await this.getDebugLogs(this.metadata);
                window.get_clipboard().set(logs);
                window.add_toast(new Adw.Toast({
                    title: 'Logs copied to clipboard',
                }));
            } catch (err) {
                window.add_toast(new Adw.Toast({
                    title: `Failed to copy logs: ${err.message}`,
                }));
            } finally {
                copyLogsBtn.set_sensitive(true);
                exportLogsBtn.set_sensitive(true);
            }
        });

        exportLogsBtn.connect('clicked', async () => {
            copyLogsBtn.set_sensitive(false);
            exportLogsBtn.set_sensitive(false);
            try {
                const logs = await this.getDebugLogs(this.metadata);
                const fileDialog = new Gtk.FileDialog({
                    title: 'Export Extension Logs',
                    initial_name: 'github-pr-tracker.log',
                });

                fileDialog.save(window, null, (dlg, res) => {
                    try {
                        const file = dlg.save_finish(res);
                        const encoder = new TextEncoder();
                        const bytes = new GLib.Bytes(encoder.encode(logs));
                        file.replace_contents_bytes_async(
                            bytes,
                            null,
                            false,
                            Gio.FileCreateFlags.REPLACE_DESTINATION,
                            null,
                            (f, writeRes) => {
                                try {
                                    f.replace_contents_finish(writeRes);
                                    window.add_toast(new Adw.Toast({
                                        title: 'Logs exported successfully',
                                    }));
                                } catch (writeErr) {
                                    window.add_toast(new Adw.Toast({
                                        title: `Failed to save file: ${writeErr.message}`,
                                    }));
                                }
                            }
                        );
                    } catch (dialogErr) {
                        if (!dialogErr.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED)) {
                            window.add_toast(new Adw.Toast({
                                title: `Failed to export logs: ${dialogErr.message}`,
                            }));
                        }
                    }
                });
            } catch (err) {
                window.add_toast(new Adw.Toast({
                    title: `Failed to export logs: ${err.message}`,
                }));
            } finally {
                copyLogsBtn.set_sensitive(true);
                exportLogsBtn.set_sensitive(true);
            }
        });
    }
}
