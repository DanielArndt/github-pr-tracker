// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import Secret from 'gi://Secret';

const SCHEMA_NAME = 'org.gnome.shell.extensions.github_pr_tracker';

const SCHEMA_ATTRS = {
    'app': 'github-pr-tracker',
};

let _schema = null;

/**
 * Returns the libsecret schema, creating it on first use. EGO guidelines ask
 * extensions not to create GObjects at import time, only once enabled.
 * @returns {Secret.Schema}
 */
function getSchema() {
    if (!_schema) {
        _schema = new Secret.Schema(
            SCHEMA_NAME,
            Secret.SchemaFlags.NONE,
            {
                'app': Secret.SchemaAttributeType.STRING,
            }
        );
    }
    return _schema;
}

/**
 * Stores the GitHub Personal Access Token in the system keyring.
 * @param {string} token
 * @returns {Promise<boolean>}
 */
export function storeToken(token) {
    return new Promise((resolve, reject) => {
        Secret.password_store(
            getSchema(),
            SCHEMA_ATTRS,
            Secret.COLLECTION_DEFAULT,
            'GitHub PR Tracker Access Token',
            token,
            null,
            (source, res) => {
                try {
                    const success = Secret.password_store_finish(res);
                    resolve(success);
                } catch (err) {
                    reject(err);
                }
            }
        );
    });
}

/**
 * Loads the GitHub Personal Access Token from the system keyring.
 * @returns {Promise<string|null>}
 */
export function loadToken() {
    return new Promise((resolve, reject) => {
        Secret.password_lookup(
            getSchema(),
            SCHEMA_ATTRS,
            null,
            (source, res) => {
                try {
                    const password = Secret.password_lookup_finish(res);
                    resolve(password || null);
                } catch (err) {
                    reject(err);
                }
            }
        );
    });
}

/**
 * Deletes the GitHub Personal Access Token from the system keyring.
 * @returns {Promise<boolean>}
 */
export function deleteToken() {
    return new Promise((resolve, reject) => {
        Secret.password_clear(
            getSchema(),
            SCHEMA_ATTRS,
            null,
            (source, res) => {
                try {
                    const success = Secret.password_clear_finish(res);
                    resolve(success);
                } catch (err) {
                    reject(err);
                }
            }
        );
    });
}
