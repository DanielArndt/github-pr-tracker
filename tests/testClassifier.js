// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import { PRItem, CATEGORIES, CATEGORY_METADATA } from '../src/models/prItem.js';
import { RepoFilter } from '../src/models/repoFilter.js';

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
        mergeStateStatus: 'CLEAN',
        baseRef: { name: 'main', branchProtectionRule: null },
        statusCheckRollup: {
            state: 'SUCCESS',
            contexts: { nodes: [] },
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

// Helpers for CI check fixtures shaped like the GraphQL query results
function checkRun(name, conclusion, status = 'COMPLETED') {
    return { __typename: 'CheckRun', name, conclusion, status };
}

function statusContext(context, state) {
    return { __typename: 'StatusContext', context, state };
}

function withChecks({ rollupState, contexts, required = null, mergeStateStatus, ...rest }) {
    return makePR({
        statusCheckRollup: { state: rollupState, contexts: { nodes: contexts } },
        baseRef: {
            name: 'main',
            branchProtectionRule: required ? { requiredStatusCheckContexts: required } : null,
        },
        mergeStateStatus,
        ...rest,
    });
}

// 3. Action Required: Failing required CI check (branch protection lists it)
{
    const pr = new PRItem(withChecks({
        rollupState: 'FAILURE',
        required: ['unit-tests'],
        mergeStateStatus: 'BLOCKED',
        contexts: [checkRun('unit-tests', 'FAILURE')],
    }), viewerLogin);
    assertEqual(pr.category, CATEGORIES.ACTION_REQUIRED, 'Failing required check categorized as ACTION_REQUIRED');
    assert(pr.reasons.includes('CI Failed'), 'Reason includes CI Failed');
}

// 3b. Failing required legacy status context
{
    const pr = new PRItem(withChecks({
        rollupState: 'ERROR',
        required: ['ci/jenkins'],
        mergeStateStatus: 'BLOCKED',
        contexts: [statusContext('ci/jenkins', 'ERROR')],
    }), viewerLogin);
    assert(pr.reasons.includes('CI Failed'), 'Erroring required status context triggers CI Failed');
}

// 3c. Required check timed out or was cancelled
{
    for (const conclusion of ['TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED']) {
        const pr = new PRItem(withChecks({
            rollupState: 'FAILURE',
            required: ['unit-tests'],
            mergeStateStatus: 'BLOCKED',
            contexts: [checkRun('unit-tests', conclusion)],
        }), viewerLogin);
        assert(pr.reasons.includes('CI Failed'), `Required check with ${conclusion} triggers CI Failed`);
    }
}

// 3d. No branch protection info (e.g. not visible to viewer): BLOCKED + failing rollup
{
    const pr = new PRItem(withChecks({
        rollupState: 'FAILURE',
        mergeStateStatus: 'BLOCKED',
        contexts: [checkRun('unit-tests', 'FAILURE')],
    }), viewerLogin);
    assert(pr.reasons.includes('CI Failed'), 'BLOCKED with failing check triggers CI Failed without protection info');
}

// 4. Failing OPTIONAL CI check should NOT trigger CI Failed
{
    const pr = new PRItem(withChecks({
        rollupState: 'FAILURE',
        required: ['unit-tests'],
        mergeStateStatus: 'UNSTABLE',
        contexts: [
            checkRun('unit-tests', 'SUCCESS'),
            checkRun('optional-linter', 'FAILURE'),
        ],
    }), viewerLogin);
    assert(!pr.reasons.includes('CI Failed'), 'Optional failing check does not trigger CI Failed');
}

// 4b. Optional failure without protection info: UNSTABLE means only optional checks failed
{
    const pr = new PRItem(withChecks({
        rollupState: 'FAILURE',
        mergeStateStatus: 'UNSTABLE',
        reviewDecision: 'APPROVED',
        contexts: [checkRun('optional-linter', 'FAILURE')],
    }), viewerLogin);
    assert(!pr.reasons.includes('CI Failed'), 'UNSTABLE optional failure does not trigger CI Failed');
    assertEqual(pr.category, CATEGORIES.READY_TO_MERGE, 'Approved PR with only optional failures is READY_TO_MERGE');
}

// 4c. Approved but a required check is still running: not ready to merge
{
    const pr = new PRItem(withChecks({
        rollupState: 'PENDING',
        required: ['unit-tests'],
        mergeStateStatus: 'BLOCKED',
        reviewDecision: 'APPROVED',
        contexts: [checkRun('unit-tests', null, 'IN_PROGRESS')],
    }), viewerLogin);
    assert(!pr.reasons.includes('CI Failed'), 'Running required check does not trigger CI Failed');
    assertEqual(pr.category, CATEGORIES.WAITING_REVIEW, 'Approved PR with running required check is not READY_TO_MERGE');
}

// 4d. Approved but a required check has not reported yet
{
    const pr = new PRItem(withChecks({
        rollupState: 'PENDING',
        required: ['unit-tests', 'integration'],
        mergeStateStatus: 'BLOCKED',
        reviewDecision: 'APPROVED',
        contexts: [checkRun('unit-tests', 'SUCCESS')],
    }), viewerLogin);
    assertEqual(pr.category, CATEGORIES.WAITING_REVIEW, 'Missing required check keeps PR out of READY_TO_MERGE');
}

// 4e. Approved with all required checks passing (neutral counts as passing)
{
    const pr = new PRItem(withChecks({
        rollupState: 'PENDING',
        required: ['unit-tests', 'ci/jenkins', 'lint'],
        mergeStateStatus: 'BLOCKED',
        reviewDecision: 'APPROVED',
        contexts: [
            checkRun('unit-tests', 'SUCCESS'),
            checkRun('lint', 'NEUTRAL'),
            statusContext('ci/jenkins', 'SUCCESS'),
            checkRun('optional-slow', null, 'IN_PROGRESS'),
        ],
    }), viewerLogin);
    assertEqual(pr.category, CATEGORIES.READY_TO_MERGE, 'Passing required checks allow READY_TO_MERGE');
}

// 4f. No checks configured at all
{
    const pr = new PRItem(makePR({
        reviewDecision: 'APPROVED',
        statusCheckRollup: null,
    }), viewerLogin);
    assertEqual(pr.category, CATEGORIES.READY_TO_MERGE, 'Approved PR without any checks is READY_TO_MERGE');
}

// 4g. Null check nodes (partial GraphQL responses) are ignored
{
    const pr = new PRItem(withChecks({
        rollupState: 'FAILURE',
        required: ['unit-tests'],
        mergeStateStatus: 'BLOCKED',
        contexts: [null, checkRun('unit-tests', 'FAILURE')],
    }), viewerLogin);
    assert(pr.reasons.includes('CI Failed'), 'Null check nodes do not break classification');
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

// 11. Previously reviewed by me without re-request: Excluded
{
    const pr = new PRItem(makePR({
        author: { login: 'bob' },
        latestReviews: {
            nodes: [{ author: { login: 'alice' }, state: 'COMMENTED' }],
        },
    }), viewerLogin);
    assertEqual(pr.category, null, 'Previously reviewed PR without re-request is excluded');
    assertEqual(pr.reasons, [], 'No reasons for excluded PR');
}

// 12. Needs My Review: Direct re-request on previously reviewed PR
{
    const pr = new PRItem(makePR({
        author: { login: 'bob' },
        reviewRequests: {
            nodes: [{ requestedReviewer: { login: 'alice' } }],
        },
        latestReviews: {
            nodes: [{ author: { login: 'alice' }, state: 'COMMENTED' }],
        },
    }), viewerLogin);
    assertEqual(pr.category, CATEGORIES.NEEDS_MY_REVIEW, 'Direct re-request categorized as NEEDS_MY_REVIEW');
    assertEqual(pr.reasons, ['Awaiting Re-review'], 'Reason is Awaiting Re-review');
}

// 13. Needs My Review: Team review request excluded by default
{
    const pr = new PRItem(makePR({
        author: { login: 'bob' },
        reviewRequests: {
            nodes: [{ requestedReviewer: { __typename: 'Team' } }],
        },
    }), viewerLogin, { includeTeamReviews: false });
    assertEqual(pr.category, null, 'Team review excluded when includeTeamReviews is false');
}

// 14. Needs My Review: Team review request included when enabled
{
    const pr = new PRItem(makePR({
        author: { login: 'bob' },
        reviewRequests: {
            nodes: [{ requestedReviewer: { __typename: 'Team' } }],
        },
    }), viewerLogin, { includeTeamReviews: true });
    assertEqual(pr.category, CATEGORIES.NEEDS_MY_REVIEW, 'Team review included when includeTeamReviews is true');
    assertEqual(pr.reasons, ['Team Review'], 'Reason is Team Review');
}

// 15. Team review request ignored if already reviewed by viewer
{
    const pr = new PRItem(makePR({
        author: { login: 'bob' },
        reviewRequests: {
            nodes: [{ requestedReviewer: { __typename: 'Team' } }],
        },
        latestReviews: {
            nodes: [{ author: { login: 'alice' }, state: 'APPROVED' }],
        },
    }), viewerLogin, { includeTeamReviews: true });
    assertEqual(pr.category, null, 'Team review excluded if already reviewed by viewer');
    assertEqual(pr.reasons, [], 'No reasons for excluded PR');
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

console.log('\n--- Testing Category Metadata & Default Expansion ---');
{
    for (const [key, meta] of Object.entries(CATEGORY_METADATA)) {
        if (key === CATEGORIES.DISMISSED) {
            assertEqual(meta.defaultExpanded, false, `${key} (${meta.title}) section should not be expanded by default`);
        } else {
            assertEqual(meta.defaultExpanded, true, `${key} (${meta.title}) section should be expanded by default`);
        }
    }
}

console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
    throw new Error(`${failed} test(s) failed`);
}
