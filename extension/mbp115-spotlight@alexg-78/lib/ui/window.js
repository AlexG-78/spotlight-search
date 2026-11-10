// Spotlight Search: modal window, placement, open/close rules
// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SearchBar} from './bar.js';
import {SearchController} from './controller.js';
import {Glass} from './glass.js';
import {ParamsForm} from './params.js';
import {ResultsView} from './results.js';

const PANEL_WIDTH = 680;
const PANEL_RADIUS = 26;
const TOP_FRACTION = 0.22;
const OPEN_MS = 150;
const CLOSE_MS = 120;
const OPEN_SCALE = 0.98;
const PREVIEWER = 'org.gnome.NautilusPreviewer';

// Covers the monitor under the pointer while open: clicks that miss the panel land here.
export const SpotlightWindow = GObject.registerClass(
class SpotlightWindow extends St.Widget {
    _init(extPath, settings) {
        super._init({reactive: true, visible: false, name: 'mbp115-spotlight'});
        this._grab = null;
        this._previewerFocused = false;
        this._settings = settings;

        this._panel = new St.Widget({
            style_class: 'spotlight-panel',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            pivot_point: new Graphene.Point({x: 0.5, y: 0}),
        });

        this._glass = new Glass(PANEL_RADIUS);
        this._content = new St.BoxLayout({
            style_class: 'spotlight-content',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });
        this.bar = new SearchBar(extPath);
        this.results = new ResultsView(item => this._controller.activate(item, {click: true}));
        this.params = new ParamsForm();
        this._content.add_child(this.bar);
        this._content.add_child(this.params);
        this._content.add_child(this.results);
        this._controller = new SearchController(this.bar, this.results, this.params, settings, () => this.close());
        this._panel.add_child(this._glass);
        this._panel.add_child(this._content);
        this.add_child(this._panel);

        // Only clicks outside the panel close. Stopping clicks at the panel instead would also
        // starve the click gestures of the buttons and rows inside it.
        this.connect('button-press-event', (_actor, event) => {
            if (this._panel.contains(global.stage.get_event_actor(event)))
                return Clutter.EVENT_PROPAGATE;
            this.close();
            return Clutter.EVENT_STOP;
        });
        this.connect('key-press-event', (_actor, event) => this._onKeyPress(event));
        settings.connectObject('changed::appearance', () => this._syncLook(),
            'changed::reduce-transparency', () => this._syncLook(), this);
        St.Settings.get().connectObject('notify::color-scheme', () => this._syncLook(),
            'notify::shell-color-scheme', () => this._syncLook(), this);
        this._syncLook();
        Main.layoutManager.addTopChrome(this);
    }

    get isOpen() {
        return this._grab !== null;
    }

    // Launchpad key: opens straight into a view, or closes if that view is already showing.
    toggleView(view) {
        if (this.isOpen && this._controller.view === view) {
            this.close();
            return;
        }
        this.open();
        this._controller.setView(view);
    }

    toggle() {
        if (this.isOpen)
            this.close();
        else
            this.open();
    }

    open() {
        if (this.isOpen)
            return;
        const monitor = Main.layoutManager.currentMonitor;
        const width = Math.min(PANEL_WIDTH, monitor.width - 32);
        const x = Math.round((monitor.width - width) / 2);
        const y = Math.round(monitor.height * TOP_FRACTION);
        this.set_position(monitor.x, monitor.y);
        this.set_size(monitor.width, monitor.height);
        this._panel.set_position(x, y);
        this._panel.width = width;
        this._glass.setOrigin(monitor.x + x, monitor.y + y);

        this._previewerFocused = false;
        this.remove_all_transitions();
        this._panel.remove_all_transitions();
        this.opacity = 0;
        this._panel.set_scale(OPEN_SCALE, OPEN_SCALE);
        this.show();
        // pushModal remembers the current focus to give back on close, so it must run before
        // reset() moves focus into the bar.
        this._grab = Main.pushModal(this, {actionMode: Shell.ActionMode.POPUP});
        this._controller.reset();
        this.bar.focus();
        this.ease({opacity: 255, duration: OPEN_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._panel.ease({
            scale_x: 1, scale_y: 1, duration: OPEN_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._watchCloseTriggers();
    }

    close() {
        if (!this.isOpen)
            return;
        this._unwatchCloseTriggers();
        this._controller.cancel();
        // popModal hands key focus back to whatever had it, so the previous window keeps focus.
        Main.popModal(this._grab);
        this._grab = null;
        this.ease({
            opacity: 0,
            duration: CLOSE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => {
                if (!this.isOpen)
                    this.hide();
            },
        });
    }

    _watchCloseTriggers() {
        const close = () => this.close();
        Main.overview.connectObject('showing', close, this);
        Main.sessionMode.connectObject('updated', close, this);
        global.display.connectObject('notify::focus-window', () => {
            // Quick Look's window takes focus and later hands it back; neither means Spotlight lost it.
            const previewer = global.display.focus_window?.get_wm_class() === PREVIEWER;
            if (!previewer && !this._previewerFocused)
                this.close();
            this._previewerFocused = previewer;
        }, this);
        global.stage.connectObject('notify::key-focus', () => {
            const focus = global.stage.get_key_focus();
            if (!focus || !this.contains(focus))
                this.close();
        }, this);
    }

    _unwatchCloseTriggers() {
        Main.overview.disconnectObject(this);
        Main.sessionMode.disconnectObject(this);
        global.display.disconnectObject(this);
        global.stage.disconnectObject(this);
    }

    // Light or dark follows the Shell's own style variant unless prefs pin one.
    _syncLook() {
        const appearance = this._settings.get_string('appearance');
        const light = appearance === 'auto' ? Main.getStyleVariant() === 'light' : appearance === 'light';
        const solid = this._settings.get_boolean('reduce-transparency');
        this[light ? 'add_style_class_name' : 'remove_style_class_name']('spotlight-light');
        this[solid ? 'add_style_class_name' : 'remove_style_class_name']('spotlight-solid');
        this._glass.visible = !solid;
    }

    _onKeyPress(event) {
        if (event.get_key_symbol() !== Clutter.KEY_Escape)
            return Clutter.EVENT_PROPAGATE;
        if (!this._controller.escape())
            this.close();
        return Clutter.EVENT_STOP;
    }

    destroy() {
        this.close();
        this._settings.disconnectObject(this);
        St.Settings.get().disconnectObject(this);
        this._controller.destroy();
        // Destroying also untracks the chrome, so no removeChrome.
        super.destroy();
    }
});
