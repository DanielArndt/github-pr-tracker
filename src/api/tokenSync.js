// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

/**
 * Re-reads the access token and applies it to the client, so that tokens
 * saved, replaced or cleared in Preferences take effect on the next refresh
 * instead of lingering in memory.
 *
 * Errors from the loader (e.g. a locked or unavailable keyring) propagate to
 * the caller.
 *
 * @param {{setToken: function(string|null): void}} client
 * @param {function(): Promise<string|null>} loadTokenFn
 * @returns {Promise<boolean>} whether a usable token is now configured
 */
export async function syncClientToken(client, loadTokenFn) {
    const token = (await loadTokenFn())?.trim() || null;
    client.setToken(token);
    return token !== null;
}
