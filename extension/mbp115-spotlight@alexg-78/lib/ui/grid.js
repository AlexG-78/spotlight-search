// Spotlight Search: one app tile in the Apps grid
// SPDX-License-Identifier: GPL-3.0-or-later
import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

export const GRID_COLUMNS = 6;
const GRID_ICON = 64;

export const GridCell = GObject.registerClass(
class GridCell extends St.Button {
    _init(item) {
        super._init({style_class: 'spotlight-cell', accessible_name: item.name, accessible_role: Atk.Role.LIST_ITEM, can_focus: false});
        this.item = item;
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        const icon = item.createIcon(GRID_ICON);
        icon.x_align = Clutter.ActorAlign.CENTER;
        box.add_child(icon);
        box.add_child(new St.Label({style_class: 'spotlight-cell-name', text: item.name, x_align: Clutter.ActorAlign.CENTER}));
        this.set_child(box);
    }
});
