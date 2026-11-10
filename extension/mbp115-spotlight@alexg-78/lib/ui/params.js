// Spotlight Search: inline input fields for actions with parameters (R5.4)
// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

// Tab and Shift+Tab cycle the fields, Return emits 'run'. Esc is the window's (it steps back).
export const ParamsForm = GObject.registerClass({
    Signals: {'run': {}},
}, class ParamsForm extends St.BoxLayout {
    _init() {
        super._init({style_class: 'spotlight-params', x_expand: true, visible: false});
        this._entries = [];
        this.item = null;
    }

    get active() {
        return this.item !== null;
    }

    get values() {
        return Object.fromEntries(this.item.params.map((p, i) => [p.name, this._entries[i].get_text()]));
    }

    show(item) {
        this.clear();
        this.item = item;
        for (const param of item.params) {
            const entry = new St.Entry({
                style_class: 'spotlight-param',
                hint_text: param.hint,
                accessible_name: param.hint,
                can_focus: true,
                x_expand: true,
            });
            entry.clutter_text.connect('activate', () => this.emit('run'));
            entry.clutter_text.connect('key-press-event', (_actor, event) => this._onKey(event));
            this.add_child(entry);
            this._entries.push(entry);
        }
        this.visible = true;
        this._entries[0].clutter_text.grab_key_focus();
    }

    clear() {
        this.item = null;
        this._entries = [];
        this.destroy_all_children();
        this.visible = false;
    }

    _onKey(event) {
        const symbol = event.get_key_symbol();
        if (symbol !== Clutter.KEY_Tab && symbol !== Clutter.KEY_ISO_Left_Tab)
            return Clutter.EVENT_PROPAGATE;
        const back = symbol === Clutter.KEY_ISO_Left_Tab;
        const current = this._entries.findIndex(e => e.clutter_text.has_key_focus());
        const next = (current + (back ? -1 : 1) + this._entries.length) % this._entries.length;
        this._entries[next].clutter_text.grab_key_focus();
        return Clutter.EVENT_STOP;
    }
});
