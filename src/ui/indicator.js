// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { MenuView } from './menuView.js';
import { CATEGORIES } from '../models/prItem.js';

export const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(extension, onRefresh) {
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

        // 1. Action Required badge (e.g. ⚠️ 2)
        this._actionBadge = new St.Label({
            style_class: 'pr-panel-pill',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._actionBadge.hide();
        this._badgeBox.add_child(this._actionBadge);

        // 2. Needs My Review badge (e.g. 💬 3)
        this._reviewBadge = new St.Label({
            style_class: 'pr-panel-pill',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._reviewBadge.hide();
        this._badgeBox.add_child(this._reviewBadge);

        // 3. Ready to Merge badge (e.g. ✓ 1)
        this._mergeBadge = new St.Label({
            style_class: 'pr-panel-pill',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._mergeBadge.hide();
        this._badgeBox.add_child(this._mergeBadge);

        box.add_child(this._badgeBox);
        this.add_child(box);

        // Build popup menu view
        this.menuView = new MenuView(this.menu, this._extension, this._onRefresh);
    }

    /**
     * Updates top panel badges based on categorized PR counts.
     * @param {Map<string, Array<any>>} categorizedPRs
     */
    updateCounts(categorizedPRs) {
        const actionItems = categorizedPRs.get(CATEGORIES.ACTION_REQUIRED) || [];
        const reviewItems = categorizedPRs.get(CATEGORIES.NEEDS_MY_REVIEW) || [];
        const mergeItems = categorizedPRs.get(CATEGORIES.READY_TO_MERGE) || [];

        const actionCount = actionItems.length;
        const reviewCount = reviewItems.length;
        const mergeCount = mergeItems.length;

        // Action Required pill
        if (actionCount > 0) {
            this._actionBadge.text = `⚠️ ${actionCount}`;
            this._actionBadge.show();
        } else {
            this._actionBadge.hide();
        }

        // Needs My Review pill
        if (reviewCount > 0) {
            this._reviewBadge.text = `💬 ${reviewCount}`;
            this._reviewBadge.show();
        } else {
            this._reviewBadge.hide();
        }

        // Ready to Merge pill
        if (mergeCount > 0) {
            this._mergeBadge.text = `✓ ${mergeCount}`;
            this._mergeBadge.show();
        } else {
            this._mergeBadge.hide();
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
