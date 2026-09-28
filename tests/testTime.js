// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import { formatRelativeTime } from '../src/utils/time.js';

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, testName) {
    if (actual === expected) {
        console.log(`  ✓ PASS: ${testName}`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${testName}\n    Expected: ${expected}\n    Actual:   ${actual}`);
        failed++;
    }
}

console.log('--- Testing Relative Time Formatting ---');

const now = Date.parse('2026-09-28T12:00:00Z');
const ago = seconds => new Date(now - seconds * 1000);

assertEqual(formatRelativeTime(null, now), '', 'Missing date formats as empty string');
assertEqual(formatRelativeTime(new Date('invalid'), now), '', 'Invalid date formats as empty string');
assertEqual(formatRelativeTime(ago(0), now), 'just now', '0s is "just now"');
assertEqual(formatRelativeTime(ago(59), now), 'just now', '59s is "just now"');
assertEqual(formatRelativeTime(ago(60), now), '1m ago', '60s is "1m ago"');
assertEqual(formatRelativeTime(ago(20 * 60), now), '20m ago', '20 minutes');
assertEqual(formatRelativeTime(ago(90 * 60), now), '1h ago', '90 minutes rounds down to hours');
assertEqual(formatRelativeTime(ago(3 * 86400), now), '3d ago', '3 days');
assertEqual(formatRelativeTime(ago(65 * 86400), now), '2mo ago', '65 days is 2 months');

// The same timestamp reads differently as time passes, which is why the
// footer label is recomputed each time the menu opens.
const fetchedAt = ago(0);
assertEqual(formatRelativeTime(fetchedAt, now), 'just now', 'Fresh fetch reads "just now"');
assertEqual(formatRelativeTime(fetchedAt, now + 20 * 60 * 1000), '20m ago', 'Same fetch reads "20m ago" later');

console.log(`\nTime Tests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
    throw new Error(`${failed} test(s) failed`);
}
