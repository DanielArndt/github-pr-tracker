// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import GLib from 'gi://GLib';
GLib.setenv('GSETTINGS_BACKEND', 'memory', true);

import { PRItem, CATEGORIES } from '../src/models/prItem.js';
import {
    getPRKey,
    isPRDismissed,
    recordDismissal,
    removeDismissal,
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

console.log('--- Testing Dismiss Tracker ---');

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

// 2. recordDismissal and isPRDismissed
{
    const pr = new PRItem(makePR({ id: 'PR_100', updatedAt: '2026-09-25T10:00:00.000Z' }), viewer);
    const map = {};

    assert(!isPRDismissed(pr, map), 'Initially not dismissed');

    recordDismissal(pr, map);
    assertEqual(map['PR_100'], '2026-09-25T10:00:00.000Z', 'Dismissal recorded with updatedAt ISO string');
    assert(isPRDismissed(pr, map), 'Recognized as dismissed when updatedAt matches dismissal timestamp');
}

// 3. removeDismissal (Undo)
{
    const pr = new PRItem(makePR({ id: 'PR_100' }), viewer);
    const map = { 'PR_100': '2026-09-25T10:00:00.000Z' };

    assert(isPRDismissed(pr, map), 'Dismissed before undo');
    removeDismissal(pr, map);
    assert(!isPRDismissed(pr, map), 'No longer dismissed after removeDismissal');
    assertEqual(map['PR_100'], undefined, 'Key removed from map');
}

// 4. Update detection: PR updated after dismissal is no longer dismissed
{
    const map = { 'PR_100': '2026-09-25T10:00:00.000Z' };

    const prSame = new PRItem(makePR({ id: 'PR_100', updatedAt: '2026-09-25T10:00:00.000Z' }), viewer);
    assert(isPRDismissed(prSame, map), 'Same timestamp remains dismissed');

    const prOlder = new PRItem(makePR({ id: 'PR_100', updatedAt: '2026-09-25T09:00:00.000Z' }), viewer);
    assert(isPRDismissed(prOlder, map), 'Older timestamp remains dismissed');

    const prNewer = new PRItem(makePR({ id: 'PR_100', updatedAt: '2026-09-25T11:00:00.000Z' }), viewer);
    assert(!isPRDismissed(prNewer, map), 'Newer timestamp (updated PR) is NOT dismissed');
}

// 5. categorizeAndPruneDismissed
{
    const pr1 = new PRItem(makePR({ id: 'PR_1', reviewDecision: 'CHANGES_REQUESTED', updatedAt: '2026-09-25T10:00:00.000Z' }), viewer);
    const pr2 = new PRItem(makePR({ id: 'PR_2', reviewDecision: 'APPROVED', updatedAt: '2026-09-25T12:00:00.000Z' }), viewer);
    const pr3 = new PRItem(makePR({ id: 'PR_3', isDraft: true, updatedAt: '2026-09-25T08:00:00.000Z' }), viewer);

    // pr1 is dismissed at exact timestamp
    // pr2 was dismissed at earlier timestamp (now updated)
    // pr3 is not dismissed
    const dismissedMap = {
        'PR_1': '2026-09-25T10:00:00.000Z',
        'PR_2': '2026-09-25T11:00:00.000Z', // older than pr2 updatedAt (12:00)
    };

    const { categorizedMap, mapChanged } = categorizeAndPruneDismissed([pr1, pr2, pr3], dismissedMap);

    assert(mapChanged, 'mapChanged is true because PR_2 was updated and pruned');
    assertEqual(dismissedMap['PR_2'], undefined, 'PR_2 pruned from dismissedMap');
    assertEqual(dismissedMap['PR_1'], '2026-09-25T10:00:00.000Z', 'PR_1 preserved in dismissedMap');

    // Check categories
    const dismissedList = categorizedMap.get(CATEGORIES.DISMISSED);
    assertEqual(dismissedList.length, 1, 'One item in DISMISSED category');
    assertEqual(dismissedList[0].id, 'PR_1', 'PR_1 placed in DISMISSED category');

    const actionList = categorizedMap.get(CATEGORIES.ACTION_REQUIRED);
    assertEqual(actionList.length, 0, 'PR_1 not in ACTION_REQUIRED');

    const mergeList = categorizedMap.get(CATEGORIES.READY_TO_MERGE);
    assertEqual(mergeList.length, 1, 'PR_2 placed in READY_TO_MERGE (restored on update)');
    assertEqual(mergeList[0].id, 'PR_2', 'PR_2 is in READY_TO_MERGE');

    const draftList = categorizedMap.get(CATEGORIES.DRAFT);
    assertEqual(draftList.length, 1, 'PR_3 placed in DRAFT');
}

// 5b. Pruning dismissals of PRs that are no longer fetched
{
    const dismissedMap = {
        'PR_open': '2026-09-01T00:00:00.000Z',
        'PR_merged': '2026-08-01T00:00:00.000Z',
        'PR_closed': '2026-07-01T00:00:00.000Z',
    };
    const changed = pruneMissingDismissals(dismissedMap, new Set(['PR_open', 'PR_other']));
    assert(changed, 'Reports change when entries are pruned');
    assertEqual(Object.keys(dismissedMap), ['PR_open'], 'Keeps only dismissals of fetched PRs');

    const unchanged = pruneMissingDismissals(dismissedMap, new Set(['PR_open']));
    assert(!unchanged, 'Reports no change when all dismissed PRs were fetched');
    assertEqual(Object.keys(dismissedMap), ['PR_open'], 'Leaves map intact when nothing is missing');

    const empty = {};
    assert(!pruneMissingDismissals(empty, new Set()), 'Empty map is left unchanged');
    assert(!pruneMissingDismissals(null, new Set()), 'Null map is ignored');
}

// 6. GSettings schema key roundtrip test
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
    const defaultVal = settings.get_string('dismissed-prs');
    assertEqual(defaultVal, '{}', 'Default dismissed-prs is "{}"');

    const testMap = { 'PR_test': '2026-09-28T10:00:00.000Z' };
    settings.set_string('dismissed-prs', JSON.stringify(testMap));
    const readVal = JSON.parse(settings.get_string('dismissed-prs'));
    assertEqual(readVal, testMap, 'dismissed-prs roundtrips via GSettings');

    // Reset back to empty
    settings.reset('dismissed-prs');
}

console.log(`\nDismiss Tests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
    throw new Error(`${failed} test(s) failed`);
}
