// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import GLib from 'gi://GLib';

/** GSettings key bumped by Preferences whenever the token is saved or cleared. */
export const TOKEN_CHANGED_KEY = 'token-changed';

/**
 * Signals the running extension that the keyring token changed. Only a
 * timestamp is written; the token itself never touches GSettings.
 * @param {import('gi://Gio').default.Settings} settings
 */
export function notifyTokenChanged(settings) {
    settings.set_int64(TOKEN_CHANGED_KEY, GLib.get_real_time());
}

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
