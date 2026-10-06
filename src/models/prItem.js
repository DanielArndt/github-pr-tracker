// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

export const CATEGORIES = {
    ACTION_REQUIRED: 'ACTION_REQUIRED',
    NEEDS_MY_REVIEW: 'NEEDS_MY_REVIEW',
    READY_TO_MERGE: 'READY_TO_MERGE',
    PENDING_CHECKS: 'PENDING_CHECKS',
    WAITING_REVIEW: 'WAITING_REVIEW',
    DRAFT: 'DRAFT',
    SNOOZED: 'SNOOZED',
    DISMISSED: 'DISMISSED',
};

export const CATEGORY_METADATA = {
    [CATEGORIES.ACTION_REQUIRED]: {
        id: CATEGORIES.ACTION_REQUIRED,
        title: 'Action Required',
        symbol: '⚠️',
        iconName: 'dialog-warning-symbolic',
        defaultExpanded: true,
    },
    [CATEGORIES.NEEDS_MY_REVIEW]: {
        id: CATEGORIES.NEEDS_MY_REVIEW,
        title: 'Needs My Review',
        symbol: '💬',
        iconName: 'user-available-symbolic',
        defaultExpanded: true,
    },
    [CATEGORIES.READY_TO_MERGE]: {
        id: CATEGORIES.READY_TO_MERGE,
        title: 'Ready to Merge',
        symbol: '✓',
        iconName: 'emblem-default-symbolic',
        defaultExpanded: true,
    },
    [CATEGORIES.PENDING_CHECKS]: {
        id: CATEGORIES.PENDING_CHECKS,
        title: 'Pending Checks',
        symbol: '⚙️',
        iconName: 'system-run-symbolic',
        defaultExpanded: true,
    },
    [CATEGORIES.WAITING_REVIEW]: {
        id: CATEGORIES.WAITING_REVIEW,
        title: 'Waiting on Review',
        symbol: '⏳',
        iconName: 'preferences-system-time-symbolic',
        defaultExpanded: true,
    },
    [CATEGORIES.DRAFT]: {
        id: CATEGORIES.DRAFT,
        title: 'Draft PRs',
        symbol: '📝',
        iconName: 'document-edit-symbolic',
        defaultExpanded: true,
    },
    [CATEGORIES.SNOOZED]: {
        id: CATEGORIES.SNOOZED,
        title: 'Snoozed',
        symbol: '💤',
        iconName: 'alarm-symbolic',
        defaultExpanded: false,
    },
    [CATEGORIES.DISMISSED]: {
        id: CATEGORIES.DISMISSED,
        title: 'Dismissed',
        symbol: '🚫',
        iconName: 'view-conceal-symbolic',
        defaultExpanded: false,
    },
};

const FAILING_CHECK_RUN_CONCLUSIONS = ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'];
const PASSING_CHECK_RUN_CONCLUSIONS = ['SUCCESS', 'NEUTRAL'];
const FAILING_STATUS_STATES = ['FAILURE', 'ERROR'];
const FAILING_ROLLUP_STATES = ['FAILURE', 'ERROR'];

/**
 * Name of a check as used in branch protection's required contexts.
 * @param {Object} ctx CheckRun or StatusContext node
 * @returns {string}
 */
function contextName(ctx) {
    return ctx.name || ctx.context;
}

/**
 * @param {Object} ctx CheckRun or StatusContext node
 * @returns {boolean} whether the check finished unsuccessfully
 */
function isContextFailing(ctx) {
    switch (ctx.__typename) {
    case 'CheckRun':
        return FAILING_CHECK_RUN_CONCLUSIONS.includes(ctx.conclusion);
    case 'StatusContext':
        return FAILING_STATUS_STATES.includes(ctx.state);
    default:
        return false;
    }
}

/**
 * @param {Object} ctx CheckRun or StatusContext node
 * @returns {boolean} whether the check finished successfully
 */
function isContextPassing(ctx) {
    switch (ctx.__typename) {
    case 'CheckRun':
        return PASSING_CHECK_RUN_CONCLUSIONS.includes(ctx.conclusion);
    case 'StatusContext':
        return ctx.state === 'SUCCESS';
    default:
        return true;
    }
}

/**
 * Extracts the status check data used by the classifier.
 * @param {Object} rawNode
 * @returns {{rollup: Object|null, checkSuites: Array<Object>, contexts: Array<Object>, required: Array<string>}}
 */
