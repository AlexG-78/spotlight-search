// Spotlight Search: clipboard history (R6): records copies, searches them, pastes them back
// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {ClipboardStore} from '../core/clipboardStore.js';
import {hasSecretHint, isSecretApp, looksSecret} from '../core/secrets.js';

const FILES_MIME = 'x-special/gnome-copied-files';
const IMAGE_MIME = 'image/png';
const MAX_IN_SEARCH = 5;
// Focus is back on the previous window a moment after Spotlight's modal ends.
const PASTE_DELAY_MS = 100;
const TERMINALS = /term|ptyxis|console|kitty|alacritty|ghostty|foot|wezterm|konsole|tilix/i;
const KIND_LABELS = {text: 'Text', link: 'Link', image: 'Image', files: 'Files'};
const KIND_ICONS = {text: 'edit-paste-symbolic', link: 'web-browser-symbolic', files: 'folder-documents-symbolic'};
// Password managers clear the clipboard after a while (Bitwarden at most after 5 minutes).
// A copy that gets wiped this soon was meant to be transient, so it leaves the history too.
const WIPE_WINDOW_MS = 5 * 60 * 1000;

function ago(time) {
    const minutes = Math.round((Date.now() - time) / 60000);
    if (minutes < 1)
        return 'Just now';
    if (minutes < 60)
        return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

function decode(bytes) {
    return new TextDecoder().decode(bytes?.get_data() ?? new Uint8Array());
}

export class ClipboardProvider {
    constructor(settings) {
        this.id = 'clipboard';
        this._settings = settings;
        this._store = null;
        this._pasteId = 0;
        this._keyboard = null;
        this._lastCopy = null; // the entry the latest copy added, if any
        settings.connectObject('changed::clipboard-history', () => this._sync(), this);
        this._sync();
    }

    get enabled() {
        return this._settings.get_boolean('clipboard-history');
    }

    async search(terms) {
        return this.list(terms).slice(0, MAX_IN_SEARCH);
    }

    // Clipboard view: every match, newest first. Images have no text, so only browsing shows them.
    list(terms) {
        if (!this._store)
            return [];
        this._store.prune(this._settings.get_int('clipboard-retention'));
        const lower = terms.map(t => t.toLowerCase());
        return this._store.entries
            .filter(e => lower.every(t => e.kind !== 'image' && e.text.toLowerCase().includes(t)))
            .map(e => this._item(e));
    }

    // Until the user opts in (R6.1), the view only offers to turn history on.
    async browse() {
        if (!this.enabled) {
            return [this._control('enable', 'Turn On Clipboard History', 'edit-paste-symbolic',
                'Keeps what you copy on this computer, so you can find and paste it again',
                () => this._settings.set_boolean('clipboard-history', true))];
        }
        const items = this.list([]);
        if (items.length) {
            items.push(this._control('clear', 'Clear Clipboard History', 'edit-clear-all-symbolic', '',
                () => this._store.clear()));
        }
        return items;
    }

    // Return pastes into the previous window (R6.5); a click only copies.
    activate(item, _terms, {click = false} = {}) {
        if (item.run) {
            item.run();
            return;
        }
        const {entry} = item;
        const clipboard = St.Clipboard.get_default();
        const type = St.ClipboardType.CLIPBOARD;
        if (entry.kind === 'image') {
            const [, bytes] = Gio.File.new_for_path(this._store.imagePath(entry)).load_contents(null);
            clipboard.set_content(type, IMAGE_MIME, new GLib.Bytes(bytes));
        } else if (entry.kind === 'files') {
            clipboard.set_content(type, FILES_MIME, new GLib.Bytes(new TextEncoder().encode(`copy\n${entry.text}`)));
        } else {
            clipboard.set_text(type, entry.text);
        }
        if (click)
            return;
        if (this._pasteId)
            GLib.source_remove(this._pasteId);
        this._pasteId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PASTE_DELAY_MS, () => {
            this._pasteId = 0;
            this._paste();
            return GLib.SOURCE_REMOVE;
        });
    }

    forget(item) {
        this._store?.remove(item.entry);
    }

    destroy() {
        if (this._pasteId)
            GLib.source_remove(this._pasteId);
        this._pasteId = 0;
        this._settings.disconnectObject(this);
        global.display.get_selection().disconnectObject(this);
        this._keyboard = null;
        this._store = null;
    }

    // Turning history off also deletes it.
    _sync() {
        const selection = global.display.get_selection();
        selection.disconnectObject(this);
        if (!this.enabled) {
            const store = this._store ?? new ClipboardStore();
            if (store.entries.length)
                store.clear();
            this._store = null;
            return;
        }
        this._store ??= new ClipboardStore();
        selection.connectObject('owner-changed', (_selection, type, source) => {
            if (type === Meta.SelectionType.SELECTION_CLIPBOARD)
                this._record(source);
        }, this);
    }

    // Nothing secret enters the history (R6.3): not what a password manager marks or copies,
    // not what looks like a key, token, card number or generated password, and not what the
    // source wipes again soon after.
    _record(source) {
        const previous = this._lastCopy;
        this._lastCopy = null;
        const clipboard = St.Clipboard.get_default();
        const type = St.ClipboardType.CLIPBOARD;
        const mimetypes = source ? clipboard.get_mimetypes(type) : [];
        const focus = global.display.focus_window;
        const app = [focus?.get_wm_class(), focus?.get_gtk_application_id(), focus?.get_sandboxed_app_id()].join(' ');
        if (!source || hasSecretHint(mimetypes) || isSecretApp(app, this._settings.get_strv('clipboard-ignore-apps'))) {
            if (!source)
                this._dropIfRecent(previous);
            return;
        }
        // The callbacks can land after disable(), when _store is gone.
        if (mimetypes.includes(FILES_MIME)) {
            clipboard.get_content(type, FILES_MIME, (_c, bytes) => {
                const uris = decode(bytes).split('\n').filter(line => line.includes('://'));
                if (uris.length)
                    this._lastCopy = this._store?.add({kind: 'files', text: uris.join('\n')}) ?? null;
            });
        } else if (mimetypes.includes(IMAGE_MIME)) {
            clipboard.get_content(type, IMAGE_MIME, (_c, bytes) => {
                if (bytes?.get_size())
                    this._lastCopy = this._store?.add({kind: 'image'}, bytes) ?? null;
            });
        } else {
            clipboard.get_text(type, (_c, text) => {
                if (!text?.trim())
                    this._dropIfRecent(previous);
                else if (!looksSecret(text))
                    this._lastCopy = this._store?.add({kind: /^https?:\/\/\S+$/.test(text.trim()) ? 'link' : 'text', text}) ?? null;
            });
        }
    }

    // Only the copy right before the wipe goes: older entries were not what got wiped.
    _dropIfRecent(entry) {
        if (entry && Date.now() - entry.time < WIPE_WINDOW_MS && this._store?.entries.includes(entry))
            this._store.remove(entry);
    }

    _paste() {
        const terminal = TERMINALS.test(global.display.focus_window?.get_wm_class() ?? '');
        this._keyboard ??= global.stage.context.get_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const keys = [Clutter.KEY_Control_L, ...terminal ? [Clutter.KEY_Shift_L] : [], Clutter.KEY_v];
        const time = GLib.get_monotonic_time();
        keys.forEach(k => this._keyboard.notify_keyval(time, k, Clutter.KeyState.PRESSED));
        keys.reverse().forEach(k => this._keyboard.notify_keyval(time, k, Clutter.KeyState.RELEASED));
    }

    _item(entry) {
        const name = entry.kind === 'image' ? 'Image'
            : entry.kind === 'files' ? entry.text.split('\n')
                .map(uri => GLib.uri_unescape_string(GLib.path_get_basename(uri), null) ?? uri).join(', ')
                : entry.text.replace(/\s+/g, ' ').trim().slice(0, 200);
        const createIcon = entry.kind === 'image'
            ? size => new St.Icon({gicon: Gio.FileIcon.new(Gio.File.new_for_path(this._store.imagePath(entry))), icon_size: size})
            : size => new St.Icon({icon_name: KIND_ICONS[entry.kind], icon_size: size});
        return {
            key: `clipboard:${entry.id}`,
            id: entry.id,
            name,
            description: `${KIND_LABELS[entry.kind]} · ${ago(entry.time)}`,
            createIcon,
            section: 'Clipboard',
            provider: this,
            entry,
        };
    }

    // Spotlight stays open for these, so the view updates in place.
    _control(id, name, icon, description, run) {
        return {
            key: `clipboard:${id}`, id, name, description, section: 'Clipboard', provider: this, run, keepOpen: true,
            createIcon: size => new St.Icon({icon_name: icon, icon_size: size}),
        };
    }
}
