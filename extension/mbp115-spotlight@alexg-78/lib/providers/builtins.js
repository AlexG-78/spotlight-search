// Spotlight Search: built-in actions (power, toggles, timer, email, note, trash)
// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

import {setDarkMode} from '../core/appearance.js';

const NOTE_APP = 'org.gnome.TextEditor.desktop';

// "90s", "5m", "1h30m", or a bare number of minutes. Null when it is none of these.
export function parseDuration(text) {
    const t = text.trim().toLowerCase();
    if (/^\d+$/.test(t))
        return Number(t) * 60;
    const m = t.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s)?$/);
    if (!m || !t)
        return null;
    return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

async function toggleProperty(bus, name, path, iface, property) {
    const props = 'org.freedesktop.DBus.Properties';
    const [value] = (await bus.call(name, path, props, 'Get', new GLib.Variant('(ss)', [iface, property]),
        null, Gio.DBusCallFlags.NONE, -1, null)).deepUnpack();
    await bus.call(name, path, props, 'Set', new GLib.Variant('(ssv)', [iface, property, GLib.Variant.new_boolean(!value.unpack())]),
        null, Gio.DBusCallFlags.NONE, -1, null);
}

function toggleSetting(schema, key) {
    const settings = new Gio.Settings({schema_id: schema});
    settings.set_boolean(key, !settings.get_boolean(key));
}

// Running timers belong to the provider, so disable() can remove their main-loop sources.
export class Timers {
    constructor() {
        this._ids = new Set();
    }

    start(seconds) {
        const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._ids.delete(id);
            const source = MessageTray.getSystemSource();
            const notification = new MessageTray.Notification({
                source, title: 'Timer', body: 'Your timer has finished.',
                urgency: MessageTray.Urgency.HIGH,
            });
            source.addNotification(notification);
            global.display.get_sound_player().play_from_theme('complete', 'Timer finished', null);
            return GLib.SOURCE_REMOVE;
        });
        this._ids.add(id);
    }

    destroy() {
        this._ids.forEach(id => GLib.source_remove(id));
        this._ids.clear();
    }
}

// Each action: id, name, icon, keywords, optional params, and run(values).
export function builtinActions(timers) {
    const system = SystemActions.getDefault();
    const fromSystem = (id, available) => available ? [{
        id, name: system.getName(id), icon: system.getIconName(id), keywords: '',
        run: () => system.activateAction(id),
    }] : [];
    const note = Shell.AppSystem.get_default().lookup_app(NOTE_APP);
    const dark = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'})
        .get_string('color-scheme') === 'prefer-dark';
    return [
        ...fromSystem('lock-screen', system.canLockScreen),
        ...fromSystem('logout', system.canLogout),
        ...fromSystem('suspend', system.canSuspend),
        ...fromSystem('restart', system.canRestart),
        ...fromSystem('power-off', system.canPowerOff),
        ...fromSystem('open-screenshot-ui', true),
        {
            id: 'wifi', name: 'Toggle Wi-Fi', icon: 'network-wireless-symbolic', keywords: 'wlan wireless network',
            run: () => toggleProperty(Gio.DBus.system, 'org.freedesktop.NetworkManager',
                '/org/freedesktop/NetworkManager', 'org.freedesktop.NetworkManager', 'WirelessEnabled'),
        },
        {
            // gsd-rfkill's airplane mode is what the Bluetooth quick toggle switches too.
            id: 'bluetooth', name: 'Toggle Bluetooth', icon: 'bluetooth-active-symbolic', keywords: '',
            run: () => toggleProperty(Gio.DBus.session, 'org.gnome.SettingsDaemon.Rfkill',
                '/org/gnome/SettingsDaemon/Rfkill', 'org.gnome.SettingsDaemon.Rfkill', 'BluetoothAirplaneMode'),
        },
        {
            id: 'dark-mode', name: `Turn Dark Mode ${dark ? 'Off' : 'On'}`, icon: 'dark-mode-symbolic',
            keywords: 'appearance light theme',
            run: () => setDarkMode(!dark),
        },
        {
            id: 'dnd', name: 'Toggle Do Not Disturb', icon: 'notifications-disabled-symbolic', keywords: 'notifications focus',
            // DND is "banners off".
            run: () => toggleSetting('org.gnome.desktop.notifications', 'show-banners'),
        },
        {
            id: 'night-light', name: 'Toggle Night Light', icon: 'night-light-symbolic', keywords: 'blue light',
            run: () => toggleSetting('org.gnome.settings-daemon.plugins.color', 'night-light-enabled'),
        },
        {
            id: 'timer', name: 'Set Timer', icon: 'alarm-symbolic', keywords: 'countdown clock',
            params: [{name: 'duration', hint: 'Duration, e.g. 5m'}],
            run: ({duration}) => {
                const seconds = parseDuration(duration ?? '');
                if (seconds)
                    timers.start(seconds);
                else
                    Main.notify('Timer', `“${duration}” is not a duration. Try 90s, 5m or 1h30m.`);
            },
        },
        {
            id: 'email', name: 'New Email', icon: 'mail-message-new-symbolic', keywords: 'mail message',
            params: [{name: 'to', hint: 'To'}, {name: 'subject', hint: 'Subject'}],
            run: ({to = '', subject = ''}) => Gio.AppInfo.launch_default_for_uri(
                `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(subject)}`, null),
        },
        ...note ? [{
            id: 'note', name: 'New Note', icon: 'document-new-symbolic', keywords: 'text editor',
            run: () => note.open_new_window(-1),
        }] : [],
        {
            // Nautilus asks for confirmation itself, the same dialog as its own Empty Trash.
            id: 'empty-trash', name: 'Empty Trash', icon: 'user-trash-symbolic', keywords: 'bin delete',
            run: () => Gio.DBus.session.call('org.gnome.Nautilus', '/org/gnome/Nautilus/FileOperations2',
                'org.gnome.Nautilus.FileOperations2', 'EmptyTrash', new GLib.Variant('(ba{sv})', [true, {}]),
                null, Gio.DBusCallFlags.NONE, -1, null),
        },
    ];
}
