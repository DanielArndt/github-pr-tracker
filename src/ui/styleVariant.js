// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/** Style class added to the indicator and its menu under a light Shell style. */
export const LIGHT_STYLE_CLASS = 'pr-light';

/**
 * Whether GNOME Shell is currently using a light stylesheet.
 *
 * GNOME Shell 47+ can follow the system light/dark preference. The high
 * contrast stylesheet is dark, and older versions without
 * Main.getStyleVariant() only ship a dark style.
 * @returns {boolean}
 */
export function isLightStyle() {
    if (St.Settings.get().high_contrast) {
        return false;
    }
    if (typeof Main.getStyleVariant !== 'function') {
        return false;
    }
    return Main.getStyleVariant() === 'light';
}

/**
 * Keeps LIGHT_STYLE_CLASS on the given actors in sync with the Shell style.
 *
 * Listens to the theme context, which changes whenever the Shell swaps its
 * stylesheet (light/dark switch, high contrast, custom themes). The handler
 * is disconnected automatically when `owner` is destroyed.
 * @param {import('gi://Clutter').default.Actor} owner
 * @param {Array<St.Widget>} actors
 */
export function trackStyleVariant(owner, actors) {
    const sync = () => {
        const light = isLightStyle();
        for (const actor of actors) {
            if (light) {
                actor.add_style_class_name(LIGHT_STYLE_CLASS);
            } else {
                actor.remove_style_class_name(LIGHT_STYLE_CLASS);
            }
        }
    };

    St.ThemeContext.get_for_stage(global.stage).connectObject('changed', sync, owner);
    sync();
}