function getCheckData(rawNode) {
    const rollup = rawNode?.statusCheckRollup || null;
    const commitNode = rawNode?.commits?.nodes?.[0]?.commit;
    const checkSuites = (commitNode?.checkSuites?.nodes || []).filter(Boolean);
    return {
        rollup,
        checkSuites,
        // Nodes can be null in partial GraphQL responses
        contexts: (rollup?.contexts?.nodes || []).filter(Boolean),
        required: rawNode?.baseRef?.branchProtectionRule?.requiredStatusCheckContexts || [],
    };
}

/**
 * Checks if any check suite or check run requires manual workflow approval.
 * @param {Object} rawNode
 * @returns {boolean}
 */
function isAwaitingWorkflowApproval(rawNode) {
    const { checkSuites, contexts } = getCheckData(rawNode);
    const hasAwaitingSuite = checkSuites.some(
        s => s.conclusion === 'ACTION_REQUIRED' || s.status === 'WAITING'
    );
    const hasAwaitingContext = contexts.some(
        ctx => ctx.__typename === 'CheckRun' && (ctx.conclusion === 'ACTION_REQUIRED' || ctx.status === 'WAITING')
    );
    return hasAwaitingSuite || hasAwaitingContext;
}

/**
 * Checks if a PR has failing required checks.
 * @param {Object} rawNode
 * @returns {boolean}
 */
function hasFailingRequiredChecks(rawNode) {
    const { rollup, contexts, required } = getCheckData(rawNode);
    if (!rollup) {
        return false;
    }

    // 1. Branch protection lists the required checks
    if (required.length > 0) {
        return contexts.some(ctx => required.includes(contextName(ctx)) && isContextFailing(ctx));
    }

    // 2. Without branch protection info, BLOCKED with a failing rollup means
    //    required checks (or reviews) are blocking the merge
    return rawNode.mergeStateStatus === 'BLOCKED' &&
        FAILING_ROLLUP_STATES.includes(rollup.state) &&
        contexts.some(isContextFailing);
}

/**
 * Checks if all required checks are completed and passing.
 * @param {Object} rawNode
 * @returns {boolean}
 */
function areRequiredChecksPassing(rawNode) {
    if (isAwaitingWorkflowApproval(rawNode)) {
        return false;
    }

    const { rollup, checkSuites, contexts, required } = getCheckData(rawNode);
    if (!rollup || rollup.state === 'SUCCESS') {
        if (!rollup && checkSuites.length > 0) {
            return false;
        }
        return true;
    }

    if (rawNode.mergeStateStatus === 'CLEAN' || rawNode.mergeStateStatus === 'HAS_HOOKS') {
        return true;
    }

    // Every required check must have reported and passed
    if (required.length > 0) {
        return required.every(name => {
            const ctx = contexts.find(c => contextName(c) === name);
            return !!ctx && isContextPassing(ctx);
        });
    }

    // UNSTABLE means mergeable with non-passing commit status (i.e. only optional checks failed)
    return rawNode.mergeStateStatus === 'UNSTABLE';
}

/**
 * Model representing a parsed Pull Request.
 */
export class PRItem {
    /**
     * @param {Object} rawNode GraphQL PullRequest node
     * @param {string} viewerLogin Login of authenticated user
     * @param {Object} [options]
     * @param {boolean} [options.includeTeamReviews=false]
     * @param {boolean} [options.includeAssignedPRs=true]
     */
    constructor(rawNode, viewerLogin, options = {}) {
        this.id = rawNode.id;
        this.number = rawNode.number;
        this.title = rawNode.title || '';
        this.url = rawNode.url;
        this.isDraft = !!rawNode.isDraft;
        this.mergeable = rawNode.mergeable || 'UNKNOWN';
        this.mergeStateStatus = rawNode.mergeStateStatus || 'UNKNOWN';
        this.reviewDecision = rawNode.reviewDecision || null;
        this.updatedAt = rawNode.updatedAt ? new Date(rawNode.updatedAt) : new Date();

        this.repoName = rawNode.repository?.nameWithOwner || '';
        this.isArchived = !!rawNode.repository?.isArchived;
        this.isFork = !!rawNode.repository?.isFork;

        this.author = rawNode.author?.login || 'unknown';

        this.isAuthoredByViewer = this.author.toLowerCase() === (viewerLogin || '').toLowerCase();

        this.reasons = [];
        this.category = this._classify(rawNode, viewerLogin, options);
    }

