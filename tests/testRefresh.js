// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { CATEGORIES } from '../src/models/prItem.js';

// Exercise the real controller with only Shell actors and keyring access
// substituted. The model, filters, token sync and transition logic stay real.
const root = Gio.File.new_for_path(GLib.get_current_dir());
const directory = Gio.File.new_for_path(GLib.dir_make_tmp('pr-refresh-XXXXXX'));
const fixture = directory.get_child('fixture.js');
const controller = directory.get_child('extension.js');
let passed = 0;
let failed = 0;
function assert(condition, name) {
    if (condition) {
        console.log(`  ✓ PASS: ${name}`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${name}`);
        failed++;
    }
}

try {
    fixture.replace_contents(`
export const notifications = [];
export function notify(...args) { notifications.push(args); }
export class Extension {}
export class Indicator {}
export async function loadToken() { return 'fixture-token'; }
`, null, false, Gio.FileCreateFlags.NONE, null);
    const [, bytes] = root.get_child('extension.js').load_contents(null);
    const substitutions = new Set([
        'resource:///org/gnome/shell/ui/main.js',
        'resource:///org/gnome/shell/extensions/extension.js',
        './src/ui/indicator.js',
        './src/api/keyring.js',
    ]);
    const source = new TextDecoder().decode(bytes).replace(/from '([^']+)'/g, (match, specifier) => {
        if (substitutions.has(specifier)) return `from '${fixture.get_uri()}'`;
        if (specifier.startsWith('./')) return `from '${root.resolve_relative_path(specifier).get_uri()}'`;
        return match;
    });
    controller.replace_contents(source, null, false, Gio.FileCreateFlags.NONE, null);
    const { default: Extension } = await import(controller.get_uri());
    const { notifications } = await import(fixture.get_uri());
    const extension = new Extension();
    let response;
    extension._githubClient = { setToken() {}, fetchAllPRs: async () => response };
    extension._settings = {
        get_string: () => '{}',
        set_string() {},
        get_boolean: key => key === 'notify-on-transition' || key === 'include-assigned-prs',
    };
    extension._repoFilter = { matches: () => true, updateSettings() {} };
    extension._viewerLogin = 'alice';
    extension._lastCategories = null;
    extension._refreshErrors = [];
    extension._indicator = {
        updateCounts() {},
        menuView: { setLoading() {}, setUsername() {}, setLastUpdated() {}, showError() {} },
    };
    const node = decision => ({
        id: 'PR_1', number: 1, title: 'Fixture', repository: { nameWithOwner: 'test/repo' },
        author: { login: 'alice' }, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
        reviewDecision: decision, reviewThreads: { nodes: [] },
    });
    const result = (decision, errors = []) => ({
        data: { viewer: { login: 'alice' }, authored: { nodes: [node(decision)] } }, errors,
    });
    response = result('CHANGES_REQUESTED');
    await extension.refreshData();
    const baseline = extension._lastCategories;
    assert(baseline.get('PR_1') === CATEGORIES.ACTION_REQUIRED, 'Complete refresh records its transition baseline');
    response = result(null, [{ message: 'Assigned list unavailable' }]);
    await extension.refreshData();
    assert(notifications.length === 0, 'Partial refresh does not notify a false category change');
    assert(extension._lastCategories === baseline, 'Partial refresh preserves the complete transition baseline');
    extension._onFilterSettingsChanged();
    assert(extension._lastCategories === baseline && notifications.length === 0,
        'Re-filtering partial cached data cannot alter the notification baseline');
    response = result('APPROVED');
    await extension.refreshData();
    assert(notifications.length === 1 && notifications[0][1].includes('was Action Required'),
        'Recovery compares with the last complete refresh, not the partial display');
} finally {
    controller.delete(null);
    fixture.delete(null);
    directory.delete(null);
}
console.log(`Refresh Tests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
