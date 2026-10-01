// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import GLib from 'gi://GLib';
GLib.setenv('GSETTINGS_BACKEND', 'memory', true);

import { PRItem, CATEGORIES } from '../src/models/prItem.js';
import {
    getPRKey,
    isPRSnoozed,
    recordSnooze,
    removeSnooze,
    isPRDismissed,
    recordDismissal,
    removeDismissal,
    pruneMissingKeys,
    pruneMissingDismissals,
    categorizeAndPruneDismissed,
} from '../src/models/dismissTracker.js';

let passed = 0;
let failed = 0;

function assert(condition, testName) {
    if (condition) {
        console.log(`  ✓ PASS: ${testName}`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${testName}`);
        failed++;
    }
}

function assertEqual(actual, expected, testName) {
    const actualStr = JSON.stringify(actual);
    const expectedStr = JSON.stringify(expected);
    if (actualStr === expectedStr) {
        console.log(`  ✓ PASS: ${testName}`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${testName}\n    Expected: ${expectedStr}\n    Actual:   ${actualStr}`);
        failed++;
    }
}

console.log('--- Testing Dismiss & Snooze Tracker ---');

function makePR(overrides = {}) {
    return {
        id: 'PR_1',
        number: 101,
        title: 'Feature implementation',
        url: 'https://github.com/canonical/multipass/pull/101',
        isDraft: false,
        mergeable: 'MERGEABLE',
        reviewDecision: 'CHANGES_REQUESTED',
        updatedAt: '2026-09-25T10:00:00Z',
        createdAt: '2026-09-20T10:00:00Z',
        repository: {
            nameWithOwner: 'canonical/multipass',
            isArchived: false,
            isFork: false,
        },
        author: { login: 'alice' },
        reviewRequests: { nodes: [] },
        latestReviews: { nodes: [] },
        reviewThreads: { nodes: [] },
        commits: { nodes: [] },
        ...overrides,
    };
}

const viewer = 'alice';

// 1. getPRKey extraction
{
    const pr1 = new PRItem(makePR({ id: 'PR_abc', url: 'https://github.com/a/b/pull/1' }), viewer);
    assertEqual(getPRKey(pr1), 'PR_abc', 'getPRKey uses id if present');

    const prNoId = new PRItem(makePR({ id: '', url: 'https://github.com/a/b/pull/1' }), viewer);
    assertEqual(getPRKey(prNoId), 'https://github.com/a/b/pull/1', 'getPRKey falls back to url');

    const prFallback = { repoName: 'canonical/multipass', number: 42 };
    assertEqual(getPRKey(prFallback), 'canonical/multipass#42', 'getPRKey falls back to repoName#number');
}

// 2. Snooze: recordSnooze and isPRSnoozed
{
    const pr = new PRItem(makePR({ id: 'PR_100', updatedAt: '2026-09-25T10:00:00.000Z' }), viewer);
    const map = {};

    assert(!isPRSnoozed(pr, map), 'Initially not snoozed');

    recordSnooze(pr, map);
    assertEqual(map['PR_100'], '2026-09-25T10:00:00.000Z', 'Snooze recorded with updatedAt ISO string');
    assert(isPRSnoozed(pr, map), 'Recognized as snoozed when updatedAt matches snooze timestamp');
}

// 3. Snooze: removeSnooze (Undo)
{
    const pr = new PRItem(makePR({ id: 'PR_100' }), viewer);
    const map = { 'PR_100': '2026-09-25T10:00:00.000Z' };

    assert(isPRSnoozed(pr, map), 'Snoozed before undo');
    removeSnooze(pr, map);
    assert(!isPRSnoozed(pr, map), 'No longer snoozed after removeSnooze');
    assertEqual(map['PR_100'], undefined, 'Key removed from snooze map');
}

// 4. Snooze: update detection (PR updated after snooze is no longer snoozed)
{
    const map = { 'PR_100': '2026-09-25T10:00:00.000Z' };

    const prSame = new PRItem(makePR({ id: 'PR_100', updatedAt: '2026-09-25T10:00:00.000Z' }), viewer);
    assert(isPRSnoozed(prSame, map), 'Same timestamp remains snoozed');

    const prOlder = new PRItem(makePR({ id: 'PR_100', updatedAt: '2026-09-25T09:00:00.000Z' }), viewer);
    assert(isPRSnoozed(prOlder, map), 'Older timestamp remains snoozed');

    const prNewer = new PRItem(makePR({ id: 'PR_100', updatedAt: '2026-09-25T11:00:00.000Z' }), viewer);
    assert(!isPRSnoozed(prNewer, map), 'Newer timestamp (updated PR) is NOT snoozed');
}

// 5. Permanent Dismissal: recordDismissal and isPRDismissed
{
    const pr = new PRItem(makePR({ id: 'PR_200', updatedAt: '2026-09-25T10:00:00.000Z' }), viewer);
    const map = {};

    assert(!isPRDismissed(pr, map), 'Initially not dismissed');

    recordDismissal(pr, map);
    assertEqual(map['PR_200'], true, 'Permanent dismissal recorded as true');
    assert(isPRDismissed(pr, map), 'Recognized as permanently dismissed');

    // Stays dismissed even when updated to future timestamp
    const prNewer = new PRItem(makePR({ id: 'PR_200', updatedAt: '2026-09-25T15:00:00.000Z' }), viewer);
    assert(isPRDismissed(prNewer, map), 'Still dismissed even after newer update');

    removeDismissal(pr, map);
    assert(!isPRDismissed(pr, map), 'No longer dismissed after removeDismissal');
    assertEqual(map['PR_200'], undefined, 'Key removed from dismissed map');
}

