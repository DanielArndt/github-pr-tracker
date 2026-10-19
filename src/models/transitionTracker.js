// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import { CATEGORIES, CATEGORY_METADATA } from './prItem.js';
import { getPRKey } from './dismissTracker.js';

/** Categories set by user action; moving to or from them is never notified. */
const USER_CONTROLLED = new Set([CATEGORIES.SNOOZED, CATEGORIES.DISMISSED]);

/**
 * Records which category each PR currently sits in.
 * @param {Map<string, Array<import('./prItem.js').PRItem>>} categorizedMap
 * @returns {Map<string, string>} PR key to category id
 */
export function snapshotCategories(categorizedMap) {
    const snapshot = new Map();
    for (const [catId, items] of categorizedMap) {
        for (const item of items) {
            snapshot.set(getPRKey(item), catId);
        }
    }
    return snapshot;
}

/**
 * Finds PRs that moved between two active categories since the previous
 * snapshot. PRs that appeared or vanished, and moves caused by snoozing or
 * dismissing, are not transitions.
 * @param {Map<string, string>} previous
 * @param {Map<string, Array<import('./prItem.js').PRItem>>} categorizedMap
 * @returns {Array<{pr: import('./prItem.js').PRItem, from: string, to: string}>}
 */
export function detectTransitions(previous, categorizedMap) {
    const transitions = [];
    for (const [to, items] of categorizedMap) {
        if (USER_CONTROLLED.has(to)) continue;
        for (const pr of items) {
            const from = previous.get(getPRKey(pr));
            if (from && from !== to && !USER_CONTROLLED.has(from)) {
                transitions.push({ pr, from, to });
            }
        }
    }
    return transitions;
}

/**
 * Builds the notification text for a set of transitions.
 * @param {Array<{pr: import('./prItem.js').PRItem, from: string, to: string}>} transitions
 * @returns {{title: string, body: string}}
 */
export function describeTransitions(transitions) {
    const titleOf = id => CATEGORY_METADATA[id].title;
    if (transitions.length === 1) {
        const { pr, from, to } = transitions[0];
        return {
            title: `${pr.repoName}#${pr.number} moved to ${titleOf(to)}`,
            body: `${pr.title}\n(was ${titleOf(from)})`,
        };
    }
    const body = transitions
        .map(({ pr, to }) => `${pr.repoName}#${pr.number} → ${titleOf(to)}`)
        .join('\n');
    return { title: `${transitions.length} pull requests changed category`, body };
}
