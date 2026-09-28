// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

/**
 * @typedef {Object} CollectedPRNodes
 * @property {Array<Object>} nodes unique PullRequest nodes (authored and review-requested)
 * @property {boolean} truncated whether GitHub had more results than were fetched
 */

/**
 * Collects the unique PR nodes from a FETCH_ALL_PRS_QUERY response.
 *
 * A PR can appear in both the authored list and the review-requested search;
 * the later occurrence wins. Null nodes (possible in partial responses) are
 * skipped.
 * @param {Object} data GraphQL `data` object
 * @returns {CollectedPRNodes}
 */
export function collectPRNodes(data) {
    const authored = data?.viewer?.pullRequests;
    const requested = data?.reviewRequested;

    const byId = new Map();
    for (const connection of [authored, requested]) {
        for (const node of connection?.nodes || []) {
            if (node && node.id) byId.set(node.id, node);
        }
    }

    const truncated = !!authored?.pageInfo?.hasNextPage || !!requested?.pageInfo?.hasNextPage;

    return { nodes: Array.from(byId.values()), truncated };
}
