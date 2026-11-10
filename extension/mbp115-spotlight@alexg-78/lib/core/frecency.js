// Spotlight Search: usage store that ranks results by how often and how recently they were opened
// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const HALF_LIFE_DAYS = 14;
const MAX_ENTRIES = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

export class Frecency {
    constructor() {
        this._dir = GLib.build_filenamev([GLib.get_user_data_dir(), 'mbp115-spotlight']);
        this._file = Gio.File.new_for_path(GLib.build_filenamev([this._dir, 'usage.json']));
        this._data = {};
        try {
            // Read once in enable(); the file stays small because record() prunes it.
            const [, bytes] = this._file.load_contents(null);
            this._data = JSON.parse(new TextDecoder().decode(bytes));
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                console.warn(`mbp115-spotlight: usage store unreadable, starting fresh: ${e}`);
        }
    }

    score(key) {
        const entry = this._data[key];
        if (!entry)
            return 0;
        return entry.count * 0.5 ** ((Date.now() - entry.last) / DAY_MS / HALF_LIFE_DAYS);
    }

    top(prefix, count) {
        return Object.keys(this._data).filter(key => key.startsWith(prefix))
            .sort((a, b) => this.score(b) - this.score(a)).slice(0, count);
    }

    record(key) {
        const entry = this._data[key] ?? {count: 0, last: 0};
        entry.count++;
        entry.last = Date.now();
        this._data[key] = entry;

        const keys = Object.keys(this._data);
        if (keys.length > MAX_ENTRIES) {
            keys.sort((a, b) => this.score(a) - this.score(b));
            for (const k of keys.slice(0, keys.length - MAX_ENTRIES))
                delete this._data[k];
        }
        this._save();
    }

    _save() {
        GLib.mkdir_with_parents(this._dir, 0o700);
        const bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(this._data)));
        this._file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.PRIVATE, null,
            (file, res) => {
                try {
                    file.replace_contents_finish(res);
                } catch (e) {
                    console.warn(`mbp115-spotlight: could not save usage store: ${e}`);
                }
            });
    }
}
