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
        this._categoryId = categoryId;
        this._title = title;
        this._defaultExpanded = defaultExpanded;
        this._onDismiss = callbacks.onDismiss || null;
        this._onUndo = callbacks.onUndo || null;
        this._isDismissedSection = (categoryId === CATEGORIES.DISMISSED);
        this._userToggled = false;

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

    activate(event) {
        this._userToggled = true;
        super.activate(event);
    }

    setSubmenuShown(open, animate = false) {
        if (open)
            this.menu.open(animate);
        else
            this.menu.close(animate);
    }

    onMenuOpened() {
        const shouldBeOpen = this._userToggled
            ? this.menu.isOpen
            : (this._defaultExpanded && this._items.length > 0);
        if (shouldBeOpen && !this.menu.isOpen) {
            this.setSubmenuShown(true, false);
        }
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
        this.clear();
        this._items = prItems;
        this.setCount(prItems.length);

        const shouldBeOpen = this._userToggled
            ? this.menu.isOpen
            : (this._defaultExpanded && prItems.length > 0);

        if (prItems.length === 0) {
            const emptyItem = new PopupMenu.PopupMenuItem('No pull requests', {
                reactive: false,
                style_class: 'pr-empty-item',
            });
            this.menu.addMenuItem(emptyItem);
            if (this.menu.isOpen && !this._userToggled) {
                this.setSubmenuShown(false, false);
            }
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

        if (shouldBeOpen && !this.menu.isOpen) {
            this.setSubmenuShown(true, false);
        } else if (!shouldBeOpen && this.menu.isOpen) {
            this.setSubmenuShown(false, false);
        }
    }
});
