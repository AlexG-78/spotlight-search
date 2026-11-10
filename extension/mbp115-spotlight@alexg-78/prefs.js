// Spotlight Search: preferences (R7)
// SPDX-License-Identifier: GPL-3.0-or-later
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {quickKeysPage} from './lib/prefs/quickKeys.js';

const ENGINES = [
    ['DuckDuckGo', 'https://duckduckgo.com/?q=%s'],
    ['Google', 'https://www.google.com/search?q=%s'],
    ['Bing', 'https://www.bing.com/search?q=%s'],
    ['Startpage', 'https://www.startpage.com/do/search?q=%s'],
    ['Ecosia', 'https://www.ecosia.org/search?q=%s'],
];
const RETENTION = [['30 minutes', 30], ['8 hours', 480], ['7 days', 10080]];

// A combo row over a fixed list; values[i] is stored for item i.
function comboRow(title, labels, selected, onSelect, subtitle = '') {
    const row = new Adw.ComboRow({title, subtitle, model: Gtk.StringList.new(labels), selected: Math.max(selected, 0)});
    row.connect('notify::selected', () => onSelect(row.selected));
    return row;
}

// The first accelerator of a key; an invalid one is refused with the error style.
function shortcutRow(settings, key, title) {
    const row = new Adw.EntryRow({title, text: settings.get_strv(key)[0] ?? '', show_apply_button: true});
    row.connect('apply', () => {
        const [ok, keyval] = Gtk.accelerator_parse(row.text);
        if (row.text && (!ok || !keyval)) {
            row.add_css_class('error');
            return;
        }
        row.remove_css_class('error');
        settings.set_strv(key, row.text ? [row.text] : []);
    });
    return row;
}

function group(title, rows, description = '') {
    const g = new Adw.PreferencesGroup({title, description});
    rows.forEach(r => g.add(r));
    return g;
}

export default class SpotlightPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.add(this._generalPage(settings));
        window.add(this._clipboardPage(settings));
        window.add(quickKeysPage(settings));
    }

    _generalPage(settings) {
        const page = new Adw.PreferencesPage({title: 'General', icon_name: 'preferences-system-symbolic'});
        page.add(group('Shortcuts', [
            shortcutRow(settings, 'toggle-spotlight', 'Open Spotlight'),
            shortcutRow(settings, 'show-apps', 'Open the Apps view'),
        ], 'For example &lt;Control&gt;space or XF86LaunchB. Press Enter to apply.'));

        const panelIcon = new Adw.SwitchRow({title: 'Show in top bar', subtitle: 'A magnifier that opens Spotlight'});
        settings.bind('show-panel-icon', panelIcon, 'active', Gio.SettingsBindFlags.DEFAULT);
        const looks = ['auto', 'light', 'dark'];
        const transparency = new Adw.SwitchRow({title: 'Reduce transparency', subtitle: 'Solid background without blur'});
        settings.bind('reduce-transparency', transparency, 'active', Gio.SettingsBindFlags.DEFAULT);
        page.add(group('Appearance', [
            comboRow('Style', ['Follow system', 'Light', 'Dark'], looks.indexOf(settings.get_string('appearance')),
                i => settings.set_string('appearance', looks[i])),
            transparency,
            panelIcon,
        ]));

        const url = new Adw.EntryRow({title: 'Search URL, %s is the query'});
        settings.bind('web-search-url', url, 'text', Gio.SettingsBindFlags.DEFAULT);
        const current = ENGINES.findIndex(([, u]) => u === settings.get_string('web-search-url'));
        const engine = comboRow('Web search', [...ENGINES.map(([name]) => name), 'Custom'],
            current < 0 ? ENGINES.length : current,
            i => i < ENGINES.length && settings.set_string('web-search-url', ENGINES[i][1]));
        const locations = new Adw.ActionRow({
            title: 'File search locations',
            subtitle: 'Files are found through the system search index',
            activatable: true,
        });
        locations.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
        locations.connect('activated', () => Gio.Subprocess.new(['gnome-control-center', 'search'], Gio.SubprocessFlags.NONE));
        page.add(group('Search', [engine, url, locations]));
        return page;
    }

    _clipboardPage(settings) {
        const page = new Adw.PreferencesPage({title: 'Clipboard', icon_name: 'edit-paste-symbolic'});
        const history = new Adw.SwitchRow({title: 'Clipboard history', subtitle: 'Turning it off deletes the history'});
        settings.bind('clipboard-history', history, 'active', Gio.SettingsBindFlags.DEFAULT);
        const retention = comboRow('Keep items for', RETENTION.map(([label]) => label),
            RETENTION.findIndex(([, m]) => m === settings.get_int('clipboard-retention')),
            i => settings.set_int('clipboard-retention', RETENTION[i][1]));
        const clear = new Adw.ButtonRow({title: 'Clear History'});
        clear.add_css_class('destructive-action');
        // The Shell deletes the history when it is turned off, so off and on again clears it.
        clear.connect('activated', () => {
            settings.set_boolean('clipboard-history', false);
            settings.set_boolean('clipboard-history', true);
        });
        settings.bind('clipboard-history', retention, 'sensitive', Gio.SettingsBindFlags.GET);
        settings.bind('clipboard-history', clear, 'sensitive', Gio.SettingsBindFlags.GET);
        page.add(group('History', [history, retention, clear]));

        const apps = new Adw.EntryRow({
            title: 'Never record copies from (comma separated)',
            text: settings.get_strv('clipboard-ignore-apps').join(', '),
            show_apply_button: true,
        });
        apps.connect('apply', () => settings.set_strv('clipboard-ignore-apps',
            apps.text.split(',').map(s => s.trim()).filter(s => s)));
        page.add(group('Privacy', [apps],
            'Copies marked secret by password managers, keys, tokens, card numbers and generated passwords are ' +
            'never recorded. Copies from these apps are skipped too; names match window classes and app ids.'));
        return page;
    }
}
