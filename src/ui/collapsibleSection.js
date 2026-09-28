// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { PRRow } from './prRow.js';
import { CATEGORIES } from '../models/prItem.js';

export const CollapsibleSection = GObject.registerClass(
class CollapsibleSection extends PopupMenu.PopupSubMenuMenuItem {
    _init(categoryId, title, iconName, defaultExpanded = false, callbacks = {}) {
        super._init(title, true);
        this.add_style_class_name('pr-section-header');
        this._categoryId = categoryId;
        this._title = title;
        this._defaultExpanded = defaultExpanded;
        this._onDismiss = callbacks.onDismiss || null;
        this._onUndo = callbacks.onUndo || null;
        this._isDismissedSection = (categoryId === CATEGORIES.DISMISSED);
        this._hasInitialized = false;

        if (this.icon && iconName) {
            this.icon.icon_name = iconName;
            this.icon.add_style_class_name('pr-section-icon');
        }

        this._countBadge = new St.Label({
            text: '0',
            style_class: 'pr-section-count-badge empty',
            y_align: Clutter.ActorAlign.CENTER,
        });

        // Insert badge right after the section title label
        if (this.label) {
            this.insert_child_above(this._countBadge, this.label);
        } else {
            this.add_child(this._countBadge);
        }

        this._items = [];
    }

    get categoryId() {
        return this._categoryId;
    }

    get count() {
        return this._items.length;
    }

    setCount(count) {
        this._countBadge.text = `${count}`;
        if (count === 0) {
            this._countBadge.add_style_class_name('empty');
        } else {
            this._countBadge.remove_style_class_name('empty');
        }
    }

    clear() {
        this.menu.removeAll();
        this._items = [];
        this.setCount(0);
    }

    /**
     * Populates section with PR items.
     * @param {Array<import('../models/prItem.js').PRItem>} prItems
     */
    setPRs(prItems) {
        const wasOpen = this.menu.isOpen;
        const shouldBeOpen = this._hasInitialized ? wasOpen : (this._defaultExpanded && prItems.length > 0);
        this._hasInitialized = true;

        this.clear();
        this._items = prItems;
        this.setCount(prItems.length);

        if (prItems.length === 0) {
            const emptyItem = new PopupMenu.PopupMenuItem('No pull requests', {
                reactive: false,
                style_class: 'pr-empty-item',
            });
            this.menu.addMenuItem(emptyItem);
            return;
        }

        for (const item of prItems) {
            const row = new PRRow(item, {
                onDismiss: this._onDismiss,
                onUndo: this._onUndo,
                isDismissed: this._isDismissedSection,
            });
            this.menu.addMenuItem(row);
        }

        if (shouldBeOpen && prItems.length > 0) {
            this.setSubmenuShown(true);
        }
    }
});
