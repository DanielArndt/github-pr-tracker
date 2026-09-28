// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import { CATEGORIES } from './prItem.js';

/**
 * Returns a unique, stable key for a PR item.
 * @param {import('./prItem.js').PRItem} prItem
 * @returns {string}
 */
export function getPRKey(prItem) {
    if (!prItem) return '';
    return prItem.id || prItem.url || `${prItem.repoName}#${prItem.number}`;
}

/**
 * Checks whether a PR is dismissed and has not had any subsequent updates.
 * @param {import('./prItem.js').PRItem} prItem
 * @param {Record<string, string>} dismissedMap
 * @returns {boolean}
 */
export function isPRDismissed(prItem, dismissedMap) {
    if (!prItem || !dismissedMap) return false;
    const key = getPRKey(prItem);
    const dismissedAtStr = dismissedMap[key];
    if (!dismissedAtStr) return false;

    const dismissedAt = new Date(dismissedAtStr).getTime();
    const prUpdatedAt = prItem.updatedAt instanceof Date
        ? prItem.updatedAt.getTime()
        : new Date(prItem.updatedAt).getTime();

    // The PR remains dismissed only while its updatedAt is <= the dismissal timestamp
    return prUpdatedAt <= dismissedAt;
}

/**
 * Marks a PR as dismissed at its current updatedAt timestamp.
 * @param {import('./prItem.js').PRItem} prItem
 * @param {Record<string, string>} dismissedMap
 * @returns {Record<string, string>}
 */
export function recordDismissal(prItem, dismissedMap) {
    if (!prItem || !dismissedMap) return dismissedMap;
    const key = getPRKey(prItem);
    const prUpdatedAt = prItem.updatedAt instanceof Date
        ? prItem.updatedAt
        : new Date(prItem.updatedAt);

    dismissedMap[key] = prUpdatedAt.toISOString();
    return dismissedMap;
}

/**
 * Restores a dismissed PR by removing its entry from dismissedMap.
 * @param {import('./prItem.js').PRItem} prItem
 * @param {Record<string, string>} dismissedMap
 * @returns {Record<string, string>}
 */
export function removeDismissal(prItem, dismissedMap) {
    if (!prItem || !dismissedMap) return dismissedMap;
    const key = getPRKey(prItem);
    delete dismissedMap[key];
    return dismissedMap;
}

/**
 * Categorizes filtered PR items into active categories or DISMISSED,
 * and prunes dismissed items that received subsequent updates.
 *
 * @param {Array<import('./prItem.js').PRItem>} prItems
 * @param {Record<string, string>} dismissedMap
 * @returns {{ categorizedMap: Map<string, Array<import('./prItem.js').PRItem>>, mapChanged: boolean }}
 */
export function categorizeAndPruneDismissed(prItems, dismissedMap = {}) {
    let mapChanged = false;

    const categorizedMap = new Map();
    for (const catId of Object.values(CATEGORIES)) {
        categorizedMap.set(catId, []);
    }

    for (const item of prItems) {
        if (!item || !item.category) continue;

        const key = getPRKey(item);
        if (key && dismissedMap[key]) {
            if (isPRDismissed(item, dismissedMap)) {
                // Item is dismissed: place into DISMISSED category
                categorizedMap.get(CATEGORIES.DISMISSED).push(item);
                continue;
            } else {
                // Item has been updated since dismissal: un-dismiss and prune entry
                delete dismissedMap[key];
                mapChanged = true;
            }
        }

        // Active item: place into its regular category
        const list = categorizedMap.get(item.category);
        if (list) {
            list.push(item);
        }
    }

    // Sort items inside each category by updatedAt descending
    for (const list of categorizedMap.values()) {
        list.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    }

    return { categorizedMap, mapChanged };
}
