// Spotlight Search: turns typing, keys and clicks into queries, views and activations
// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';

import {quickLook} from '../core/fileActions.js';
import {SearchEngine} from '../core/search.js';

// Ctrl+1…4 on an empty bar, like ⌘1…4 on macOS. With a query they pick filter chips instead.
const VIEWS = ['apps', 'files', 'actions', 'clipboard'];

export class SearchController {
    constructor(bar, results, params, settings, close) {
        this._bar = bar;
        this._results = results;
        this._params = params;
        this._close = close;
        this._engine = new SearchEngine(settings);
        this._view = null;
        this._scope = null;
        this._terms = [];
        this._query = '';

        bar.entry.clutter_text.connectObject(
            'text-changed', () => this._search(),
            'activate', () => this._activateSelected(),
            // Connected handlers run before ClutterText's own, so arrows and Tab reach us first.
            'key-press-event', (_actor, event) => this._onKey(event),
            this);
        // ClutterText consumes Backspace, Return, Space and Left/Right (via the input method or
        // its own bindings) before key-press-event, so they are taken on the event's way down.
        // Shift+Return is not an activate for ClutterText at all.
        bar.entry.connectObject('captured-event', (_actor, event) => this._onCaptured(event), this);
        bar.connectObject('browse', (_bar, view) => this.setView(view === this._view ? null : view), this);
        params.connectObject('run', () => this.activate(params.item, {values: params.values}), this);
    }

    get view() {
        return this._view;
    }

    reset() {
        this.setView(null);
    }

    setView(view) {
        this._view = view;
        this._scope = null;
        // Focus leaves the fields before they go, or the window sees focus loss and closes.
        this._bar.focus();
        this._params.clear();
        this._bar.setView(view);
        this._bar.setToken(null);
        this._bar.reset();
        this._search();
        this._bar.focus();
    }

    // Esc steps back one level: query, folder token, view. False when nothing was left to clear.
    escape() {
        if (this._params.active)
            this._leaveParams();
        else if (this._bar.text)
            this._bar.reset();
        else if (this._scope)
            this._setScope(null);
        else if (this._view)
            this.setView(null);
        else
            return false;
        return true;
    }

    // An action with inputs asks for them first (R5.4); the form calls back with their values.
    activate(item, params = {}) {
        if (item.params?.length && !params.values) {
            this._enterParams(item);
            return;
        }
        if (item.keepOpen) {
            this._engine.activate(item, this._terms, params);
            this._search();
            return;
        }
        // Close first: popModal must hand focus back before the launched app asks for it.
        this._close();
        this._engine.activate(item, this._terms, params);
    }

    cancel() {
        this._engine.cancel();
    }

    destroy() {
        this._bar.entry.clutter_text.disconnectObject(this);
        this._bar.entry.disconnectObject(this);
        this._bar.disconnectObject(this);
        this._params.disconnectObject(this);
        this._engine.destroy();
    }

    _search() {
        if (this._params.active)
            return;
        this._terms = this._bar.text.trim().split(/\s+/).filter(t => t);
        this._results.resetSelection();
        // Folder completion needs no index, so it must not wait for localsearch.
        if (this._view === 'files' && !this._scope)
            this._bar.setCompletion(this._engine.files.folderCompletion(this._bar.text));
        this._engine.run({text: this._bar.text, view: this._view, scope: this._scope?.uri}, model => {
            this._results.setModel(model);
            this._bar.setCompletion(model?.completion ?? null);
        });
    }

    _enterParams(item) {
        // Late provider answers must not bring the results back over the form.
        this._engine.cancel();
        this._results.visible = false;
        this._bar.setToken(item.name);
        this._params.show(item);
        // The action is chosen, so its name replaces the query (as a token); Esc brings it back.
        this._query = this._bar.text;
        this._bar.reset();
    }

    _leaveParams() {
        this._bar.focus();
        this._params.clear();
        this._bar.setToken(this._scope?.name ?? null);
        this._bar.entry.set_text(this._query);
        this._search(); // set_text stays silent when the query was empty
    }

    _setScope(folder) {
        this._scope = folder;
        this._bar.setToken(folder?.name ?? null);
        this._bar.reset();
        this._search();
    }

    _activateSelected(reveal = false) {
        const item = this._results.selectedItem;
        if (item)
            this.activate(item, {reveal});
    }

    _onCaptured(event) {
        if (event.type() !== Clutter.EventType.KEY_PRESS)
            return Clutter.EVENT_PROPAGATE;
        const symbol = event.get_key_symbol();
        const empty = this._bar.text === '';
        if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
            const delta = symbol === Clutter.KEY_Left ? -1 : 1;
            const handled = this._results.moveSelection(delta, true) ||
                (delta > 0 && this._bar.cursorAtEnd && this._bar.acceptCompletion());
            return handled ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        }
        if ((symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) &&
            event.get_state() & Clutter.ModifierType.SHIFT_MASK) {
            this._activateSelected(true);
            return Clutter.EVENT_STOP;
        }
        // Ctrl+Backspace (⌘⌫) forgets a picked clipboard entry, like moving it to the trash.
        const picked = this._results.selectedItem;
        if (symbol === Clutter.KEY_BackSpace && event.get_state() & Clutter.ModifierType.CONTROL_MASK &&
            picked?.entry && (empty || this._results.userMoved)) {
            picked.provider.forget(picked);
            this._search();
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_BackSpace && empty && this._scope) {
            this._setScope(null);
            return Clutter.EVENT_STOP;
        }
        // Space types a space until a file was picked with the arrows (or nothing is typed).
        const item = this._results.selectedItem;
        if (symbol === Clutter.KEY_space && item?.uri && (empty || this._results.userMoved)) {
            quickLook(item.uri);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onKey(event) {
        const symbol = event.get_key_symbol();
        const empty = this._bar.text === '';
        if (event.get_state() & Clutter.ModifierType.CONTROL_MASK) {
            const index = symbol - Clutter.KEY_1;
            if (index < 0 || index > 8)
                return Clutter.EVENT_PROPAGATE;
            if (empty && !this._scope && index < VIEWS.length)
                this.setView(VIEWS[index] === this._view ? null : VIEWS[index]);
            else
                this._results.chips.toggleIndex(index);
            return Clutter.EVENT_STOP;
        }
        switch (symbol) {
        case Clutter.KEY_Up:
        case Clutter.KEY_Down:
            this._results.moveSelection(symbol === Clutter.KEY_Up ? -1 : 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Tab:
        case Clutter.KEY_ISO_Left_Tab: {
            if (this._results.selectedItem?.params?.length) {
                this._enterParams(this._results.selectedItem);
                return Clutter.EVENT_STOP;
            }
            this._bar.acceptCompletion();
            const folder = this._view === 'files' && !this._scope
                ? this._engine.files.folderFor(this._bar.text) : null;
            if (folder)
                this._setScope(folder);
            return Clutter.EVENT_STOP;
        }
        }
        return Clutter.EVENT_PROPAGATE;
    }
}
