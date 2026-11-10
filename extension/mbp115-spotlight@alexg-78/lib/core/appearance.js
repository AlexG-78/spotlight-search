// Spotlight Search: dark/light switch that also flips fixed-variant GTK and icon themes like WhiteSur-Dark
// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// "WhiteSur-Dark" -> "WhiteSur-Light" and back, keeping the case of the suffix.
export function swapVariant(name, dark) {
    const [from, to] = dark ? ['light', 'dark'] : ['dark', 'light'];
    return name.replace(new RegExp(`-${from}$`, 'i'), m =>
        `-${m[1] === m[1].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to}`);
}

// kind is 'themes' or 'icons'; ~/.themes and ~/.icons are the legacy places for each.
function themeExists(name, kind) {
    const dataDirs = [GLib.get_user_data_dir(), ...GLib.get_system_data_dirs()];
    return [`${GLib.get_home_dir()}/.${kind}`, ...dataDirs.map(dir => `${dir}/${kind}`)]
        .some(dir => GLib.file_test(`${dir}/${name}`, GLib.FileTest.IS_DIR));
}

function swapSetting(settings, key, dark, kind) {
    const name = settings.get_string(key);
    const swapped = swapVariant(name, dark);
    if (swapped !== name && themeExists(swapped, kind))
        settings.set_string(key, swapped);
}

// Themes like WhiteSur install gtk.css for GTK 4 as a link to their dark or light file, which
// apps read once at start. One file holding both under prefers-color-scheme media queries
// (GTK 4.16+) lets running apps follow color-scheme live. A theme reinstall resets the link,
// so this runs on every switch and rebuilds the file then.
function linkAutoGtk4Css() {
    const dir = `${GLib.get_user_config_dir()}/gtk-4.0`;
    const link = Gio.File.new_for_path(`${dir}/gtk.css`);
    const target = GLib.file_read_link(link.get_path());
    if (!/gtk-(Dark|Light)\.css$/.test(target))
        return;
    const variants = target.replace(/gtk-(Dark|Light)\.css$/, 'gtk-%s.css');
    const read = name => new TextDecoder().decode(GLib.file_get_contents(variants.replace('%s', name))[1]);
    const css = `/* Built by Spotlight Search from ${variants.replace('%s', 'Light|Dark')} */\n` +
        `@media (prefers-color-scheme: light) {\n${read('Light')}\n}\n` +
        `@media (prefers-color-scheme: dark) {\n${read('Dark')}\n}\n`;
    const auto = `${dir}/gtk-auto.css`;
    GLib.file_set_contents(auto, css);
    link.delete(null);
    link.make_symbolic_link(auto, null);
}

// The shell theme stays as it is, like with GNOME's own Dark Style: the kit keeps the top bar and menus dark in both styles.
export function setDarkMode(dark) {
    Main.layoutManager.screenTransition.run();
    const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    iface.set_string('color-scheme', dark ? 'prefer-dark' : 'default');
    swapSetting(iface, 'gtk-theme', dark, 'themes');
    swapSetting(iface, 'icon-theme', dark, 'icons');
    try {
        linkAutoGtk4Css();
    } catch {
        // No gtk.css link, or a variant file is missing: leave it alone.
    }
}
