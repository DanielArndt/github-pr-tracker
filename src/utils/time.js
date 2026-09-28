// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

/**
 * Format relative time (e.g. "just now", "2h ago", "3d ago").
 * @param {Date|null} date
 * @param {number} [now] current time in milliseconds, for testing
 * @returns {string} empty string for missing or invalid dates
 */
export function formatRelativeTime(date, now = Date.now()) {
    if (!date || isNaN(date.getTime())) {
        return '';
    }
    const seconds = Math.floor((now - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
}
