// Spotlight Search: installed apps, through the Shell's own app search
// SPDX-License-Identifier: GPL-3.0-or-later
import Shell from 'gi://Shell';

import * as AppDisplay from 'resource:///org/gnome/shell/ui/appDisplay.js';
import * as ParentalControls from 'resource:///org/gnome/shell/misc/parentalControlsManager.js';

const MAX_RESULTS = 6;
export const CATEGORY_ORDER = [
    'Productivity', 'Creativity', 'Developer Tools', 'Games',
    'Utilities', 'Social', 'Entertainment', 'System',
];
// First match wins, so specific groups come before broad ones: a sound editor is
// Creativity, not Entertainment, and a terminal is Utilities, not System.
const CATEGORY_KEYS = [
    ['Developer Tools', ['Development', 'IDE', 'Building', 'Debugger', 'RevisionControl']],
    ['Games', ['Game']],
    ['Creativity', ['Graphics', 'AudioVideoEditing', 'Photography', 'Publishing', '2DGraphics', '3DGraphics']],
    ['Social', ['Chat', 'InstantMessaging', 'IRCClient', 'VideoConference', 'Telephony', 'Email']],
    ['Productivity', ['Office', 'Calendar', 'ContactManagement', 'ProjectManagement', 'Finance', 'WebBrowser']],
    ['Utilities', ['Utility', 'Accessories', 'Archiving', 'FileManager', 'TerminalEmulator', 'TextEditor', 'Science', 'Education']],
    ['System', ['System', 'Settings', 'Monitor', 'Security', 'PackageManager', 'HardwareSettings', 'DesktopSettings']],
    ['Entertainment', ['AudioVideo', 'Audio', 'Video', 'Player', 'TV']],
];

function categoryOf(info) {
    const categories = (info.get_categories() ?? '').split(';');
    return CATEGORY_KEYS.find(([, keys]) => keys.some(k => categories.includes(k)))?.[0] ?? null;
}

export class AppsProvider {
    constructor() {
        this.id = 'apps';
        // Reusing it keeps parental controls filtering and Shell.AppUsage ordering.
        this._provider = new AppDisplay.AppSearchProvider();
    }

    async search(terms, cancellable) {
        // System actions come along too; the Actions provider owns those.
        const ids = await this._provider.getInitialResultSet(terms, cancellable);
        const metas = await this._provider.getResultMetas(ids.filter(id => id.endsWith('.desktop')).slice(0, MAX_RESULTS));
        return metas.map(meta => ({
            key: `apps:${meta.id}`,
            id: meta.id,
            name: meta.name,
            description: 'Application',
            createIcon: meta.createIcon,
            section: 'Apps',
            provider: this,
        }));
    }

    // Every installed app A to Z, for the Apps view; text filters by name.
    browse(text) {
        const appSystem = Shell.AppSystem.get_default();
        const parental = ParentalControls.getDefault();
        const typed = text.trim().toLowerCase();
        const items = [];
        for (const info of appSystem.get_installed()) {
            let id;
            try {
                id = info.get_id(); // throws on invalid file encodings
            } catch {
                continue;
            }
            const app = appSystem.lookup_app(id);
            if (!app || !info.should_show() || !parental.shouldShowApp(info) ||
                !app.get_name().toLowerCase().includes(typed))
                continue;
            items.push({
                key: `apps:${id}`,
                id,
                name: app.get_name(),
                description: 'Application',
                createIcon: size => app.create_icon_texture(size),
                section: 'Apps',
                category: categoryOf(info),
                provider: this,
            });
        }
        return items.sort((a, b) => a.name.localeCompare(b.name));
    }

    activate(item) {
        Shell.AppSystem.get_default().lookup_app(item.id)?.activate();
    }
}
