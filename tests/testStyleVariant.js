// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import { isDarkForeground } from '../src/ui/styleVariant.js';

let passed = 0;
let failed = 0;

function assert(condition, testName) {
    if (condition) {
        console.log(`  ✓ PASS: ${testName}`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${testName}`);
        failed++;
    }
}

const hex = value => ({
    red: parseInt(value.slice(1, 3), 16),
    green: parseInt(value.slice(3, 5), 16),
    blue: parseInt(value.slice(5, 7), 16),
});

console.log('--- Testing Light Background Detection ---');

// Foreground colors used by the stylesheets shipped with GNOME Shell and Yaru
assert(!isDarkForeground(hex('#ffffff')), 'White text (dark styles, high contrast) is not dark');
assert(!isDarkForeground(hex('#f0f0f0')), 'Near-white text is not dark');
assert(isDarkForeground(hex('#222226')), 'GNOME light style menu text is dark');
assert(isDarkForeground(hex('#222222')), 'Yaru light menu text is dark');
assert(isDarkForeground(hex('#000000')), 'Black text is dark');
assert(!isDarkForeground(hex('#9a9a9a')), 'Mid-light gray text is not dark');
assert(isDarkForeground(hex('#5e5e63')), 'Mid-dark gray text is dark');

console.log(`\nStyle Detection Tests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
    throw new Error(`${failed} test(s) failed`);
}
