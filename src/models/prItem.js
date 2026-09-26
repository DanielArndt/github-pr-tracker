// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

export const CATEGORIES = {
    ACTION_REQUIRED: 'ACTION_REQUIRED',
    NEEDS_MY_REVIEW: 'NEEDS_MY_REVIEW',
    READY_TO_MERGE: 'READY_TO_MERGE',
    WAITING_REVIEW: 'WAITING_REVIEW',
    DRAFT: 'DRAFT',
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
    [CATEGORIES.WAITING_REVIEW]: {
        id: CATEGORIES.WAITING_REVIEW,
        title: 'Waiting on Review',
        symbol: '⏳',
        iconName: 'alarm-symbolic',
        defaultExpanded: false,
    },
    [CATEGORIES.DRAFT]: {
        id: CATEGORIES.DRAFT,
        title: 'Draft PRs',
        symbol: '📝',
        iconName: 'document-edit-symbolic',
        defaultExpanded: false,
    },
};

/**
 * Checks if a PR has failing required checks.
 * @param {Object} rawNode
 * @returns {boolean}
 */
function hasFailingRequiredChecks(rawNode) {
    if (!rawNode) return false;

    const statusRollup = rawNode.statusCheckRollup || rawNode.commits?.nodes?.[0]?.commit?.statusCheckRollup;
    if (!statusRollup) {
        return false;
    }

    const contexts = statusRollup.contexts?.nodes || [];
    const requiredContexts = rawNode.baseRef?.branchProtectionRule?.requiredStatusCheckContexts || [];

    // 1. If branch protection specifies required check contexts
    if (requiredContexts.length > 0) {
        for (const ctx of contexts) {
            const name = ctx.name || ctx.context;
            if (requiredContexts.includes(name)) {
                if (ctx.__typename === 'CheckRun') {
                    const badConclusions = ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'];
                    if (badConclusions.includes(ctx.conclusion)) {
                        return true;
                    }
                }
                if (ctx.__typename === 'StatusContext') {
                    const badStates = ['FAILURE', 'ERROR'];
                    if (badStates.includes(ctx.state)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    // 2. Explicit isRequired property (from unit test mocks or specific queries)
    const hasExplicitIsRequired = contexts.some(c => c.isRequired !== undefined);
    if (hasExplicitIsRequired) {
        for (const ctx of contexts) {
            if (ctx.isRequired) {
                if (ctx.__typename === 'CheckRun') {
                    const badConclusions = ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'];
                    if (badConclusions.includes(ctx.conclusion)) {
                        return true;
                    }
                }
                if (ctx.__typename === 'StatusContext') {
                    const badStates = ['FAILURE', 'ERROR'];
                    if (badStates.includes(ctx.state)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    // 3. GitHub mergeStateStatus: BLOCKED indicates required status checks or reviews are blocking merge
    if (rawNode.mergeStateStatus === 'BLOCKED' && (statusRollup.state === 'FAILURE' || statusRollup.state === 'ERROR')) {
        for (const ctx of contexts) {
            if (ctx.__typename === 'CheckRun' && ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'].includes(ctx.conclusion)) {
                return true;
            }
            if (ctx.__typename === 'StatusContext' && ['FAILURE', 'ERROR'].includes(ctx.state)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Checks if all required checks are completed and passing.
 * @param {Object} rawNode
 * @returns {boolean}
 */
function areRequiredChecksPassing(rawNode) {
    if (!rawNode) return true;

    const statusRollup = rawNode.statusCheckRollup || rawNode.commits?.nodes?.[0]?.commit?.statusCheckRollup;
    if (!statusRollup) {
        return true;
    }

    if (statusRollup.state === 'SUCCESS') {
        return true;
    }

    if (rawNode.mergeStateStatus === 'CLEAN' || rawNode.mergeStateStatus === 'HAS_HOOKS') {
        return true;
    }

    const contexts = statusRollup.contexts?.nodes || [];
    const requiredContexts = rawNode.baseRef?.branchProtectionRule?.requiredStatusCheckContexts || [];

    if (requiredContexts.length > 0) {
        for (const reqName of requiredContexts) {
            const ctx = contexts.find(c => (c.name || c.context) === reqName);
            if (!ctx) {
                return false;
            }
            if (ctx.__typename === 'CheckRun' && ctx.conclusion !== 'SUCCESS' && ctx.conclusion !== 'NEUTRAL') {
                return false;
            }
            if (ctx.__typename === 'StatusContext' && ctx.state !== 'SUCCESS') {
                return false;
            }
        }
        return true;
    }

    const hasExplicitIsRequired = contexts.some(c => c.isRequired !== undefined);
    if (hasExplicitIsRequired) {
        for (const ctx of contexts) {
            if (ctx.isRequired) {
                if (ctx.__typename === 'CheckRun' && ctx.conclusion !== 'SUCCESS' && ctx.conclusion !== 'NEUTRAL') {
                    return false;
                }
                if (ctx.__typename === 'StatusContext' && ctx.state !== 'SUCCESS') {
                    return false;
                }
            }
        }
        return true;
    }

    // UNSTABLE means mergeable with non-passing commit status (i.e. only optional checks failed)
    if (rawNode.mergeStateStatus === 'UNSTABLE') {
        return true;
    }

    return false;
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
        this.createdAt = rawNode.createdAt ? new Date(rawNode.createdAt) : new Date();

        this.repoName = rawNode.repository?.nameWithOwner || '';
        this.isArchived = !!rawNode.repository?.isArchived;
        this.isFork = !!rawNode.repository?.isFork;

        this.author = rawNode.author?.login || 'unknown';
        this.authorAvatarUrl = rawNode.author?.avatarUrl || null;

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
     * @returns {string|null} Category ID or null if excluded
     */
    _classify(rawNode, viewerLogin, options = {}) {
        const viewerLower = (viewerLogin || '').toLowerCase();
        const reviewThreads = rawNode.reviewThreads?.nodes || [];
        const latestReviews = rawNode.latestReviews?.nodes || [];
        const reviewRequests = rawNode.reviewRequests?.nodes || [];

        // 1. User's Own PRs
        if (this.isAuthoredByViewer) {
            // Strictly Drafts
            if (this.isDraft) {
                this.reasons.push('Draft');
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
                this.reasons = actionReasons;
                return CATEGORIES.ACTION_REQUIRED;
            }

            // E. Ready to Merge
            const isApproved = this.reviewDecision === 'APPROVED';
            const canMerge = this.mergeable !== 'CONFLICTING';
            const ciPassing = areRequiredChecksPassing(rawNode);

            if (isApproved && canMerge && ciPassing && !hasUnresolvedComments) {
                this.reasons = ['Approved'];
                return CATEGORIES.READY_TO_MERGE;
            }

            // F. Waiting on Review
            this.reasons = ['Awaiting Review'];
            return CATEGORIES.WAITING_REVIEW;
        }

        // 2. PRs From Others
        const directReviewRequested = reviewRequests.some(
            r => r.requestedReviewer?.login?.toLowerCase() === viewerLower
        );

        const previouslyReviewed = latestReviews.some(
            r => r.author?.login?.toLowerCase() === viewerLower
        );

        if (directReviewRequested) {
            this.reasons.push('Review Requested');
            return CATEGORIES.NEEDS_MY_REVIEW;
        }

        if (previouslyReviewed) {
            this.reasons.push('Awaiting Re-review');
            return CATEGORIES.NEEDS_MY_REVIEW;
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
