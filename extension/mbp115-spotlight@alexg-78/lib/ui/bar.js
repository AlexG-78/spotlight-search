// Spotlight Search: capsule search bar with browse buttons
// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

// Adwaita has no lightning bolt, so the Actions icon ships with the extension.
const BROWSE = [
    {name: 'apps', label: 'Apps', icon: 'view-app-grid-symbolic'},
    {name: 'files', label: 'Files', icon: 'x-office-document-symbolic'},
    {name: 'actions', label: 'Actions', icon: 'icons/actions-symbolic.svg'},
    {name: 'clipboard', label: 'Clipboard', icon: 'edit-paste-symbolic'},
];

const HINT = 'Spotlight Search';

export const SearchBar = GObject.registerClass({
    Signals: {'browse': {param_types: [GObject.TYPE_STRING]}},
}, class SearchBar extends St.BoxLayout {
    _init(extPath) {
        super._init({style_class: 'spotlight-bar', x_expand: true});
        this.add_child(new St.Icon({
            style_class: 'spotlight-bar-icon',
            icon_name: 'edit-find-symbolic',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this.entry = new St.Entry({
            style_class: 'spotlight-entry',
            accessible_name: 'Spotlight Search',
            hint_text: HINT,
            x_expand: true,
        });
        // Ghost completion: a grey label under the transparent entry, moved to the end of the typed text.
        this._ghost = new St.Label({
            style_class: 'spotlight-ghost',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._completion = null;
        const stack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            clip_to_allocation: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        stack.add_child(this._ghost);
        stack.add_child(this.entry);
        // Locked folder scope (R3.4), shown like a token in front of the query.
        this._token = new St.Label({
            style_class: 'spotlight-token',
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._token);
        this.add_child(stack);
        this.entry.clutter_text.connect('text-changed', () => this.setCompletion(this._completion));

        this._buttons = new Map();
        for (const {name, label, icon} of BROWSE) {
            const gicon = icon.endsWith('.svg')
                ? Gio.FileIcon.new(Gio.File.new_for_path(`${extPath}/${icon}`))
                : Gio.ThemedIcon.new(icon);
            const button = new St.Button({
                style_class: 'spotlight-browse-button',
                accessible_name: label,
                toggle_mode: true,
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
                child: new St.Icon({gicon, style_class: 'spotlight-browse-icon'}),
            });
            button.name = `spotlight-browse-${name}`;
            button.connect('clicked', () => this.emit('browse', name));
            this._buttons.set(name, {button, label});
            this.add_child(button);
        }
    }

    setView(view) {
        for (const [name, {button}] of this._buttons)
            button.checked = name === view;
        this.entry.hint_text = view ? `Search ${this._buttons.get(view).label}` : HINT;
    }

    setToken(name) {
        this._token.text = name ?? '';
        this._token.visible = name !== null;
    }

    get text() {
        return this.entry.get_text();
    }

    // Shows the rest of name after the typed text, if name continues what was typed.
    setCompletion(name) {
        const text = this.text;
        const fits = name && text && name.length > text.length &&
            name.toLowerCase().startsWith(text.toLowerCase());
        this._completion = fits ? name : null;
        this._ghost.text = fits ? name.slice(text.length) : '';
        if (fits)
            this._ghost.translation_x = this.entry.clutter_text.position_to_coords(-1)[1];
    }

    acceptCompletion() {
        if (!this._completion)
            return false;
        this.entry.set_text(this._completion);
        this.entry.clutter_text.set_cursor_position(-1);
        return true;
    }

    get cursorAtEnd() {
        const pos = this.entry.clutter_text.get_cursor_position();
        return pos === -1 || pos === this.text.length;
    }

    reset() {
        this.entry.set_text('');
    }

    focus() {
        this.entry.clutter_text.grab_key_focus();
    }
});
