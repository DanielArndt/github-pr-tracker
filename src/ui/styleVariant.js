// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

/** Style class added to widgets whose theme draws dark text on a light background. */
export const LIGHT_STYLE_CLASS = 'pr-light';

/**
 * Whether a foreground color is dark, i.e. the theme expects a light background.
 * @param {{red: number, green: number, blue: number}} color 0–255 channels
 * @returns {boolean}
 */
export function isDarkForeground(color) {
    // Relative luminance approximation (ITU-R BT.709 weights)
    const luminance = (0.2126 * color.red + 0.7152 * color.green + 0.0722 * color.blue) / 255;
    return luminance < 0.5;
}

/**
 * Keeps LIGHT_STYLE_CLASS on each widget in sync with the text color the
 * current Shell theme gives it.
 *
 * The panel and the popup menu are checked separately because themes differ:
 * upstream GNOME's light style makes both light, while Ubuntu's Yaru keeps a
 * dark top bar with a light menu. Using the theme's resolved foreground color
 * also covers high contrast and custom themes.
 *
 * St emits `style-changed` whenever a widget's style is recomputed, including
 * after the Shell swaps its stylesheet. Handlers are disconnected when
 * `owner` is destroyed.
 * @param {import('gi://Clutter').default.Actor} owner
 * @param {Array<import('gi://St').default.Widget>} widgets
 */
export function trackLightBackground(owner, widgets) {
    for (const widget of widgets) {
        const sync = () => {
            if (!widget.get_stage()) return;
            const color = widget.get_theme_node().get_foreground_color();
            if (isDarkForeground(color)) {
                widget.add_style_class_name(LIGHT_STYLE_CLASS);
            } else {
                widget.remove_style_class_name(LIGHT_STYLE_CLASS);
            }
        };
        widget.connectObject('style-changed', sync, owner);
        sync();
    }
}
