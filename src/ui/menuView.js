// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { CATEGORIES, CATEGORY_METADATA } from '../models/prItem.js';
import { CollapsibleSection } from './collapsibleSection.js';
import { formatRelativeTime } from '../utils/time.js';
import { MAX_PRS_PER_LIST } from '../api/queries.js';

export class MenuView {
    /**
     * @param {PopupMenu.PopupMenu} menu
     * @param {Object} extension
     * @param {Function} onRefresh
     * @param {Object} [callbacks]
     */
    constructor(menu, extension, onRefresh, callbacks = {}) {
        this._menu = menu;
        this._extension = extension;
        this._onRefresh = onRefresh;
        this._callbacks = callbacks;

        this._sections = new Map();
        this._lastUpdated = null;

        this._buildUI();
    }

    _buildUI() {
        // 1. Header / User status item
        this._headerItem = new PopupMenu.PopupMenuItem('', {
            reactive: false,
            style_class: 'pr-user-header',
        });
        this._headerItem.label.clutter_text.set_markup('<b>GitHub Pull Requests</b>');
        this._menu.addMenuItem(this._headerItem);

        // 2. Status message item (for warnings, auth setup, etc.)
        this._statusItem = new PopupMenu.PopupMenuItem('Configuring...', {
            style_class: 'pr-status-item',
        });
        this._statusItem.connect('activate', () => {
            this._menu.close();
            this._extension.openPreferences();
        });
        this._menu.addMenuItem(this._statusItem);
        this._statusItem.actor.hide();

        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 3. The Collapsible Sections
        const sectionOrder = [
            CATEGORIES.ACTION_REQUIRED,
            CATEGORIES.NEEDS_MY_REVIEW,
            CATEGORIES.READY_TO_MERGE,
            CATEGORIES.WAITING_REVIEW,
            CATEGORIES.DRAFT,
            CATEGORIES.DISMISSED,
        ];

        for (const catId of sectionOrder) {
            const meta = CATEGORY_METADATA[catId];
            const section = new CollapsibleSection(
                meta.id,
                meta.title,
                meta.iconName,
                meta.defaultExpanded,
                this._callbacks
            );
            this._sections.set(catId, section);
            this._menu.addMenuItem(section);
        }

        // GNOME Shell collapses every submenu when the dropdown closes, so
        // restore each section's expanded state (default or user-chosen) and
        // refresh the "Updated …" label whenever the dropdown opens
        this._menuOpenStateId = this._menu.connect('open-state-changed', (menu, open) => {
            if (open) {
                for (const section of this._sections.values()) {
                    section.onMenuOpened();
                }
                this._updateTimeLabel();
            }
        });

        // 4. Separator & Footer
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._footerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            style_class: 'pr-footer-item',
        });

        const footerBox = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style_class: 'pr-footer-box',
        });

        this._timeLabel = new St.Label({
            text: 'Never updated',
            style_class: 'pr-footer-time-label',
            y_align: Clutter.ActorAlign.CENTER,
        });

        const spacer = new St.Bin({
            x_expand: true,
        });

        this._refreshBtn = new St.Button({
            style_class: 'button pr-footer-btn',
            can_focus: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                icon_name: 'view-refresh-symbolic',
                icon_size: 14,
            }),
        });
        this._refreshBtn.connect('clicked', () => {
            if (this._onRefresh) {
                this._onRefresh();
            }
        });

        this._prefsBtn = new St.Button({
            style_class: 'button pr-footer-btn',
            can_focus: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                icon_name: 'preferences-system-symbolic',
                icon_size: 14,
            }),
        });
        this._prefsBtn.connect('clicked', () => {
            this._menu.close();
            this._extension.openPreferences();
        });

        footerBox.add_child(this._timeLabel);
        footerBox.add_child(spacer);
        footerBox.add_child(this._refreshBtn);
        footerBox.add_child(this._prefsBtn);

        this._footerItem.add_child(footerBox);
        this._menu.addMenuItem(this._footerItem);
    }

    /**
     * Shows prompt when no token is configured.
     */
    showTokenRequired() {
        this._statusItem.label.text = '⚠️ Click to set GitHub Access Token in Settings';
        this._statusItem.actor.show();
        for (const section of this._sections.values()) {
            section.clear();
        }
    }

    /**
     * Sets error message banner.
     * @param {string} errorText
     */
    showError(errorText) {
        this._hasError = true;
        this._statusItem.label.text = `⚠️ ${errorText}`;
        this._statusItem.actor.show();
    }

    /**
     * Sets active loading state.
     * @param {boolean} isLoading
     */
    setLoading(isLoading) {
        this._refreshBtn.reactive = !isLoading;
        if (isLoading) {
            this._hasError = false;
            this._statusItem.label.text = 'Fetching pull requests...';
            this._statusItem.actor.show();
        } else if (!this._hasError) {
            this._statusItem.actor.hide();
        }
    }

    /**
     * Updates the username in header.
     * @param {string} username
     */
    setUsername(username) {
        if (username) {
            // The login comes from GSettings, so escape it before using markup
            const escaped = GLib.markup_escape_text(username, -1);
            this._headerItem.label.clutter_text.set_markup(`<b>GitHub PRs (@${escaped})</b>`);
        } else {
            this._headerItem.label.clutter_text.set_markup('<b>GitHub Pull Requests</b>');
        }
    }

    /**
     * Updates the PR list for each category.
     * @param {Map<string, Array<import('../models/prItem.js').PRItem>>} categorizedPRs
     */
    updateData(categorizedPRs) {
        this._statusItem.actor.hide();

        for (const [catId, section] of this._sections.entries()) {
            section.setPRs(categorizedPRs.get(catId) || []);
        }
    }

    /**
     * Records when PR data was last fetched from GitHub.
     * @param {Date|null} date null when no data is available
     * @param {boolean} [truncated] whether GitHub had more PRs than were fetched
     */
    setLastUpdated(date, truncated = false) {
        this._lastUpdated = date;
        this._truncated = truncated;
        this._updateTimeLabel();
    }

    _updateTimeLabel() {
        const relative = formatRelativeTime(this._lastUpdated);
        if (!relative) {
            this._timeLabel.text = 'Never updated';
            return;
        }
        const suffix = this._truncated ? ` · latest ${MAX_PRS_PER_LIST} per list` : '';
        this._timeLabel.text = `Updated ${relative}${suffix}`;
    }

    destroy() {
        if (this._menuOpenStateId) {
            this._menu.disconnect(this._menuOpenStateId);
            this._menuOpenStateId = null;
        }
        for (const section of this._sections.values()) {
            section.clear();
        }
        this._sections.clear();
    }
}
