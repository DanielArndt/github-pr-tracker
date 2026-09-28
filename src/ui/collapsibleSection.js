// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Atk from 'gi://Atk';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { PRRow } from './prRow.js';
import { CATEGORIES } from '../models/prItem.js';

export const CollapsibleSection = GObject.registerClass(
class CollapsibleSection extends PopupMenu.PopupSubMenuMenuItem {
    _init(categoryId, title, iconName, defaultExpanded = false, callbacks = {}) {
        super._init(title, true);
        this.add_style_class_name('pr-section-header');
        this._defaultExpanded = defaultExpanded;
        this._onDismiss = callbacks.onDismiss || null;
        this._onUndo = callbacks.onUndo || null;
        this._isDismissedSection = (categoryId === CATEGORIES.DISMISSED);
        // Open state chosen by the user (true/false), or null to follow the
        // default. GNOME Shell closes submenus whenever the dropdown closes,
        // so this is what gets restored when it reopens.
        this._userOpen = null;

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

    // Unlike the parent class, this does not call _setOpenedSubMenu(), so
    // opening one section does not collapse the others.
    _subMenuOpenStateChanged(menu, open) {
        if (open) {
            this.add_style_pseudo_class('open');
            this.add_accessible_state(Atk.StateType.EXPANDED);
            this.add_style_pseudo_class('checked');
        } else {
            this.remove_style_pseudo_class('open');
            this.remove_accessible_state(Atk.StateType.EXPANDED);
            this.remove_style_pseudo_class('checked');
        }
    }

    // Called by the parent class for both clicks and Left/Right arrow keys
    _setOpenState(open) {
        this._userOpen = open;
        this.setSubmenuShown(open, false);
    }

    setSubmenuShown(open, animate = false) {
        if (open)
            this.menu.open(animate);
        else
            this.menu.close(animate);
    }

    _shouldBeOpen() {
        return this._userOpen ?? (this._defaultExpanded && this._items.length > 0);
    }

    _syncOpenState() {
        const shouldBeOpen = this._shouldBeOpen();
        if (shouldBeOpen !== this.menu.isOpen) {
            this.setSubmenuShown(shouldBeOpen, false);
        }
    }

    onMenuOpened() {
        this._syncOpenState();
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
        this.clear();
        this._items = prItems;
        this.setCount(prItems.length);

        if (prItems.length === 0) {
            const emptyItem = new PopupMenu.PopupMenuItem('No pull requests', {
                reactive: false,
                style_class: 'pr-empty-item',
            });
            this.menu.addMenuItem(emptyItem);
        } else {
            for (const item of prItems) {
                const row = new PRRow(item, {
                    onDismiss: this._onDismiss,
                    onUndo: this._onUndo,
                    isDismissed: this._isDismissedSection,
                });
                this.menu.addMenuItem(row);
            }
        }

        this._syncOpenState();
    }
});
