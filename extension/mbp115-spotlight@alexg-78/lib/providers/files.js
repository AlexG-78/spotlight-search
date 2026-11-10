// Spotlight Search: file search through localsearch (Tracker 3), recent files, known folders
// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

Gio._promisify(Gio.File.prototype, 'load_contents_async');

const BUS_NAME = 'org.freedesktop.LocalSearch3';
const MAX_RESULTS = 30;
const MAX_RECENT = 12;
const MAX_SUGGESTED = 4;
// shortcut: matches file names only, not content; add an fts:match branch if names prove too thin.
const QUERY = `SELECT ?url ?name ?mime WHERE {
    GRAPH tracker:FileSystem {
        ?f a nfo:FileDataObject ; nfo:fileName ?name ; nie:url ?url ; nfo:fileLastModified ?modified .
        FILTER (CONTAINS(LCASE(?name), LCASE(~term)) && STRSTARTS(?url, ~scope) && !CONTAINS(?url, "/."))
    }
    OPTIONAL { ?content nie:isStoredAs ?f ; nie:mimeType ?mime }
} ORDER BY DESC(?modified) LIMIT ${MAX_RESULTS}`;
const FOLDERS = [
    ['DIRECTORY_DESKTOP', 'Desktop'], ['DIRECTORY_DOCUMENTS', 'Documents'],
    ['DIRECTORY_DOWNLOAD', 'Downloads'], ['DIRECTORY_MUSIC', 'Music'],
    ['DIRECTORY_PICTURES', 'Pictures'], ['DIRECTORY_VIDEOS', 'Videos'],
];

function typeOf(name, mime) {
    if (mime === 'inode/directory')
        return 'Folders';
    if (mime === 'application/pdf')
        return 'PDFs';
    if (mime.startsWith('image/'))
        return /^(screenshot|bildschirmfoto)/i.test(name) ? 'Screenshots' : 'Images';
    return 'Documents';
}

// Localized folder names plus the English ones, so "Downloads" also finds "Downloads" on a German system.
function knownFolders() {
    const home = GLib.get_home_dir();
    const folders = [{name: 'Home', uri: Gio.File.new_for_path(home).get_uri()}];
    for (const [key, english] of FOLDERS) {
        const path = GLib.get_user_special_dir(GLib.UserDirectory[key]);
        if (!path || path === home)
            continue;
        const uri = Gio.File.new_for_path(path).get_uri();
        for (const name of new Set([GLib.path_get_basename(path), english]))
            folders.push({name, uri});
    }
    return folders;
}

export class FilesProvider {
    constructor(frecency) {
        this.id = 'files';
        this._frecency = frecency;
        this._connection = null;
        this.folders = knownFolders();
    }

    folderFor(text) {
        const name = text.trim().toLowerCase();
        return this.folders.find(f => f.name.toLowerCase() === name) ?? null;
    }

    folderCompletion(text) {
        const typed = text.toLowerCase();
        return text ? this.folders.find(f => f.name.toLowerCase().startsWith(typed))?.name ?? null : null;
    }

    async search(terms, cancellable, scope) {
        const statement = (await this._connect()).query_statement(QUERY, cancellable);
        statement.bind_string('term', terms.join(' '));
        statement.bind_string('scope', scope ? `${scope}/` : 'file://');
        const cursor = await statement.execute_async(cancellable);
        const items = [];
        try {
            while (await cursor.next_async(cancellable)) {
                const [uri] = cursor.get_string(0);
                const [name] = cursor.get_string(1);
                const mime = cursor.get_string(2)[0] ?? Gio.content_type_guess(name, null)[0];
                items.push(this._item(uri, name, mime));
            }
        } finally {
            cursor.close();
        }
        return items;
    }

    // Empty Files view: what Spotlight opened most, then what any app opened last.
    async browse(cancellable) {
        const suggested = this._frecency.top('files:', MAX_SUGGESTED).map(key => key.slice('files:'.length));
        const file = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']));
        let recent = [];
        try {
            const [bytes] = await file.load_contents_async(cancellable);
            recent = [...new TextDecoder().decode(bytes).matchAll(/<bookmark href="(file:[^"]+)"[^>]*?modified="([^"]+)"/g)]
                .sort((a, b) => b[2].localeCompare(a[2]))
                .map(m => m[1].replaceAll('&amp;', '&'))
                .filter(uri => !suggested.includes(uri));
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                throw e;
        }
        const [top, latest] = await Promise.all([
            this._existing(suggested, 'Suggestions', cancellable),
            this._existing([...new Set(recent)].slice(0, MAX_RECENT * 2), 'Recent', cancellable),
        ]);
        return [...top, ...latest.slice(0, MAX_RECENT)];
    }

    activate(item) {
        Gio.AppInfo.launch_default_for_uri(item.uri, global.create_app_launch_context(0, -1));
    }

    // Drops files that were deleted or moved since they were recorded.
    _existing(uris, section, cancellable) {
        return Promise.all(uris.map(async uri => {
            try {
                const info = await Gio.File.new_for_uri(uri).query_info_async(
                    'standard::display-name,standard::content-type',
                    Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable);
                return this._item(uri, info.get_display_name(), info.get_content_type(), section);
            } catch {
                return null;
            }
        })).then(items => items.filter(item => item));
    }

    async _connect() {
        if (!this._connection) {
            // Imported lazily: without gir1.2-tsparql-3.0 only the Files view fails, not the extension.
            const {default: Tsparql} = await import('gi://Tsparql');
            Gio._promisify(Tsparql.SparqlConnection, 'bus_new_async');
            Gio._promisify(Tsparql.SparqlStatement.prototype, 'execute_async');
            Gio._promisify(Tsparql.SparqlCursor.prototype, 'next_async');
            this._connection = await Tsparql.SparqlConnection.bus_new_async(BUS_NAME, null, null, null);
        }
        return this._connection;
    }

    _item(uri, name, mime, section = typeOf(name, mime)) {
        const parent = Gio.File.new_for_uri(uri).get_parent()?.get_path() ?? '';
        return {
            key: `files:${uri}`,
            id: uri,
            uri,
            name,
            description: parent.replace(GLib.get_home_dir(), '~'),
            createIcon: size => new St.Icon({gicon: Gio.content_type_get_icon(mime), icon_size: size}),
            section,
            provider: this,
        };
    }

    destroy() {
        this._connection?.close();
        this._connection = null;
    }
}