// 6. categorizeAndPruneDismissed with both snoozed and dismissed PRs
{
    const pr1 = new PRItem(makePR({ id: 'PR_1', reviewDecision: 'CHANGES_REQUESTED', updatedAt: '2026-09-25T10:00:00.000Z' }), viewer);
    const pr2 = new PRItem(makePR({ id: 'PR_2', reviewDecision: 'APPROVED', updatedAt: '2026-09-25T12:00:00.000Z' }), viewer);
    const pr3 = new PRItem(makePR({ id: 'PR_3', isDraft: true, updatedAt: '2026-09-25T08:00:00.000Z' }), viewer);
    const pr4 = new PRItem(makePR({ id: 'PR_4', reviewDecision: 'CHANGES_REQUESTED', updatedAt: '2026-09-25T14:00:00.000Z' }), viewer);

    // pr1 is snoozed at exact timestamp
    // pr2 was snoozed at earlier timestamp (now updated to 12:00)
    // pr3 is active draft (neither snoozed nor dismissed)
    // pr4 is permanently dismissed (and received an update, but stays dismissed)
    const snoozedMap = {
        'PR_1': '2026-09-25T10:00:00.000Z',
        'PR_2': '2026-09-25T11:00:00.000Z',
    };
    const dismissedMap = {
        'PR_4': true,
    };

    const { categorizedMap, snoozedChanged, dismissedChanged } = categorizeAndPruneDismissed(
        [pr1, pr2, pr3, pr4],
        snoozedMap,
        dismissedMap
    );

    assert(snoozedChanged, 'snoozedChanged is true because PR_2 was updated and un-snoozed');
    assert(!dismissedChanged, 'dismissedChanged is false because PR_4 remains permanently dismissed');
    assertEqual(snoozedMap['PR_2'], undefined, 'PR_2 pruned from snoozedMap');
    assertEqual(snoozedMap['PR_1'], '2026-09-25T10:00:00.000Z', 'PR_1 preserved in snoozedMap');
    assertEqual(dismissedMap['PR_4'], true, 'PR_4 preserved in dismissedMap');

    // Check categories
    const snoozedList = categorizedMap.get(CATEGORIES.SNOOZED);
    assertEqual(snoozedList.length, 1, 'One item in SNOOZED category');
    assertEqual(snoozedList[0].id, 'PR_1', 'PR_1 placed in SNOOZED category');

    const dismissedList = categorizedMap.get(CATEGORIES.DISMISSED);
    assertEqual(dismissedList.length, 1, 'One item in DISMISSED category');
    assertEqual(dismissedList[0].id, 'PR_4', 'PR_4 placed in DISMISSED category');

    const actionList = categorizedMap.get(CATEGORIES.ACTION_REQUIRED);
    assertEqual(actionList.length, 0, 'Neither PR_1 nor PR_4 in ACTION_REQUIRED');

    const mergeList = categorizedMap.get(CATEGORIES.READY_TO_MERGE);
    assertEqual(mergeList.length, 1, 'PR_2 placed in READY_TO_MERGE (restored on update)');
    assertEqual(mergeList[0].id, 'PR_2', 'PR_2 is in READY_TO_MERGE');

    const draftList = categorizedMap.get(CATEGORIES.DRAFT);
    assertEqual(draftList.length, 1, 'PR_3 placed in DRAFT');
}

// 7. Pruning entries of PRs that are no longer fetched
{
    const map = {
        'PR_open': '2026-09-01T00:00:00.000Z',
        'PR_merged': '2026-08-01T00:00:00.000Z',
        'PR_closed': '2026-07-01T00:00:00.000Z',
    };
    const changed = pruneMissingKeys(map, new Set(['PR_open', 'PR_other']));
    assert(changed, 'Reports change when entries are pruned');
    assertEqual(Object.keys(map), ['PR_open'], 'Keeps only entries of fetched PRs');

    const unchanged = pruneMissingDismissals(map, new Set(['PR_open']));
    assert(!unchanged, 'Reports no change when all entries were fetched');
    assertEqual(Object.keys(map), ['PR_open'], 'Leaves map intact when nothing is missing');

    const empty = {};
    assert(!pruneMissingKeys(empty, new Set()), 'Empty map is left unchanged');
    assert(!pruneMissingKeys(null, new Set()), 'Null map is ignored');
}

// 8. GSettings schema keys roundtrip test (snoozed-prs and dismissed-prs)
{
    const Gio = (await import('gi://Gio')).default;
    const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
        './schemas',
        Gio.SettingsSchemaSource.get_default(),
        false
    );
    const schema = schemaSource.lookup('org.gnome.shell.extensions.github-pr-tracker', false);
    assert(schema !== null, 'Schema found in ./schemas');

    const settings = new Gio.Settings({ settings_schema: schema });

    // Test snoozed-prs
    assertEqual(settings.get_string('snoozed-prs'), '{}', 'Default snoozed-prs is "{}"');
    const snoozeTestMap = { 'PR_snooze': '2026-09-28T10:00:00.000Z' };
    settings.set_string('snoozed-prs', JSON.stringify(snoozeTestMap));
    assertEqual(JSON.parse(settings.get_string('snoozed-prs')), snoozeTestMap, 'snoozed-prs roundtrips via GSettings');
    settings.reset('snoozed-prs');

    // Test dismissed-prs
    assertEqual(settings.get_string('dismissed-prs'), '{}', 'Default dismissed-prs is "{}"');
    const dismissTestMap = { 'PR_dismiss': true };
    settings.set_string('dismissed-prs', JSON.stringify(dismissTestMap));
    assertEqual(JSON.parse(settings.get_string('dismissed-prs')), dismissTestMap, 'dismissed-prs roundtrips via GSettings');
    settings.reset('dismissed-prs');
}

console.log(`\nDismiss & Snooze Tests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
    throw new Error(`${failed} test(s) failed`);
}
