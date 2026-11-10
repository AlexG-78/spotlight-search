// Spotlight Search: runs every provider per query, ranks, and groups into Top Hit and sections
// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Frecency} from './frecency.js';
import {reveal} from './fileActions.js';
import {ActionsProvider} from '../providers/actions.js';
import {AppsProvider, CATEGORY_ORDER} from '../providers/apps.js';
import {ClipboardProvider} from '../providers/clipboard.js';
import {FilesProvider} from '../providers/files.js';
import {RemoteProviders} from '../providers/remote.js';
import {WebProvider} from '../providers/web.js';

const SECTION_ORDER = [
    'Suggestions', 'Recent', 'Apps', 'Actions', 'Settings',
    'Documents', 'PDFs', 'Images', 'Screenshots', 'Folders', 'Calculator', 'Clipboard',
];
// Cancelling a D-Bus call does not stop the work on the other side, so remote providers
// wait for a typing pause. Apps and the web row answer at once.
const REMOTE_DELAY_MS = 120;

function sectionRank(name) {
    if (name === 'Web')
        return Infinity;
    const i = SECTION_ORDER.indexOf(name);
    return i < 0 ? SECTION_ORDER.length : i;
}

export class SearchEngine {
    constructor(settings) {
        this._frecency = new Frecency();
        this._apps = new AppsProvider();
        this._remote = new RemoteProviders();
        this._web = new WebProvider(settings);
        this._actions = new ActionsProvider(settings);
        this._clipboard = new ClipboardProvider(settings);
        this.files = new FilesProvider(this._frecency);
        this._cancellable = null;
        this._timeoutId = 0;
    }

    // Calls onUpdate(model) whenever a provider answers, or onUpdate(null) for an empty query.
    // view 'files' searches localsearch only, inside scope (a folder URI) if given.
    // view 'actions' searches actions and Settings panels only, 'clipboard' the history only.
    run({text, view = null, scope = null}, onUpdate) {
        this.cancel();
        const terms = text.trim().split(/\s+/).filter(t => t);
        const files = view === 'files';
        const actions = view === 'actions';
        const clipboard = view === 'clipboard';
        if (view === 'apps') {
            onUpdate(this._appsModel(text, terms));
            return;
        }
        if (!terms.length && !files && !actions && !clipboard) {
            onUpdate(null);
            return;
        }
        const cancellable = this._cancellable = new Gio.Cancellable();
        const answers = new Map();
        const query = (provider, search = () => provider.search(terms, cancellable, scope)) => search().then(items => {
            if (cancellable.is_cancelled())
                return;
            answers.set(provider, items);
            onUpdate(this._build(text, terms, answers, {files, browsing: files || clipboard || !terms.length}, scope));
        }).catch(e => {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.error(`mbp115-spotlight: provider ${provider.id} failed: ${e}`);
        });

        if (files && !terms.length && !scope) {
            query(this.files, () => this.files.browse(cancellable));
            return;
        }
        if (clipboard) {
            query(this._clipboard, terms.length ? async () => this._clipboard.list(terms) : () => this._clipboard.browse());
            return;
        }
        if (actions && !terms.length) {
            query(this._actions, () => this._actions.browse(cancellable));
            return;
        }
        if (!files)
            query(this._actions);
        if (!files && !actions) {
            query(this._apps);
            query(this._clipboard);
            query(this._web);
        }
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REMOTE_DELAY_MS, () => {
            this._timeoutId = 0;
            let remote = this._remote.providers;
            if (actions)
                remote = remote.filter(provider => provider.section === 'Settings');
            (files ? [this.files] : remote).forEach(provider => query(provider));
            return GLib.SOURCE_REMOVE;
        });
    }

    cancel() {
        this._cancellable?.cancel();
        this._cancellable = null;
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;
    }

    activate(item, terms, params = {}) {
        // Clipboard entries come and go; ranking them by use would only fill the usage store.
        if (item.provider !== this._clipboard)
            this._frecency.record(item.key);
        if (params.reveal && item.uri)
            reveal(item.uri);
        else
            item.provider.activate(item, terms, params);
    }

    // The Apps view is local and synchronous: no providers, no cancellation needed.
    _appsModel(text, terms) {
        const apps = this._apps.browse(text);
        const present = new Set(apps.map(app => app.category));
        return {
            terms, topHit: null, sections: [], completion: null,
            apps, categories: CATEGORY_ORDER.filter(c => present.has(c)),
        };
    }

    // Browsing (the Files view, or nothing typed) has no Top Hit. The Files view's completion
    // offers folder names to lock as scope. An exact Quick Key beats any name match.
    _build(text, terms, answers, {files, browsing}, scope) {
        const typed = text.trimStart().toLowerCase();
        const items = [...answers.values()].flat();
        const rank = new Map(items.map((item, i) => {
            const name = item.name.toLowerCase();
            return [item, {
                match: item.quickKey && item.quickKey === typed.trim() ? 3
                    : name.startsWith(typed) ? 2 : Number(name.includes(typed)),
                use: this._frecency.score(item.key),
                section: sectionRank(item.section),
                i,
            }];
        }));
        const byUse = (a, b) => rank.get(b).use - rank.get(a).use || rank.get(a).i - rank.get(b).i;
        const byHit = (a, b) => rank.get(b).match - rank.get(a).match ||
            rank.get(a).section - rank.get(b).section || byUse(a, b);

        const topHit = browsing ? null : items.filter(item => !['Web', 'Clipboard'].includes(item.section)).sort(byHit)[0] ?? null;
        const groups = new Map();
        for (const item of items) {
            if (item === topHit)
                continue;
            if (!groups.has(item.section))
                groups.set(item.section, []);
            groups.get(item.section).push(item);
        }
        const sections = [...groups]
            .map(([name, list]) => ({name, items: list.sort(byUse)}))
            .sort((a, b) => sectionRank(a.name) - sectionRank(b.name) || a.name.localeCompare(b.name));
        const completion = files
            ? (scope ? null : this.files.folderCompletion(text))
            : topHit && topHit.section !== 'Calculator' &&
              topHit.name.toLowerCase().startsWith(text.toLowerCase()) ? topHit.name : null;
        return {terms, topHit, sections, completion};
    }

    destroy() {
        this.cancel();
        this._remote.destroy();
        this._actions.destroy();
        this._clipboard.destroy();
        this.files.destroy();
    }
}
