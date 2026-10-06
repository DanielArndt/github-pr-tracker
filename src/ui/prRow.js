// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { formatRelativeTime } from '../utils/time.js';

/**
 * Maps reason string to a CSS class name.
 * @param {string} reason
 * @returns {string}
 */
function reasonToCssClass(reason) {
    switch (reason) {
        case 'Changes Requested':
            return 'pr-tag-changes-requested';
        case 'CI Failed':
            return 'pr-tag-ci-failed';
        case 'Conflicts':
            return 'pr-tag-conflict';
        case 'Unresolved Comments':
            return 'pr-tag-unresolved';
        case 'Approved':
            return 'pr-tag-approved';
        case 'Review Requested':
            return 'pr-tag-review-requested';
        case 'Awaiting Re-review':
            return 'pr-tag-rereview';
        case 'Draft':
            return 'pr-tag-draft';
        case 'Awaiting Workflow Approval':
            return 'pr-tag-workflow-approval';
        case 'Pending Checks':
            return 'pr-tag-pending-checks';
        case 'Assigned':
            return 'pr-tag-assigned';
        default:
            return 'pr-tag-default';
    }
}

export const PRRow = GObject.registerClass(
class PRRow extends PopupMenu.PopupBaseMenuItem {
    _init(prItem, options = {}, params = {}) {
        super._init(params);
        this.add_style_class_name('pr-menu-item');
        this._pr = prItem;
        this._onSnooze = options.onSnooze || null;
        this._onDismiss = options.onDismiss || null;
        this._onUndo = options.onUndo || options.onRestore || null;
        this._onRestore = options.onRestore || options.onUndo || null;
        this._isDismissed = !!options.isDismissed;
        this._isSnoozed = !!options.isSnoozed;
        this._isActionClick = false;

        if (this._isDismissed) {
            this.add_style_class_name('pr-menu-item-dismissed');
        } else if (this._isSnoozed) {
            this.add_style_class_name('pr-menu-item-snoozed');
        }

        const mainBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'pr-item-box',
        });

        // Top line: Repo name, PR number, author, relative time, action buttons
        const headerBox = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style_class: 'pr-header-box',
        });

        const repoLabel = new St.Label({
            text: prItem.repoName || '',
            style_class: 'pr-repo-label',
            y_align: Clutter.ActorAlign.CENTER,
        });

        const numLabel = new St.Label({
            text: ` #${prItem.number}`,
            style_class: 'pr-number-label',
            y_align: Clutter.ActorAlign.CENTER,
        });

        const authorLabel = new St.Label({
            text: ` by @${prItem.author}`,
            style_class: 'pr-author-label',
            y_align: Clutter.ActorAlign.CENTER,
        });

        const timeSpacer = new St.Bin({
            x_expand: true,
        });

        const timeLabel = new St.Label({
            text: formatRelativeTime(prItem.updatedAt),
            style_class: 'pr-time-label',
            y_align: Clutter.ActorAlign.CENTER,
        });

        const makeActionBtn = (iconName, styleClass, accessibleName, onClick) => {
            const icon = new St.Icon({
                icon_name: iconName,
                icon_size: 12,
            });
            const btn = new St.Button({
                style_class: styleClass,
                can_focus: true,
                track_hover: true,
                y_align: Clutter.ActorAlign.CENTER,
                child: icon,
            });
            btn.accessible_name = accessibleName;

            btn.connect('button-press-event', () => {
                this._isActionClick = true;
                return Clutter.EVENT_PROPAGATE;
            });

            btn.connect('clicked', () => {
                this._isActionClick = true;
                if (onClick) {
                    onClick(this._pr);
                }
                if (this._resetActionClickId) {
                    GLib.Source.remove(this._resetActionClickId);
                    this._resetActionClickId = 0;
                }
                this._resetActionClickId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._isActionClick = false;
                    this._resetActionClickId = 0;
                    return GLib.SOURCE_REMOVE;
                });
            });

            return btn;
        };

        headerBox.add_child(repoLabel);
        headerBox.add_child(numLabel);
        headerBox.add_child(authorLabel);
        headerBox.add_child(timeSpacer);
        headerBox.add_child(timeLabel);

        if (this._isDismissed) {
            this._undoBtn = makeActionBtn('edit-undo-symbolic', 'button pr-undo-btn', 'Undo dismiss', (pr) => {
                if (this._onRestore) {
                    this._onRestore(pr);
                }
            });
            headerBox.add_child(this._undoBtn);
        } else if (this._isSnoozed) {
            this._undoBtn = makeActionBtn('edit-undo-symbolic', 'button pr-undo-btn', 'Undo snooze', (pr) => {
                if (this._onRestore) {
                    this._onRestore(pr);
                }
            });
            this._dismissBtn = makeActionBtn('window-close-symbolic', 'button pr-dismiss-btn', 'Dismiss', (pr) => {
                if (this._onDismiss) {
                    this._onDismiss(pr);
                }
            });
            headerBox.add_child(this._undoBtn);
            headerBox.add_child(this._dismissBtn);
        } else {
            this._snoozeBtn = makeActionBtn('alarm-symbolic', 'button pr-snooze-btn', 'Snooze', (pr) => {
                if (this._onSnooze) {
                    this._onSnooze(pr);
                }
            });
            this._dismissBtn = makeActionBtn('window-close-symbolic', 'button pr-dismiss-btn', 'Dismiss', (pr) => {
                if (this._onDismiss) {
                    this._onDismiss(pr);
                }
            });
            headerBox.add_child(this._snoozeBtn);
            headerBox.add_child(this._dismissBtn);
        }

        // Middle line: PR Title
        const titleLabel = new St.Label({
            text: prItem.title || '(No title)',
            style_class: 'pr-title-label',
            x_expand: true,
        });
        titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        titleLabel.clutter_text.line_wrap = false;

        // Bottom line: Reason pills
        const tagsBox = new St.BoxLayout({
            vertical: false,
            style_class: 'pr-tags-box',
        });

        const reasons = prItem.reasons && prItem.reasons.length > 0 ? prItem.reasons : [];
        for (const reason of reasons) {
            const tagLabel = new St.Label({
                text: reason,
                style_class: `pr-tag ${reasonToCssClass(reason)}`,
                y_align: Clutter.ActorAlign.CENTER,
            });
            tagsBox.add_child(tagLabel);
        }

        mainBox.add_child(headerBox);
        mainBox.add_child(titleLabel);
        if (reasons.length > 0) {
            mainBox.add_child(tagsBox);
        }

        this.add_child(mainBox);

        // Connect click action to open PR in default browser
        this.connect('activate', () => {
            this._openPR();
        });
    }

    activate(event) {
        if (this._isActionClick) {
            this._isActionClick = false;
            return;
        }
        if (event) {
            const source = event.get_source();
            if (source) {
                const actionBtns = [this._snoozeBtn, this._dismissBtn, this._undoBtn].filter(Boolean);
                for (const btn of actionBtns) {
                    if (source === btn || btn.contains(source)) {
                        return;
                    }
                }
            }
        }
        super.activate(event);
    }

    _openPR() {
        if (!this._pr || !this._pr.url) return;
        try {
            Gio.AppInfo.launch_default_for_uri(this._pr.url, null);
        } catch (err) {
            console.error(`[GitHub PR Tracker] Failed to open URL ${this._pr.url}:`, err);
        }
    }

    destroy() {
        if (this._resetActionClickId) {
            GLib.Source.remove(this._resetActionClickId);
            this._resetActionClickId = 0;
        }
        this._snoozeBtn = null;
        this._dismissBtn = null;
        this._undoBtn = null;
        this._pr = null;
        this._onSnooze = null;
        this._onDismiss = null;
        this._onUndo = null;
        this._onRestore = null;
        super.destroy();
    }
});
