// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import { PRItem, CATEGORIES } from '../src/models/prItem.js';
import { RepoFilter } from '../src/ui/repoFilter.js';

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

console.log('--- Testing PR Classification & Reasons ---');

const viewerLogin = 'alice';

// Base mock PR template
function makePR(overrides = {}) {
    return {
        id: 'PR_1',
        number: 101,
        title: 'Feature implementation',
        url: 'https://github.com/org/repo/pull/101',
        isDraft: false,
        mergeable: 'MERGEABLE',
        reviewDecision: null,
        updatedAt: '2026-09-25T10:00:00Z',
        createdAt: '2026-09-20T10:00:00Z',
        repository: {
            nameWithOwner: 'canonical/multipass',
            isArchived: false,
            isFork: false,
        },
        author: {
            login: 'alice',
        },
        reviewRequests: { nodes: [] },
        latestReviews: { nodes: [] },
        reviewThreads: { nodes: [] },
        commits: {
            nodes: [{
                commit: {
                    statusCheckRollup: {
                        state: 'SUCCESS',
                        contexts: { nodes: [] },
                    },
                },
            }],
        },
        ...overrides,
    };
}

// 1. Draft PR
{
    const pr = new PRItem(makePR({ isDraft: true }), viewerLogin);
    assertEqual(pr.category, CATEGORIES.DRAFT, 'Draft PR categorized as DRAFT');
    assertEqual(pr.reasons, ['Draft'], 'Draft PR reason is Draft');
}

// 2. Action Required: Changes Requested via reviewDecision
{
    const pr = new PRItem(makePR({ reviewDecision: 'CHANGES_REQUESTED' }), viewerLogin);
    assertEqual(pr.category, CATEGORIES.ACTION_REQUIRED, 'Changes requested categorized as ACTION_REQUIRED');
    assert(pr.reasons.includes('Changes Requested'), 'Reason includes Changes Requested');
}

// 3. Action Required: Failing required CI check
{
    const pr = new PRItem(makePR({
        commits: {
            nodes: [{
                commit: {
                    statusCheckRollup: {
                        state: 'FAILURE',
                        contexts: {
                            nodes: [
                                {
                                    __typename: 'CheckRun',
                                    name: 'unit-tests',
                                    conclusion: 'FAILURE',
                                    isRequired: true,
                                },
                            ],
                        },
                    },
                },
            }],
        },
    }), viewerLogin);
    assertEqual(pr.category, CATEGORIES.ACTION_REQUIRED, 'Failing required check categorized as ACTION_REQUIRED');
    assert(pr.reasons.includes('CI Failed'), 'Reason includes CI Failed');
}

// 4. Failing OPTIONAL CI check should NOT trigger CI Failed
{
    const pr = new PRItem(makePR({
        commits: {
            nodes: [{
                commit: {
                    statusCheckRollup: {
                        state: 'FAILURE',
                        contexts: {
                            nodes: [
                                {
                                    __typename: 'CheckRun',
                                    name: 'optional-linter',
                                    conclusion: 'FAILURE',
                                    isRequired: false,
                                },
                            ],
                        },
                    },
                },
            }],
        },
    }), viewerLogin);
    assert(!pr.reasons.includes('CI Failed'), 'Optional failing check does not trigger CI Failed');
}

// 5. Action Required: Merge Conflicts
{
    const pr = new PRItem(makePR({ mergeable: 'CONFLICTING' }), viewerLogin);
    assertEqual(pr.category, CATEGORIES.ACTION_REQUIRED, 'Merge conflicts categorized as ACTION_REQUIRED');
    assert(pr.reasons.includes('Conflicts'), 'Reason includes Conflicts');
}

// 6. Action Required: Unresolved Conversations
{
    const pr = new PRItem(makePR({
        reviewThreads: {
            nodes: [
                { isResolved: false },
                { isResolved: true },
            ],
        },
    }), viewerLogin);
    assertEqual(pr.category, CATEGORIES.ACTION_REQUIRED, 'Unresolved thread categorized as ACTION_REQUIRED');
    assert(pr.reasons.includes('Unresolved Comments'), 'Reason includes Unresolved Comments');
}

// 7. Action Required: Multiple reasons simultaneously
{
    const pr = new PRItem(makePR({
        mergeable: 'CONFLICTING',
        reviewDecision: 'CHANGES_REQUESTED',
        reviewThreads: { nodes: [{ isResolved: false }] },
    }), viewerLogin);
    assertEqual(pr.category, CATEGORIES.ACTION_REQUIRED, 'Multi-reason categorized as ACTION_REQUIRED');
    assert(pr.reasons.includes('Changes Requested'), 'Multi-reason contains Changes Requested');
    assert(pr.reasons.includes('Conflicts'), 'Multi-reason contains Conflicts');
    assert(pr.reasons.includes('Unresolved Comments'), 'Multi-reason contains Unresolved Comments');
}

