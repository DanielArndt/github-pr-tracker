// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { MenuView } from './menuView.js';
import { trackStyleVariant } from './styleVariant.js';
import { CATEGORIES, CATEGORY_METADATA } from '../models/prItem.js';

/** Categories shown as count pills in the top bar, in display order. */
const PANEL_BADGE_CATEGORIES = [
    CATEGORIES.ACTION_REQUIRED,
    CATEGORIES.NEEDS_MY_REVIEW,
    CATEGORIES.READY_TO_MERGE,
];

export const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(extension, onRefresh, callbacks = {}) {
        super._init(0.0, 'GitHub PR Tracker');
        this._extension = extension;
        this._onRefresh = onRefresh;

        // Container box in the top bar panel
        const box = new St.BoxLayout({
            vertical: false,
            style_class: 'panel-status-indicators-box pr-panel-box',
            y_align: Clutter.ActorAlign.CENTER,
        });

        // GitHub symbolic icon
        const iconFile = Gio.File.new_for_path(this._extension.path + '/icons/github-symbolic.svg');
        const gicon = new Gio.FileIcon({ file: iconFile });
        this._icon = new St.Icon({
            gicon: gicon,
            style_class: 'system-status-icon pr-panel-icon',
        });
        box.add_child(this._icon);

        // Container for pill badges
        this._badgeBox = new St.BoxLayout({
            vertical: false,
            style_class: 'pr-panel-badge-box',
            y_align: Clutter.ActorAlign.CENTER,
        });

        // One pill per panel category, e.g. "⚠️ 2", hidden while the count is zero
        this._badges = new Map();
        for (const catId of PANEL_BADGE_CATEGORIES) {
            const badge = new St.Label({
                style_class: 'pr-panel-pill',
                y_align: Clutter.ActorAlign.CENTER,
            });
            badge.hide();
            this._badgeBox.add_child(badge);
            this._badges.set(catId, badge);
        }

        box.add_child(this._badgeBox);
        this.add_child(box);

        // Build popup menu view
        this.menuView = new MenuView(this.menu, this._extension, this._onRefresh, callbacks);

        // Switch to the light palette in stylesheet.css when the Shell uses a
        // light style. The menu is not a child of the button, so tag both.
        trackStyleVariant(this, [this, this.menu.actor]);
    }

    /**
     * Updates top panel badges based on categorized PR counts.
     * @param {Map<string, Array<any>>} categorizedPRs
     */
    updateCounts(categorizedPRs) {
        for (const [catId, badge] of this._badges) {
            const count = (categorizedPRs.get(catId) || []).length;
            if (count > 0) {
                badge.text = `${CATEGORY_METADATA[catId].symbol} ${count}`;
                badge.show();
            } else {
                badge.hide();
            }
        }

        // Forward full data to dropdown menu
        this.menuView.updateData(categorizedPRs);
    }

    destroy() {
        if (this.menuView) {
            this.menuView.destroy();
            this.menuView = null;
        }
        super.destroy();
    }
});
