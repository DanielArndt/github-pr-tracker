// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import { sanitizeLogContent, getDebugLogs } from '../src/utils/debugLogs.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✓ PASS: ${message}`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${message}`);
        failed++;
    }
}

function assertEqual(actual, expected, message) {
    if (actual === expected) {
        console.log(`  ✓ PASS: ${message}`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${message}\n    Expected: ${expected}\n    Actual:   ${actual}`);
        failed++;
    }
}

console.log('--- Testing Log Sanitization & Sensitive Data Redaction ---');

// 1. Classic Personal Access Tokens
const classicTokenSample = 'ghp_1234567890abcdefghijklmnopqrstuvwxyzAB';
const classicLog = `Failed to connect with token ${classicTokenSample} to GitHub`;
assertEqual(
    sanitizeLogContent(classicLog),
    'Failed to connect with token [REDACTED_GITHUB_TOKEN] to GitHub',
    'Redacts classic personal access tokens (ghp_)'
);

// Other GitHub token prefixes: gho, ghu, ghs, ghr
for (const prefix of ['gho', 'ghu', 'ghs', 'ghr']) {
    const prefixedToken = `${prefix}_abcdefghijklmnopqrstuvwxyz1234567890`;
    assertEqual(
        sanitizeLogContent(`Token was ${prefixedToken}`),
        'Token was [REDACTED_GITHUB_TOKEN]',
        `Redacts token with prefix ${prefix}_`
    );
}

// 2. Fine-grained Personal Access Tokens
const fineGrainedToken = 'github_pat_11ABCDEF0123456789_abcdefghijklmnopqrstuvwxyz0123456789ABC';
assertEqual(
    sanitizeLogContent(`Using fine-grained token: ${fineGrainedToken}`),
    'Using fine-grained token: [REDACTED_GITHUB_TOKEN]',
    'Redacts fine-grained tokens (github_pat_)'
);

// 3. Authorization Bearer header
assertEqual(
    sanitizeLogContent('Authorization: Bearer secret_bearer_token_value.123-abc'),
    'Authorization: Bearer [REDACTED_TOKEN]',
    'Redacts Authorization Bearer token'
);

// 4. Query parameters containing credentials
assertEqual(
    sanitizeLogContent('https://api.github.com/graphql?token=my_secret_token&other=1'),
    'https://api.github.com/graphql?token=[REDACTED]&other=1',
    'Redacts token query parameter'
);

assertEqual(
    sanitizeLogContent('Connecting with access_token=xyz12345 and password=supersecret'),
    'Connecting with access_token=[REDACTED] and password=[REDACTED]',
    'Redacts access_token and password parameters'
);

// 5. Preserving non-sensitive information
const safeLog = 'PR #42: [canonical/snapd] update dependencies (commit 8814005123456789abcdef1234567890abcdef12) by @user';
assertEqual(
    sanitizeLogContent(safeLog),
    safeLog,
    'Preserves benign PR data, commit hashes, and user handles'
);

// 6. Empty / null input handling
assertEqual(sanitizeLogContent(''), '', 'Handles empty string');
assertEqual(sanitizeLogContent(null), '', 'Handles null');
assertEqual(sanitizeLogContent(undefined), '', 'Handles undefined');

console.log('\n--- Testing Debug Logs Generator ---');

const testMetadata = {
    uuid: 'test-uuid@example.com',
    version: 42,
};

const output = await getDebugLogs(testMetadata);
assert(output.includes('=== GitHub PR Tracker Debug Logs ==='), 'Includes debug logs header');
assert(output.includes('UUID: test-uuid@example.com'), 'Includes metadata UUID in header');
assert(output.includes('Version: 42'), 'Includes metadata version in header');
assert(output.includes('Timestamp: '), 'Includes ISO timestamp in header');

// Verify that getDebugLogs sanitizes any output
assert(!output.includes('ghp_'), 'Does not contain any unredacted ghp_ tokens');
assert(!output.includes('github_pat_'), 'Does not contain any unredacted github_pat_ tokens');

console.log(`\nDebug Log Tests finished: ${passed} passed, ${failed} failed.`);

if (failed > 0) {
    throw new Error(`${failed} tests failed.`);
}