// 8. Ready to Merge: Approved, green CI, no conflicts
{
    const pr = new PRItem(makePR({
        reviewDecision: 'APPROVED',
        mergeable: 'MERGEABLE',
    }), viewerLogin);
    assertEqual(pr.category, CATEGORIES.READY_TO_MERGE, 'Approved PR categorized as READY_TO_MERGE');
    assertEqual(pr.reasons, ['Approved'], 'Ready to merge reason is Approved');
}

// 9. Waiting on Review
{
    const pr = new PRItem(makePR({
        reviewDecision: 'REVIEW_REQUIRED',
    }), viewerLogin);
    assertEqual(pr.category, CATEGORIES.WAITING_REVIEW, 'Pending review categorized as WAITING_REVIEW');
    assertEqual(pr.reasons, ['Awaiting Review'], 'Reason is Awaiting Review');
}

// 10. Needs My Review: Direct review request from another author
{
    const pr = new PRItem(makePR({
        author: { login: 'bob' },
        reviewRequests: {
            nodes: [{ requestedReviewer: { login: 'alice' } }],
        },
    }), viewerLogin);
    assertEqual(pr.category, CATEGORIES.NEEDS_MY_REVIEW, 'Direct review request categorized as NEEDS_MY_REVIEW');
    assertEqual(pr.reasons, ['Review Requested'], 'Reason is Review Requested');
}

// 11. Needs My Review: Previously reviewed by me
{
    const pr = new PRItem(makePR({
        author: { login: 'bob' },
        latestReviews: {
            nodes: [{ author: { login: 'alice' }, state: 'COMMENTED' }],
        },
    }), viewerLogin);
    assertEqual(pr.category, CATEGORIES.NEEDS_MY_REVIEW, 'Previously reviewed categorized as NEEDS_MY_REVIEW');
    assertEqual(pr.reasons, ['Awaiting Re-review'], 'Reason is Awaiting Re-review');
}

console.log('\n--- Testing RepoFilter ---');

// 12. Include filter
{
    const filter = new RepoFilter({ includeStr: 'canonical/*, ubuntu/kernel' });
    const pr1 = new PRItem(makePR({ repository: { nameWithOwner: 'canonical/multipass' } }), viewerLogin);
    const pr2 = new PRItem(makePR({ repository: { nameWithOwner: 'ubuntu/kernel' } }), viewerLogin);
    const pr3 = new PRItem(makePR({ repository: { nameWithOwner: 'random/other' } }), viewerLogin);
    assert(filter.matches(pr1), 'Include wildcard matched canonical/multipass');
    assert(filter.matches(pr2), 'Include exact matched ubuntu/kernel');
    assert(!filter.matches(pr3), 'Include rejected random/other');
}

// 13. Exclude filter
{
    const filter = new RepoFilter({ excludeStr: 'canonical/docs, noisy/*' });
    const pr1 = new PRItem(makePR({ repository: { nameWithOwner: 'canonical/docs' } }), viewerLogin);
    const pr2 = new PRItem(makePR({ repository: { nameWithOwner: 'noisy/bot-repo' } }), viewerLogin);
    const pr3 = new PRItem(makePR({ repository: { nameWithOwner: 'canonical/multipass' } }), viewerLogin);
    assert(!filter.matches(pr1), 'Exclude rejected canonical/docs');
    assert(!filter.matches(pr2), 'Exclude wildcard rejected noisy/bot-repo');
    assert(filter.matches(pr3), 'Allowed canonical/multipass');
}

// 14. Ignore archived and fork
{
    const filter = new RepoFilter({ ignoreArchived: true, ignoreForks: true });
    const prArchived = new PRItem(makePR({ repository: { nameWithOwner: 'canonical/old', isArchived: true } }), viewerLogin);
    const prFork = new PRItem(makePR({ repository: { nameWithOwner: 'canonical/forked', isFork: true } }), viewerLogin);
    const prNormal = new PRItem(makePR({ repository: { nameWithOwner: 'canonical/active' } }), viewerLogin);
    assert(!filter.matches(prArchived), 'Filtered out archived repo');
    assert(!filter.matches(prFork), 'Filtered out forked repo');
    assert(filter.matches(prNormal), 'Allowed active normal repo');
}

console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
    throw new Error(`${failed} test(s) failed`);
}