    /**
     * Classifies the PR into one of the 5 categories and computes reason tags.
     * @param {Object} rawNode
     * @param {string} viewerLogin
     * @param {Object} [options]
     * @param {boolean} [options.includeTeamReviews=false]
     * @param {boolean} [options.includeAssignedPRs=true]
     * @returns {string|null} Category ID or null if excluded
     */
    _classify(rawNode, viewerLogin, options = {}) {
        const viewerLower = (viewerLogin || '').toLowerCase();
        const reviewThreads = rawNode.reviewThreads?.nodes || [];
        const latestReviews = rawNode.latestReviews?.nodes || [];
        const reviewRequests = rawNode.reviewRequests?.nodes || [];
        const assignees = rawNode.assignees?.nodes || [];

        const isAssignedToViewer = assignees.some(
            a => a?.login?.toLowerCase() === viewerLower
        );
        const directReviewRequested = reviewRequests.some(
            r => r.requestedReviewer?.login?.toLowerCase() === viewerLower
        );
        const includeAssignedPRs = options.includeAssignedPRs ?? options.includeAssigned ?? true;

        // Once assigned to user, always treat as user's own PR (taking ownership, not a reviewer)
        const isOwned = this.isAuthoredByViewer || (includeAssignedPRs && isAssignedToViewer);

        // 1. User's Own PRs (or Assigned PRs where user takes ownership)
        if (isOwned) {
            // Strictly Drafts
            if (this.isDraft) {
                this.reasons.push('Draft');
                if (!this.isAuthoredByViewer) {
                    this.reasons.push('Assigned');
                }
                return CATEGORIES.DRAFT;
            }

            const actionReasons = [];

            // A. Requested Changes
            const hasChangesRequestedReview = latestReviews.some(
                r => r.state === 'CHANGES_REQUESTED' && r.author?.login?.toLowerCase() !== viewerLower
            );
            if (this.reviewDecision === 'CHANGES_REQUESTED' || hasChangesRequestedReview) {
                actionReasons.push('Changes Requested');
            }

            // B. Required CI Check Failure
            if (hasFailingRequiredChecks(rawNode)) {
                actionReasons.push('CI Failed');
            }

            // C. Merge Conflicts
            if (this.mergeable === 'CONFLICTING') {
                actionReasons.push('Conflicts');
            }

            // D. Unresolved Review Conversations
            const hasUnresolvedComments = reviewThreads.some(t => t.isResolved === false);
            if (hasUnresolvedComments) {
                actionReasons.push('Unresolved Comments');
            }

            if (actionReasons.length > 0) {
                if (!this.isAuthoredByViewer) {
                    actionReasons.push('Assigned');
                }
                this.reasons = actionReasons;
                return CATEGORIES.ACTION_REQUIRED;
            }

            // E. Ready to Merge
            const isApproved = this.reviewDecision === 'APPROVED';
            const canMerge = this.mergeable !== 'CONFLICTING';
            const ciPassing = areRequiredChecksPassing(rawNode);

            if (isApproved && canMerge && ciPassing && !hasUnresolvedComments) {
                this.reasons = ['Approved'];
                if (!this.isAuthoredByViewer) {
                    this.reasons.push('Assigned');
                }
                return CATEGORIES.READY_TO_MERGE;
            }

            // F. Pending Checks (Review complete/approved, but checks not yet passing)
            if (isApproved) {
                const pendingReasons = ['Approved'];
                if (isAwaitingWorkflowApproval(rawNode)) {
                    pendingReasons.push('Awaiting Workflow Approval');
                }
                if (!this.isAuthoredByViewer) {
                    pendingReasons.push('Assigned');
                }
                this.reasons = pendingReasons;
                return CATEGORIES.PENDING_CHECKS;
            }

            // G. Waiting on Review
            const waitingReasons = ['Awaiting Review'];

            if (isAwaitingWorkflowApproval(rawNode)) {
                waitingReasons.push('Awaiting Workflow Approval');
            }

            if (!this.isAuthoredByViewer) {
                waitingReasons.push('Assigned');
            }

            this.reasons = waitingReasons;
            return CATEGORIES.WAITING_REVIEW;
        }

        // 2. PRs From Others
        const previouslyReviewed = latestReviews.some(
            r => r.author?.login?.toLowerCase() === viewerLower
        );

        if (directReviewRequested) {
            if (previouslyReviewed) {
                this.reasons.push('Awaiting Re-review');
            } else {
                this.reasons.push('Review Requested');
            }
            return CATEGORIES.NEEDS_MY_REVIEW;
        }

        // If already reviewed and direct review was not re-requested, do not display
        if (previouslyReviewed) {
            return null;
        }

        const includeTeamReviews = options.includeTeamReviews ?? false;
        if (includeTeamReviews) {
            this.reasons.push('Team Review');
            return CATEGORIES.NEEDS_MY_REVIEW;
        }

        // Not directly requested, not previously reviewed, and team reviews disabled
        return null;
    }
}
