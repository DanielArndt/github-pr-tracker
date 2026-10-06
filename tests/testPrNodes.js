// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import { collectPRNodes } from '../src/models/prNodes.js';

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

function response({ authored = [], requested = [], assigned = [], authoredMore = false, requestedMore = false, assignedMore = false } = {}) {
    return {
        viewer: {
            login: 'alice',
        },
        authored: { pageInfo: { hasNextPage: authoredMore }, nodes: authored },
        reviewRequested: { pageInfo: { hasNextPage: requestedMore }, nodes: requested },
        assigned: { pageInfo: { hasNextPage: assignedMore }, nodes: assigned },
    };
}

console.log('--- Testing PR Node Collection ---');

{
    const { nodes, truncated } = collectPRNodes(response({
        authored: [{ id: 'A', propA: 1, v: 1 }, { id: 'B' }],
        requested: [{ id: 'C' }, { id: 'A', propB: 2, v: 2 }],
        assigned: [{ id: 'D' }, { id: 'A', propC: 3, v: 3 }],
    }));
    assertEqual(nodes.map(n => n.id), ['A', 'B', 'C', 'D'], 'Merges authored, review-requested, and assigned PRs without duplicates');
    assert(nodes[0].v === 3, 'Later occurrence of a duplicate PR wins for overlapping fields');
    assert(nodes[0].propA === 1 && nodes[0].propB === 2 && nodes[0].propC === 3, 'Merges properties across all occurrences');
    assert(!truncated, 'Not truncated when neither list has more pages');
}

{
    const { nodes } = collectPRNodes(response({
        authored: [null, { id: 'A' }, {}],
        requested: [{}, null],
        assigned: [null, {}],
    }));
    assertEqual(nodes.map(n => n.id), ['A'], 'Skips null nodes and non-PR search results');
}

{
    assert(collectPRNodes(response({ authoredMore: true })).truncated, 'Truncated when authored PRs have more pages');
    assert(collectPRNodes(response({ requestedMore: true })).truncated, 'Truncated when review requests have more pages');
    assert(collectPRNodes(response({ assignedMore: true })).truncated, 'Truncated when assigned PRs have more pages');
}

{
    const { nodes, truncated } = collectPRNodes({ viewer: null, reviewRequested: null });
    assert(nodes.length === 0 && !truncated, 'Handles null connections from partial responses');
    assert(collectPRNodes(undefined).nodes.length === 0, 'Handles missing data');
}

{
    const legacyResponse = {
        viewer: {
            login: 'alice',
            pullRequests: { pageInfo: { hasNextPage: true }, nodes: [{ id: 'LEGACY' }] },
        },
    };
    const { nodes, truncated } = collectPRNodes(legacyResponse);
    assertEqual(nodes.map(n => n.id), ['LEGACY'], 'Supports legacy viewer.pullRequests fallback');
    assert(truncated, 'Truncated when legacy viewer.pullRequests has more pages');
}

console.log(`\nPR Node Tests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
    throw new Error(`${failed} test(s) failed`);
}
