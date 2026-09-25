// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

export const CATEGORIES = {
    ACTION_REQUIRED: 'action_required',
    NEEDS_MY_REVIEW: 'needs_my_review',
    READY_TO_MERGE: 'ready_to_merge',
    WAITING_REVIEW: 'waiting_review',
    DRAFT: 'draft',
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
        iconName: 'emblem-ok-symbolic',
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
 * Checks if a commit rollup has failing required checks.
 * @param {Object} commitNode
 * @returns {boolean}
 */
function hasFailingRequiredChecks(commitNode) {
    if (!commitNode || !commitNode.statusCheckRollup) {
        return false;
    }

    const contexts = commitNode.statusCheckRollup.contexts?.nodes || [];
    for (const ctx of contexts) {
        if (!ctx.isRequired) {
            continue;
        }

        // For CheckRun
        if (ctx.__typename === 'CheckRun') {
            const badConclusions = ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'];
            if (badConclusions.includes(ctx.conclusion)) {
                return true;
            }
        }

        // For StatusContext
        if (ctx.__typename === 'StatusContext') {
            const badStates = ['FAILURE', 'ERROR'];
            if (badStates.includes(ctx.state)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Checks if all required checks are completed and passing.
 * @param {Object} commitNode
 * @returns {boolean}
 */
function areRequiredChecksPassing(commitNode) {
    if (!commitNode || !commitNode.statusCheckRollup) {
        return true;
    }

    const rollupState = commitNode.statusCheckRollup.state;
    if (rollupState === 'FAILURE' || rollupState === 'ERROR') {
        return false;
    }

    const contexts = commitNode.statusCheckRollup.contexts?.nodes || [];
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

/**
 * Model representing a parsed Pull Request.
 */
export class PRItem {
    /**
     * @param {Object} rawNode GraphQL PullRequest node
     * @param {string} viewerLogin Login of authenticated user
     */
    constructor(rawNode, viewerLogin) {
        this.id = rawNode.id;
        this.number = rawNode.number;
        this.title = rawNode.title || '';
        this.url = rawNode.url;
        this.isDraft = !!rawNode.isDraft;
        this.mergeable = rawNode.mergeable || 'UNKNOWN';
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
        this.category = this._classify(rawNode, viewerLogin);
    }

    /**
     * Classifies the PR into one of the 5 categories and computes reason tags.
     * @param {Object} rawNode
     * @param {string} viewerLogin
     * @returns {string} Category ID
     */
    _classify(rawNode, viewerLogin) {
        const viewerLower = (viewerLogin || '').toLowerCase();
        const latestCommit = rawNode.commits?.nodes?.[0]?.commit || null;
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
            if (hasFailingRequiredChecks(latestCommit)) {
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
            const ciPassing = areRequiredChecksPassing(latestCommit);

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

        // Fallback if returned in search
        this.reasons.push('Review Needed');
        return CATEGORIES.NEEDS_MY_REVIEW;
    }
}
