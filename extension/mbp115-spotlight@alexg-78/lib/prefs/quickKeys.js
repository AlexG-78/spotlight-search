// Spotlight Search: Quick Keys editor (R5.5). Prefs side only: no St, Clutter, Meta or Shell here.
// SPDX-License-Identifier: GPL-3.0-or-later
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

// The built-in action ids from lib/providers/builtins.js, with the names the Shell shows.
const ACTIONS = [
    ['timer', 'Set Timer'], ['email', 'New Email'], ['note', 'New Note'],
    ['lock-screen', 'Lock Screen'], ['logout', 'Log Out'], ['suspend', 'Suspend'],
    ['restart', 'Restart'], ['power-off', 'Power Off'], ['open-screenshot-ui', 'Take a Screenshot'],
    ['dark-mode', 'Dark Mode'], ['wifi', 'Wi-Fi'], ['bluetooth', 'Bluetooth'],
    ['dnd', 'Do Not Disturb'], ['night-light', 'Night Light'], ['empty-trash', 'Empty Trash'],
];

const USER_ACTIONS_EXAMPLE = `[
  {"name": "Open Project", "command": "code {path}", "quickKey": "op", "params": ["path"]}
]
`;

function codesById(settings) {
    const map = settings.get_value('quick-keys').deepUnpack();
    return Object.fromEntries(Object.entries(map).map(([code, id]) => [id, code]));
}

// One row per action; its text is the code. A code already used elsewhere is refused.
export function quickKeysPage(settings) {
    const page = new Adw.PreferencesPage({title: 'Quick Keys', icon_name: 'input-keyboard-symbolic'});
    const builtins = new Adw.PreferencesGroup({
        title: 'Actions',
        description: 'Type the code in Spotlight and the action becomes the Top Hit. Press Enter to apply, ' +
            'leave empty for none.',
    });
    const codes = codesById(settings);
    for (const [id, name] of ACTIONS) {
        const row = new Adw.EntryRow({title: name, text: codes[id] ?? '', show_apply_button: true});
        row.connect('apply', () => {
            const code = row.text.trim().toLowerCase();
            const map = settings.get_value('quick-keys').deepUnpack();
            if (code && map[code] && map[code] !== id) {
                row.add_css_class('error');
                return;
            }
            row.remove_css_class('error');
            for (const [c, action] of Object.entries(map)) {
                if (action === id)
                    delete map[c];
            }
            if (code)
                map[code] = id;
            settings.set_value('quick-keys', new GLib.Variant('a{ss}', map));
        });
        builtins.add(row);
    }
    page.add(builtins);

    const file = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_config_dir(), 'mbp115-spotlight', 'actions.json']));
    const custom = new Adw.ActionRow({
        title: 'Custom actions',
        subtitle: 'actions.json: name, command, optional icon, quickKey and params',
        activatable: true,
    });
    custom.add_suffix(new Gtk.Image({icon_name: 'document-edit-symbolic'}));
    custom.connect('activated', () => {
        // Start the file with an example, so there is something to edit.
        if (!file.query_exists(null)) {
            GLib.mkdir_with_parents(file.get_parent().get_path(), 0o700);
            file.replace_contents(new TextEncoder().encode(USER_ACTIONS_EXAMPLE), null, false,
                Gio.FileCreateFlags.PRIVATE, null);
        }
        Gio.AppInfo.launch_default_for_uri(file.get_uri(), null);
    });
    const userGroup = new Adw.PreferencesGroup({title: 'Your actions'});
    userGroup.add(custom);
    page.add(userGroup);
    return page;
}
