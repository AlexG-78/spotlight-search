// Spotlight Search: clipboard history on disk, private to the user, pruned by age (R6.4)
// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const MAX_ENTRIES = 200;

function save(file, bytes) {
    file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.PRIVATE, null, (f, res) => {
        try {
            f.replace_contents_finish(res);
        } catch (e) {
            console.warn(`mbp115-spotlight: could not save ${f.get_basename()}: ${e}`);
        }
    });
}

// Entries, newest first: {id, kind: 'text'|'link'|'image'|'files', text, image (a file name), hash, time}.
// dir defaults to ~/.local/share/mbp115-spotlight; images live in its clipboard/ folder.
export class ClipboardStore {
    constructor(dir = GLib.build_filenamev([GLib.get_user_data_dir(), 'mbp115-spotlight'])) {
        this._images = GLib.build_filenamev([dir, 'clipboard']);
        this._file = Gio.File.new_for_path(GLib.build_filenamev([dir, 'clipboard.json']));
        this.entries = [];
        try {
            const [, bytes] = this._file.load_contents(null);
            this.entries = JSON.parse(new TextDecoder().decode(bytes));
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                console.warn(`mbp115-spotlight: clipboard history unreadable, starting fresh: ${e}`);
        }
    }

    imagePath(entry) {
        return GLib.build_filenamev([this._images, entry.image]);
    }

    // The same content copied again moves to the top instead of showing twice. Returns the entry.
    add(entry, imageBytes = null) {
        if (imageBytes)
            entry = {...entry, hash: GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, imageBytes)};
        const same = this.entries.find(e => e.kind === entry.kind && e.text === entry.text && e.hash === entry.hash);
        if (same) {
            same.time = Date.now();
            this.entries = [same, ...this.entries.filter(e => e !== same)];
            this._save();
            return same;
        }
        const added = {...entry, id: GLib.uuid_string_random(), time: Date.now()};
        if (imageBytes) {
            GLib.mkdir_with_parents(this._images, 0o700);
            added.image = `${added.id}.png`;
            save(Gio.File.new_for_path(this.imagePath(added)), imageBytes);
        }
        this.entries.unshift(added);
        this._drop(this.entries.slice(MAX_ENTRIES));
        this._save();
        return added;
    }

    // Drops entries older than retentionMinutes; called on every read, so no timer is needed.
    prune(retentionMinutes, now = Date.now()) {
        const cutoff = now - retentionMinutes * 60 * 1000;
        const old = this.entries.filter(e => e.time < cutoff);
        if (old.length) {
            this._drop(old);
            this._save();
        }
    }

    remove(entry) {
        this._drop([entry]);
        this._save();
    }

    clear() {
        this._drop(this.entries);
        this._save();
    }

    _drop(gone) {
        for (const entry of gone) {
            if (entry.image)
                GLib.unlink(this.imagePath(entry));
        }
        this.entries = this.entries.filter(e => !gone.includes(e));
    }

    _save() {
        GLib.mkdir_with_parents(this._file.get_parent().get_path(), 0o700);
        save(this._file, new GLib.Bytes(new TextEncoder().encode(JSON.stringify(this.entries))));
    }
}
