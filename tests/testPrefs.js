// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';

// Register GNOME Shell Extensions gresource so resource:/// imports resolve
try {
    const res = Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource');
    res._register();
} catch (e) {
    console.log('Resource already registered or not found:', e);
}

const { default: GitHubPRExtensionPreferences } = await import('../prefs.js');

const app = new Adw.Application({ application_id: 'org.gnome.test.prprefs' });

// Errors thrown inside signal handlers are only logged by GJS and do not
// affect the exit status, so record the failure and rethrow after run().
let failure = null;

app.connect('activate', () => {
    try {
        const window = new Adw.PreferencesWindow({ application: app });
        const metadata = {
            'uuid': 'github-pr-tracker@dan.arndt.ca',
            'settings-schema': 'org.gnome.shell.extensions.github-pr-tracker',
            'gettext-domain': 'github-pr-tracker',
            'path': GLib.get_current_dir(),
            'dir': Gio.File.new_for_path(GLib.get_current_dir()),
        };
        const prefs = new GitHubPRExtensionPreferences(metadata);

        const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
            './schemas',
            Gio.SettingsSchemaSource.get_default(),
            false
        );
        const schema = schemaSource.lookup('org.gnome.shell.extensions.github-pr-tracker', false);
        const settings = new Gio.Settings({ settings_schema: schema });
        prefs.getSettings = () => settings;

        prefs.fillPreferencesWindow(window);
        console.log('✓ Successfully initialized preferences window and all widget bindings!');
        app.quit();
    } catch (e) {
        console.error('✗ Error testing preferences:', e, e.stack);
        failure = e;
        app.quit();
    }
});

app.run([]);

if (failure) {
    throw failure;
}
