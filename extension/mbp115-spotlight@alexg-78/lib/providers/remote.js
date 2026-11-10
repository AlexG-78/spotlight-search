// Spotlight Search: GNOME remote search providers (Settings, Calculator, Files, and any others installed)
// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as RemoteSearch from 'resource:///org/gnome/shell/ui/remoteSearch.js';

const MAX_RESULTS = 5;
const NAUTILUS = 'org.gnome.Nautilus.desktop';
const SECTIONS = {
    'org.gnome.Settings.desktop': 'Settings',
    'org.gnome.Calculator.desktop': 'Calculator',
};

// Nautilus returns plain URIs; split them into Documents and Folders like Spotlight does.
async function classify(item, cancellable) {
    try {
        const info = await Gio.File.new_for_uri(item.id).query_info_async('standard::type',
            Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable);
        item.section = info.get_file_type() === Gio.FileType.DIRECTORY ? 'Folders' : 'Documents';
    } catch {
        item.section = 'Documents';
    }
}

class RemoteProvider {
    constructor(provider) {
        this._provider = provider;
        this.id = provider.id;
        this.section = SECTIONS[this.id] ?? provider.appInfo.get_name();
    }

    async search(terms, cancellable) {
        const results = await this._provider.getInitialResultSet(terms, cancellable);
        const ids = this._provider.filterResults(results, MAX_RESULTS);
        if (!ids.length || cancellable.is_cancelled())
            return [];
        const metas = await this._provider.getResultMetas(ids, cancellable);
        const items = metas.map(meta => ({
            key: `${this.id}:${meta.id}`,
            id: meta.id,
            name: meta.name,
            description: meta.description ?? '',
            createIcon: meta.createIcon,
            clipboardText: meta.clipboardText,
            section: this.section,
            provider: this,
            uri: this.id === NAUTILUS ? meta.id : undefined,
        }));
        if (this.id === NAUTILUS)
            await Promise.all(items.map(item => classify(item, cancellable)));
        return items;
    }

    activate(item, terms) {
        // Calculator answers carry clipboardText: copying is the whole action (R2.7).
        if (item.clipboardText)
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, item.clipboardText);
        else
            this._provider.activateResult(item.id, terms);
    }
}

export class RemoteProviders {
    constructor() {
        this._settings = new Gio.Settings({schema_id: 'org.gnome.desktop.search-providers'});
        this._settings.connectObject('changed', () => this._load(), this);
        Shell.AppSystem.get_default().connectObject('installed-changed', () => this._load(), this);
        this._load();
    }

    _load() {
        this.providers = RemoteSearch.loadRemoteSearchProviders(this._settings)
            .map(provider => new RemoteProvider(provider));
    }

    destroy() {
        this._settings.disconnectObject(this);
        Shell.AppSystem.get_default().disconnectObject(this);
        this.providers = [];
    }
}
