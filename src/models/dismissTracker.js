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
 * Checks whether a PR is snoozed and has not had any subsequent updates.
 * @param {import('./prItem.js').PRItem} prItem
 * @param {Record<string, string>} snoozedMap
 * @returns {boolean}
 */
export function isPRSnoozed(prItem, snoozedMap) {
    if (!prItem || !snoozedMap) return false;
    const key = getPRKey(prItem);
    const snoozedAtStr = snoozedMap[key];
    if (!snoozedAtStr) return false;

    const snoozedAt = new Date(snoozedAtStr).getTime();
    const prUpdatedAt = prItem.updatedAt instanceof Date
        ? prItem.updatedAt.getTime()
        : new Date(prItem.updatedAt).getTime();

    // The PR remains snoozed only while its updatedAt is <= the snooze timestamp
    return prUpdatedAt <= snoozedAt;
}

/**
 * Marks a PR as snoozed at its current updatedAt timestamp.
 * @param {import('./prItem.js').PRItem} prItem
 * @param {Record<string, string>} snoozedMap
 * @returns {Record<string, string>}
 */
export function recordSnooze(prItem, snoozedMap) {
    if (!prItem || !snoozedMap) return snoozedMap;
    const key = getPRKey(prItem);
    const prUpdatedAt = prItem.updatedAt instanceof Date
        ? prItem.updatedAt
        : new Date(prItem.updatedAt);

    snoozedMap[key] = prUpdatedAt.toISOString();
    return snoozedMap;
}

/**
 * Restores a snoozed PR by removing its entry from snoozedMap.
 * @param {import('./prItem.js').PRItem} prItem
 * @param {Record<string, string>} snoozedMap
 * @returns {Record<string, string>}
 */
export function removeSnooze(prItem, snoozedMap) {
    if (!prItem || !snoozedMap) return snoozedMap;
    const key = getPRKey(prItem);
    delete snoozedMap[key];
    return snoozedMap;
}

/**
 * Checks whether a PR is permanently dismissed.
 * @param {import('./prItem.js').PRItem} prItem
 * @param {Record<string, any>} dismissedMap
 * @returns {boolean}
 */
export function isPRDismissed(prItem, dismissedMap) {
    if (!prItem || !dismissedMap) return false;
    const key = getPRKey(prItem);
    return !!dismissedMap[key];
}

/**
 * Marks a PR as permanently dismissed.
 * @param {import('./prItem.js').PRItem} prItem
 * @param {Record<string, any>} dismissedMap
 * @returns {Record<string, any>}
 */
export function recordDismissal(prItem, dismissedMap) {
    if (!prItem || !dismissedMap) return dismissedMap;
    const key = getPRKey(prItem);
    dismissedMap[key] = true;
    return dismissedMap;
}

/**
 * Restores a dismissed PR by removing its entry from dismissedMap.
 * @param {import('./prItem.js').PRItem} prItem
 * @param {Record<string, any>} dismissedMap
 * @returns {Record<string, any>}
 */
export function removeDismissal(prItem, dismissedMap) {
    if (!prItem || !dismissedMap) return dismissedMap;
    const key = getPRKey(prItem);
    delete dismissedMap[key];
    return dismissedMap;
}

/**
 * Removes entries for PRs that are no longer open or awaiting the user,
 * e.g. merged or closed PRs, which would otherwise stay in GSettings forever.
 *
 * Only call this with the keys from a complete, error-free fetch: a PR
 * missing because of truncation or a partial error must keep its entry.
 * Repository filters must not be applied to `fetchedKeys` either, so that
 * changing a filter does not forget dismissals or snoozes.
 *
 * @param {Record<string, any>} map
 * @param {Set<string>} fetchedKeys PR keys (see getPRKey) of every fetched PR
 * @returns {boolean} whether any entry was removed
 */
export function pruneMissingKeys(map, fetchedKeys) {
    if (!map || !fetchedKeys) return false;
    let changed = false;
    for (const key of Object.keys(map)) {
        if (!fetchedKeys.has(key)) {
            delete map[key];
            changed = true;
        }
    }
    return changed;
}

/**
 * Alias for pruneMissingKeys for backward compatibility.
 * @param {Record<string, any>} dismissedMap
 * @param {Set<string>} fetchedKeys
 * @returns {boolean}
 */
export function pruneMissingDismissals(dismissedMap, fetchedKeys) {
    return pruneMissingKeys(dismissedMap, fetchedKeys);
}

/**
 * Categorizes filtered PR items into active categories, SNOOZED, or DISMISSED,
 * and prunes snoozed items that received subsequent updates.
 *
 * @param {Array<import('./prItem.js').PRItem>} prItems
 * @param {Record<string, string>} snoozedMap
 * @param {Record<string, any>} dismissedMap
 * @returns {{ categorizedMap: Map<string, Array<import('./prItem.js').PRItem>>, snoozedChanged: boolean, dismissedChanged: boolean, mapChanged: boolean }}
 */
export function categorizeAndPruneDismissed(prItems, snoozedMap = {}, dismissedMap = {}) {
    let snoozedChanged = false;
    const dismissedChanged = false;

    const categorizedMap = new Map();
    for (const catId of Object.values(CATEGORIES)) {
        categorizedMap.set(catId, []);
    }

    for (const item of prItems) {
        if (!item || !item.category) continue;

        const key = getPRKey(item);

        // 1. Permanent dismissal takes precedence
        if (key && isPRDismissed(item, dismissedMap)) {
            categorizedMap.get(CATEGORIES.DISMISSED).push(item);
            if (snoozedMap && snoozedMap[key]) {
                delete snoozedMap[key];
                snoozedChanged = true;
            }
            continue;
        }

        // 2. Snooze check (temporary until update)
        if (key && snoozedMap && snoozedMap[key]) {
            if (isPRSnoozed(item, snoozedMap)) {
                categorizedMap.get(CATEGORIES.SNOOZED).push(item);
                continue;
            } else {
                // Item has been updated since snooze: un-snooze and prune entry
                delete snoozedMap[key];
                snoozedChanged = true;
            }
        }

        // 3. Active item: place into its regular category
        const list = categorizedMap.get(item.category);
        if (list) {
            list.push(item);
        }
    }

    // Sort items inside each category by updatedAt descending
    for (const list of categorizedMap.values()) {
        list.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    }

    return {
        categorizedMap,
        snoozedChanged,
        dismissedChanged,
        mapChanged: snoozedChanged || dismissedChanged,
    };
}
