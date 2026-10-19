// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import { CATEGORIES } from '../src/models/prItem.js';
import {
    snapshotCategories,
    detectTransitions,
    describeTransitions,
} from '../src/models/transitionTracker.js';

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, testName) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        console.log(`  ✓ PASS: ${testName}`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${testName}\n    Expected: ${e}\n    Actual:   ${a}`);
        failed++;
    }
}

console.log('--- Testing Category Transition Tracker ---');

const pr = (id, title = `PR ${id}`) => ({ id, number: Number(id.slice(1)), title, repoName: 'canonical/repo' });

function build(placement) {
    const map = new Map(Object.values(CATEGORIES).map(c => [c, []]));
    for (const [catId, items] of Object.entries(placement)) map.get(catId).push(...items);
    return map;
}

const a = pr('P1');
const b = pr('P2');

{
    const prev = snapshotCategories(build({ [CATEGORIES.PENDING_CHECKS]: [a] }));
    const t = detectTransitions(prev, build({ [CATEGORIES.READY_TO_MERGE]: [a] }));
    assertEqual(t.map(x => [x.pr.id, x.from, x.to]), [['P1', 'PENDING_CHECKS', 'READY_TO_MERGE']], 'detects a category change');
}
{
    const prev = snapshotCategories(build({ [CATEGORIES.DRAFT]: [a] }));
    assertEqual(detectTransitions(prev, build({ [CATEGORIES.DRAFT]: [a] })), [], 'unchanged category is not a transition');
}
{
    const prev = snapshotCategories(build({}));
    assertEqual(detectTransitions(prev, build({ [CATEGORIES.ACTION_REQUIRED]: [a] })), [], 'newly seen PR is not a transition');
}
{
    const prev = snapshotCategories(build({ [CATEGORIES.ACTION_REQUIRED]: [a] }));
    assertEqual(detectTransitions(prev, build({})), [], 'vanished PR is not a transition');
}
{
    const prev = snapshotCategories(build({ [CATEGORIES.ACTION_REQUIRED]: [a, b] }));
    assertEqual(detectTransitions(prev, build({ [CATEGORIES.SNOOZED]: [a], [CATEGORIES.DISMISSED]: [b] })), [], 'snoozing or dismissing is not notified');
}
{
    const prev = snapshotCategories(build({ [CATEGORIES.SNOOZED]: [a], [CATEGORIES.DISMISSED]: [b] }));
    assertEqual(detectTransitions(prev, build({ [CATEGORIES.WAITING_REVIEW]: [a, b] })), [], 'restoring from snooze or dismissal is not notified');
}
{
    const one = describeTransitions([{ pr: a, from: CATEGORIES.PENDING_CHECKS, to: CATEGORIES.READY_TO_MERGE }]);
    assertEqual(one, { title: 'canonical/repo#1 moved to Ready to Merge', body: 'PR P1\n(was Pending Checks)' }, 'single transition text');
    const many = describeTransitions([
        { pr: a, from: CATEGORIES.DRAFT, to: CATEGORIES.WAITING_REVIEW },
        { pr: b, from: CATEGORIES.DRAFT, to: CATEGORIES.ACTION_REQUIRED },
    ]);
    assertEqual(many.title, '2 pull requests changed category', 'grouped transition title');
}

console.log(`\nTransition Tests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
    throw new Error(`${failed} test(s) failed`);
}
