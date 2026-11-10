// Spotlight Search: macOS 27 style Spotlight for GNOME Shell 51
// Based on Spotlight by itsnin (https://github.com/itsnin/spotlight)
// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {SpotlightWindow} from './lib/ui/window.js';

export default class SpotlightExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._window = new SpotlightWindow(this.path, this._settings);
        // POPUP is our own modal mode, so the same shortcut closes Spotlight again.
        Main.wm.addKeybinding('toggle-spotlight', this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.POPUP, () => this._window.toggle());
        Main.wm.addKeybinding('show-apps', this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.POPUP, () => this._window.toggleView('apps'));
        this._settings.connectObject('changed::show-panel-icon', () => this._syncIcon(), this);
        this._syncIcon();
    }

    // The magnifier in the top bar, like macOS's menu bar Spotlight icon. A click opens Spotlight.
    _syncIcon() {
        this._icon?.destroy();
        this._icon = null;
        if (!this._settings.get_boolean('show-panel-icon'))
            return;
        this._icon = new PanelMenu.Button(0.0, 'Spotlight Search', true);
        this._icon.add_child(new St.Icon({icon_name: 'edit-find-symbolic', style_class: 'system-status-icon'}));
        const click = new Clutter.ClickGesture();
        click.connect('recognize', () => this._window.toggle());
        this._icon.add_action(click);
        Main.panel.addToStatusArea(this.uuid, this._icon);
    }

    disable() {
        this._settings.disconnectObject(this);
        this._icon?.destroy();
        this._icon = null;
        Main.wm.removeKeybinding('toggle-spotlight');
        Main.wm.removeKeybinding('show-apps');
        this._window.destroy();
        this._window = null;
        this._settings = null;
    }
}
