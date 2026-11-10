// Spotlight Search: Actions (R5): built-ins, .desktop actions, user actions, Quick Keys
// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as ParentalControls from 'resource:///org/gnome/shell/misc/parentalControlsManager.js';

import {Timers, builtinActions} from './builtins.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async');

const MAX_DESKTOP_ACTIONS = 6;

function userActionsFile() {
    return Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_config_dir(), 'mbp115-spotlight', 'actions.json']));
}

// The user's own file, but still checked: a broken entry is skipped, not a broken Spotlight.
function parseUserActions(json) {
    const list = JSON.parse(json);
    if (!Array.isArray(list))
        throw new Error('actions.json must be a list');
    return list.filter(a => typeof a?.name === 'string' && typeof a.command === 'string').map((a, i) => {
        const params = Array.isArray(a.params) ? a.params.filter(p => typeof p === 'string') : [];
        return {
            id: `user:${i}:${a.name}`,
            name: a.name,
            icon: typeof a.icon === 'string' ? a.icon : 'system-run-symbolic',
            keywords: '',
            quickKey: typeof a.quickKey === 'string' ? a.quickKey.toLowerCase() : undefined,
            params: params.map(name => ({name, hint: name})),
            // Values go into argv after parsing, so they cannot add shell syntax.
            run: values => {
                const argv = GLib.shell_parse_argv(a.command)[1]
                    .map(arg => arg.replace(/\{(\w+)\}/g, (_m, name) => values[name] ?? ''));
                Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
            },
        };
    });
}

function desktopActions() {
    const appSystem = Shell.AppSystem.get_default();
    const parental = ParentalControls.getDefault();
    const actions = [];
    for (const info of appSystem.get_installed()) {
        if (!info.should_show() || !parental.shouldShowApp(info) || !info.list_actions().length)
            continue;
        let app;
        try {
            app = appSystem.lookup_app(info.get_id()); // get_id throws on invalid file encodings
        } catch {
            continue;
        }
        if (!app)
            continue;
        for (const action of info.list_actions()) {
            actions.push({
                id: `desktop:${app.get_id()}:${action}`,
                name: `${info.get_name()}: ${info.get_action_name(action)}`,
                createIcon: size => app.create_icon_texture(size),
                keywords: '',
                run: () => app.launch_action(action, global.get_current_time(), -1),
            });
        }
    }
    return actions;
}

export class ActionsProvider {
    constructor(settings) {
        this.id = 'actions';
        this._settings = settings;
        this._timers = new Timers();
    }

    // Everything matching all terms, plus whatever the typed text is the Quick Key of.
    async search(terms, cancellable) {
        const typed = terms.join(' ').toLowerCase();
        const matches = action => action.quickKey === typed || terms.every(t =>
            `${action.name} ${action.keywords}`.toLowerCase().includes(t.toLowerCase()));
        const all = await this._actions(cancellable);
        const desktop = desktopActions().filter(matches).slice(0, MAX_DESKTOP_ACTIONS);
        return [...all.filter(matches), ...desktop].map(action => this._item(action));
    }

    // Actions view with nothing typed: built-ins and user actions, A to Z.
    async browse(cancellable) {
        const all = await this._actions(cancellable);
        return all.sort((a, b) => a.name.localeCompare(b.name)).map(action => this._item(action));
    }

    activate(item, _terms, {values = {}} = {}) {
        try {
            Promise.resolve(item.action.run(values)).catch(e => console.error(`mbp115-spotlight: ${item.name}: ${e}`));
        } catch (e) {
            console.error(`mbp115-spotlight: ${item.name}: ${e}`);
        }
    }

    destroy() {
        this._timers.destroy();
    }

    async _actions(cancellable) {
        const quickKeys = this._settings.get_value('quick-keys').deepUnpack();
        const builtins = builtinActions(this._timers);
        for (const action of builtins)
            action.quickKey = Object.keys(quickKeys).find(code => quickKeys[code] === action.id);
        let user = [];
        try {
            const [bytes] = await userActionsFile().load_contents_async(cancellable);
            user = parseUserActions(new TextDecoder().decode(bytes));
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw e;
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                console.warn(`mbp115-spotlight: ignoring actions.json: ${e.message}`);
        }
        return [...builtins, ...user];
    }

    _item(action) {
        return {
            key: `actions:${action.id}`,
            id: action.id,
            name: action.name,
            description: action.quickKey ? `Action · ${action.quickKey}` : 'Action',
            createIcon: action.createIcon ?? (size => new St.Icon({icon_name: action.icon, icon_size: size})),
            section: 'Actions',
            quickKey: action.quickKey,
            params: action.params,
            action,
            provider: this,
        };
    }
}
