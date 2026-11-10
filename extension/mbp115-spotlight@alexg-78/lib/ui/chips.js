// Spotlight Search: filter chips under the bar, one per result section
// SPDX-License-Identifier: GPL-3.0-or-later
import GObject from 'gi://GObject';
import St from 'gi://St';

export const FilterChips = GObject.registerClass({
    Signals: {'changed': {}},
}, class FilterChips extends St.BoxLayout {
    _init() {
        super._init({style_class: 'spotlight-chips', visible: false});
        this.active = null;
        this._names = [];
    }

    setSections(names) {
        if (names.join('\n') !== this._names.join('\n')) {
            this._names = names;
            this.destroy_all_children();
            for (const name of names) {
                const chip = new St.Button({
                    style_class: 'spotlight-chip',
                    label: name,
                    toggle_mode: true,
                    can_focus: false,
                });
                chip.connect('clicked', () => this.toggle(name));
                this.add_child(chip);
            }
        }
        if (this.active && !names.includes(this.active))
            this.active = null;
        this._sync();
        this.visible = names.length > 1;
    }

    // Ctrl+number, counted from 0.
    toggleIndex(i) {
        if (i < this._names.length)
            this.toggle(this._names[i]);
    }

    toggle(name) {
        this.active = this.active === name ? null : name;
        this._sync();
        this.emit('changed');
    }

    _sync() {
        this.get_children().forEach((chip, i) => (chip.checked = this._names[i] === this.active));
    }
});
