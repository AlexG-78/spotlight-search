// Spotlight Search: Top Hit, result sections, and keyboard selection
// SPDX-License-Identifier: GPL-3.0-or-later
import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {ensureActorVisibleInScrollView} from 'resource:///org/gnome/shell/misc/animationUtils.js';

import {FilterChips} from './chips.js';
import {GRID_COLUMNS, GridCell} from './grid.js';

const ROW_ICON = 32;
const HIT_ICON = 48;

const ResultRow = GObject.registerClass(
class ResultRow extends St.Button {
    _init(item, isHit) {
        super._init({
            style_class: isHit ? 'spotlight-row spotlight-tophit' : 'spotlight-row',
            accessible_name: item.description ? `${item.name}, ${item.description}` : item.name,
            accessible_role: Atk.Role.LIST_ITEM,
            can_focus: false,
            x_expand: true,
        });
        this.item = item;
        const size = isHit ? HIT_ICON : ROW_ICON;
        const box = new St.BoxLayout({style_class: 'spotlight-row-box', x_expand: true});
        const icon = item.createIcon(size) ?? new St.Icon({icon_name: 'text-x-generic', icon_size: size});
        icon.y_align = Clutter.ActorAlign.CENTER;
        box.add_child(icon);
        const text = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        text.add_child(new St.Label({style_class: 'spotlight-row-name', text: item.name}));
        if (item.description)
            text.add_child(new St.Label({style_class: 'spotlight-row-desc', text: item.description}));
        box.add_child(text);
        this.set_child(box);
    }
});

export const ResultsView = GObject.registerClass(
class ResultsView extends St.BoxLayout {
    _init(onActivate) {
        super._init({orientation: Clutter.Orientation.VERTICAL, x_expand: true, visible: false});
        this._onActivate = onActivate;
        this._model = null;
        this._rows = [];
        this._selected = -1;
        this._userMoved = false;
        this._grid = true;

        this.chips = new FilterChips();
        this.chips.x_expand = true;
        this.chips.connect('changed', () => this._render());
        this._layoutToggle = new St.Button({
            style_class: 'spotlight-layout-toggle',
            can_focus: true,
            visible: false,
            y_align: Clutter.ActorAlign.START,
            child: new St.Icon({icon_name: 'view-list-symbolic'}),
        });
        this._layoutToggle.connect('clicked', () => {
            this._grid = !this._grid;
            this._render();
        });
        const header = new St.BoxLayout({x_expand: true});
        header.add_child(this.chips);
        header.add_child(this._layoutToggle);
        this._list = new St.BoxLayout({
            style_class: 'spotlight-results',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this._scroll = new St.ScrollView({
            style_class: 'spotlight-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            child: this._list,
        });
        this.add_child(header);
        this.add_child(this._scroll);
    }

    get selectedItem() {
        return this._rows[this._selected]?.item ?? null;
    }

    get userMoved() {
        return this._userMoved;
    }

    // A new query selects the Top Hit again; later answers to the same query keep a moved selection.
    resetSelection() {
        this._userMoved = false;
    }

    setModel(model) {
        this._model = model;
        const names = model ? [model.topHit, ...model.sections].filter(s => s) : [];
        this.chips.setSections(model?.apps ? model.categories : [...new Set(names.map(s => s.section ?? s.name))]
            .filter(name => name !== 'Web'));
        this._layoutToggle.visible = Boolean(model?.apps);
        this._render();
    }

    // In the Apps grid vertical moves jump a row; elsewhere horizontal moves are not ours (false).
    moveSelection(delta, horizontal = false) {
        const grid = Boolean(this._model?.apps) && this._grid;
        if (horizontal && !grid)
            return false;
        if (!this._rows.length)
            return true;
        this._userMoved = true;
        const step = grid && !horizontal ? delta * GRID_COLUMNS : delta;
        this._select(Math.max(0, Math.min(this._rows.length - 1, this._selected + step)));
        ensureActorVisibleInScrollView(this._scroll, this._rows[this._selected]);
        return true;
    }

    _render() {
        const key = this.selectedItem?.key;
        this._list.destroy_all_children();
        this._rows = [];
        const model = this._model;
        this.visible = model !== null;
        if (!model)
            return;

        const filter = this.chips.active;
        this._layoutToggle.child.icon_name = this._grid ? 'view-list-symbolic' : 'view-app-grid-symbolic';
        this._layoutToggle.accessible_name = this._grid ? 'Show as list' : 'Show as grid';
        if (model.apps) {
            const apps = filter ? model.apps.filter(app => app.category === filter) : model.apps;
            if (this._grid)
                this._addGrid(apps);
            else
                this._addSection('Applications', apps);
        } else if (filter) {
            const items = model.sections.find(s => s.name === filter)?.items ?? [];
            this._addSection(filter, model.topHit?.section === filter ? [model.topHit, ...items] : items);
        } else {
            if (model.topHit)
                this._addSection('Top Hit', [model.topHit], true);
            for (const section of model.sections)
                this._addSection(section.name, section.items);
        }
        const kept = this._userMoved ? this._rows.findIndex(r => r.item.key === key) : -1;
        this._select(Math.max(kept, 0));
    }

    _addSection(name, items, isHit = false) {
        if (!items.length)
            return;
        this._list.add_child(new St.Label({style_class: 'spotlight-section', text: name}));
        for (const item of items) {
            const row = new ResultRow(item, isHit);
            row.connect('clicked', () => this._onActivate(item));
            this._list.add_child(row);
            this._rows.push(row);
        }
    }

    _addGrid(items) {
        for (let i = 0; i < items.length; i += GRID_COLUMNS) {
            const row = new St.BoxLayout({style_class: 'spotlight-grid-row'});
            for (const item of items.slice(i, i + GRID_COLUMNS)) {
                const cell = new GridCell(item);
                cell.connect('clicked', () => this._onActivate(item));
                row.add_child(cell);
                this._rows.push(cell);
            }
            this._list.add_child(row);
        }
    }

    // Selection is not key focus (that stays in the bar), so screen readers get it as a state.
    _select(index) {
        this._rows[this._selected]?.remove_style_pseudo_class('selected');
        this._rows[this._selected]?.remove_accessible_state(Atk.StateType.SELECTED);
        this._selected = index;
        const row = this._rows[index];
        if (!row)
            return;
        row.add_style_pseudo_class('selected');
        row.add_accessible_state(Atk.StateType.SELECTED);
    }
});
