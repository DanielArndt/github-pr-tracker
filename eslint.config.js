// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import js from '@eslint/js';

// Globals provided by GJS and GNOME Shell (not covered by the `globals` package)
const gjsGlobals = {
    ARGV: 'readonly',
    console: 'readonly',
    global: 'readonly',
    imports: 'readonly',
    log: 'readonly',
    logError: 'readonly',
    print: 'readonly',
    printerr: 'readonly',
    TextDecoder: 'readonly',
    TextEncoder: 'readonly',
    clearInterval: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    setTimeout: 'readonly',
};

export default [
    {
        ignores: ['build/', 'node_modules/'],
    },
    js.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: gjsGlobals,
        },
        rules: {
            'eqeqeq': ['error', 'always'],
            'no-unused-vars': ['error', {
                args: 'none',
                caughtErrors: 'none',
                varsIgnorePattern: '^_',
            }],
            'no-var': 'error',
            'prefer-const': 'error',
        },
    },
];
