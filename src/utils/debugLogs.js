// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';

/**
 * Redacts tokens, keys, and credentials from log text.
 * @param {string} text
 * @returns {string} sanitized log text
 */
export function sanitizeLogContent(text) {
    if (!text) {
        return '';
    }

    return text
        .replace(/gh[pousr]_[A-Za-z0-9_]{20,}/g, '[REDACTED_GITHUB_TOKEN]')
        .replace(/github_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED_GITHUB_TOKEN]')
        .replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED_TOKEN]')
        .replace(/((?:access_token|token|password|secret)=)[^\s&]+/gi, '$1[REDACTED]');
}

/**
 * Retrieves diagnostic logs from the systemd journal for this extension.
 * Output is guaranteed to have sensitive credentials redacted.
 *
 * @param {Object} [metadata] extension metadata containing uuid and version
 * @returns {Promise<string>}
 */
export async function getDebugLogs(metadata = {}) {
    const timestamp = new Date().toISOString();
    const uuid = metadata?.uuid || 'github-pr-tracker@dan.arndt.ca';
    const version = metadata?.version ?? 'unknown';

    const header = [
        '=== GitHub PR Tracker Debug Logs ===',
        `Timestamp: ${timestamp}`,
        `UUID: ${uuid}`,
        `Version: ${version}`,
        '====================================',
        '',
    ].join('\n');

    try {
        const proc = new Gio.Subprocess({
            argv: [
                'journalctl',
                '--user',
                '-b',
                '-g',
                'GitHub PR Tracker|github-pr-tracker',
                '--no-pager',
            ],
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        proc.init(null);

        const [, stdout] = await new Promise((resolve, reject) => {
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    resolve(p.communicate_utf8_finish(res));
                } catch (err) {
                    reject(err);
                }
            });
        });

        const raw = (stdout || '').trim();
        const logs = (!raw || raw === '-- No entries --')
            ? 'No matching log entries found in the current boot journal.'
            : sanitizeLogContent(raw);

        return `${header}${logs}\n`;
    } catch (err) {
        return `${header}Failed to retrieve logs from journalctl: ${err.message}\n`;
    }
}
