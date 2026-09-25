// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

/**
 * Helper to convert a glob pattern like 'canonical/*' into a RegExp.
 * @param {string} pattern
 * @returns {RegExp}
 */
function patternToRegex(pattern) {
    const trimmed = pattern.trim().toLowerCase();
    if (!trimmed) {
        return null;
    }
    const escaped = trimmed
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
}

export class RepoFilter {
    /**
     * @param {Object} options
     * @param {string} [options.includeStr]
     * @param {string} [options.excludeStr]
     * @param {boolean} [options.ignoreArchived]
     * @param {boolean} [options.ignoreForks]
     */
    constructor(options = {}) {
        this.updateSettings(options);
    }

    /**
     * Updates filter settings.
     * @param {Object} options
     */
    updateSettings({
        includeStr = '',
        excludeStr = '',
        ignoreArchived = true,
        ignoreForks = false,
    } = {}) {
        this._includePatterns = (includeStr || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .map(patternToRegex)
            .filter(Boolean);

        this._excludePatterns = (excludeStr || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .map(patternToRegex)
            .filter(Boolean);

        this._ignoreArchived = !!ignoreArchived;
        this._ignoreForks = !!ignoreForks;
    }

    /**
     * Determines whether a PR item passes the filter rules.
     * @param {import('../models/prItem.js').PRItem} prItem
     * @returns {boolean}
     */
    matches(prItem) {
        if (!prItem) {
            return false;
        }

        if (this._ignoreArchived && prItem.isArchived) {
            return false;
        }

        if (this._ignoreForks && prItem.isFork) {
            return false;
        }

        const repo = (prItem.repoName || '').toLowerCase();

        // If include patterns are specified, repo must match at least one
        if (this._includePatterns.length > 0) {
            const matchesInclude = this._includePatterns.some(regex => regex.test(repo));
            if (!matchesInclude) {
                return false;
            }
        }

        // If exclude patterns are specified, repo must not match any
        if (this._excludePatterns.length > 0) {
            const matchesExclude = this._excludePatterns.some(regex => regex.test(repo));
            if (matchesExclude) {
                return false;
            }
        }

        return true;
    }
}
