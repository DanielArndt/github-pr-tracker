// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

/**
 * @typedef {Object} CollectedPRNodes
 * @property {Array<Object>} nodes unique PullRequest nodes (authored, review-requested, and assigned)
 * @property {boolean} truncated whether GitHub had more results than were fetched
 */

/**
 * Collects the unique PR nodes from a FETCH_ALL_PRS_QUERY response.
 *
 * A PR can appear in multiple lists (authored search, review-requested search,
 * or assigned search); properties are merged with later occurrences taking
 * precedence for overlapping keys. Null nodes (possible in partial responses)
 * are skipped.
 * @param {Object} data GraphQL `data` object
 * @returns {CollectedPRNodes}
 */
export function collectPRNodes(data) {
    const authored = data?.authored || data?.viewer?.pullRequests;
    const requested = data?.reviewRequested;
    const assigned = data?.assigned;

    const byId = new Map();
    for (const connection of [authored, requested, assigned]) {
        for (const node of connection?.nodes || []) {
            if (node && node.id) {
                const existing = byId.get(node.id);
                byId.set(node.id, existing ? { ...existing, ...node } : node);
            }
        }
    }

    const truncated = !!authored?.pageInfo?.hasNextPage ||
        !!requested?.pageInfo?.hasNextPage ||
        !!assigned?.pageInfo?.hasNextPage;

    return { nodes: Array.from(byId.values()), truncated };
}
