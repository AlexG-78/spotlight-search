// Spotlight Search: reveal in Files and Quick Look, both over D-Bus so no GTK is needed
// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

function call(name, path, iface, method, params) {
    Gio.DBus.session.call(name, path, iface, method, params, null, Gio.DBusCallFlags.NONE, -1, null)
        .catch(e => console.error(`mbp115-spotlight: ${iface}.${method} failed: ${e}`));
}

export function reveal(uri) {
    call('org.freedesktop.FileManager1', '/org/freedesktop/FileManager1', 'org.freedesktop.FileManager1',
        'ShowItems', new GLib.Variant('(ass)', [[uri], '']));
}

// Sushi closes its window itself when asked to show the file it already shows, so Space toggles.
export function quickLook(uri) {
    call('org.gnome.NautilusPreviewer', '/org/gnome/NautilusPreviewer', 'org.gnome.NautilusPreviewer2',
        'ShowFile', new GLib.Variant('(ssbs)', [uri, '', true, '']));
}
