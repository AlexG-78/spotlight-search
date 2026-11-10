// Spotlight Search: "Search the web for …" fallback row
// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

export class WebProvider {
    constructor(settings) {
        this.id = 'web';
        this._settings = settings;
    }

    search(terms) {
        const query = terms.join(' ');
        return Promise.resolve([{
            key: 'web',
            id: query,
            name: `Search the web for “${query}”`,
            description: GLib.uri_parse(this._url(''), GLib.UriFlags.NONE).get_host() ?? '',
            createIcon: size => new St.Icon({icon_name: 'web-browser-symbolic', icon_size: size}),
            section: 'Web',
            provider: this,
        }]);
    }

    activate(item) {
        Gio.AppInfo.launch_default_for_uri(this._url(GLib.uri_escape_string(item.id, null, false)),
            global.create_app_launch_context(0, -1));
    }

    _url(query) {
        return this._settings.get_string('web-search-url').replace('%s', query);
    }
}
