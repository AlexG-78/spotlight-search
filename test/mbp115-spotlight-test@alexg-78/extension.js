// Headless test driver for mbp115-spotlight. Run through ../run.sh, never install it.
// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';

Gio._promisify(Shell.Screenshot.prototype, 'screenshot');

const UUID = 'mbp115-spotlight@alexg-78';
const OUT = GLib.getenv('SPOTLIGHT_TEST_OUT');

const wait = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    r();
    return GLib.SOURCE_REMOVE;
}));

export default class TestExtension extends Extension {
    // Cycling mbp115-spotlight may cycle this extension too, so the run must start only once.
    enable() {
        if (this._failures)
            return;
        this._failures = [];
        if (Main.layoutManager._startingUp)
            Main.layoutManager.connectObject('startup-complete', () => this._start(), this);
        else
            this._start();
    }

    disable() {
        Main.layoutManager.disconnectObject(this);
    }

    _start() {
        this._run().catch(e => this._fail(`exception: ${e}\n${e.stack}`)).finally(() => {
            console.log(this._failures.length ? `SPOTLIGHT-TEST FAIL ${this._failures.length}` : 'SPOTLIGHT-TEST PASS');
            global.context.terminate();
        });
    }

    _fail(msg) {
        this._failures.push(msg);
        console.log(`SPOTLIGHT-TEST fail: ${msg}`);
    }

    _check(cond, msg) {
        if (!cond)
            this._fail(msg);
    }

    get _win() {
        return Main.extensionManager.lookup(UUID).stateObj._window;
    }

    async _shot(name) {
        const file = Gio.File.new_for_path(`${OUT}/${name}.png`);
        const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        await new Shell.Screenshot().screenshot(false, stream);
        stream.close(null);
    }

    // Keys reach the extension asynchronously (input thread, then an ibus round trip; about
    // 30-45 ms here), so checks wait for the key's effect with _until instead of a fixed sleep.
    _key(...keyvals) {
        const t = GLib.get_monotonic_time();
        for (const k of keyvals)
            this._kbd.notify_keyval(t, k, Clutter.KeyState.PRESSED);
        for (const k of keyvals.reverse())
            this._kbd.notify_keyval(t, k, Clutter.KeyState.RELEASED);
    }

    _click(x, y) {
        const t = GLib.get_monotonic_time();
        this._ptr.notify_absolute_motion(t, x, y);
        this._ptr.notify_button(t, Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        this._ptr.notify_button(t, Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    }

    // enable/disableExtension only write GSettings; the state change follows asynchronously.
    async _setEnabled(on) {
        if (on)
            Main.extensionManager.enableExtension(UUID);
        else
            Main.extensionManager.disableExtension(UUID);
        const want = on ? ExtensionState.ACTIVE : ExtensionState.INACTIVE;
        for (let i = 0; i < 50 && Main.extensionManager.lookup(UUID).state !== want; i++)
            await wait(20);
        this._check(Main.extensionManager.lookup(UUID).state === want, `extension did not reach state ${want}`);
    }

    async _until(cond, ms = 3000) {
        const start = GLib.get_monotonic_time();
        while (!cond() && GLib.get_monotonic_time() - start < ms * 1000)
            await wait(5);
        return (GLib.get_monotonic_time() - start) / 1000;
    }

    async _searchChecks() {
        const win = this._win;
        const model = () => win.results._model;
        win.open();
        await wait(300);

        // R2.1/R2.2 first app results within budget, Top Hit, completion, web row.
        win.bar.entry.set_text('sett');
        const ms = await this._until(() => model()?.topHit?.section === 'Apps');
        console.log(`SPOTLIGHT-TEST first app results after ${ms.toFixed(0)} ms`);
        this._check(ms < 150, `first app results took ${ms} ms`);
        this._check(model().topHit.name === 'Settings', `top hit is ${model()?.topHit?.name}`);
        this._check(win.bar._completion === 'Settings', 'R2.4 no ghost completion');
        this._check(model().sections.at(-1)?.name === 'Web', 'R2.6 web row missing or not last');
        await wait(1500);
        console.log(`SPOTLIGHT-TEST sections ${model().sections.map(s => `${s.name}:${s.items.length}`).join(' ')}`);
        await this._shot('results-dark');

        // R2.3 Ctrl+number toggles the first chip; arrows move the selection.
        const first = win.results.chips._names[0];
        this._key(Clutter.KEY_Control_L, Clutter.KEY_1);
        await this._until(() => win.results.chips.active === first);
        this._check(win.results.chips.active === first, 'Ctrl+1 did not filter');
        this._key(Clutter.KEY_Control_L, Clutter.KEY_1);
        await this._until(() => win.results.chips.active === null);
        this._check(win.results.chips.active === null, 'second Ctrl+1 did not clear the filter');
        const top = win.results.selectedItem;
        this._key(Clutter.KEY_Down);
        await this._until(() => win.results.selectedItem !== top);
        this._check(win.results.selectedItem && win.results.selectedItem !== top, 'Down did not move');

        // R2.4 Tab accepts the completion.
        this._key(Clutter.KEY_Tab);
        await this._until(() => win.bar.text === 'Settings');
        this._check(win.bar.text === 'Settings', `Tab gave "${win.bar.text}"`);
        win.bar.entry.set_text('sett');
        await this._until(() => win.bar._completion === 'Settings');
        this._key(Clutter.KEY_Right);
        await this._until(() => win.bar.text === 'Settings');
        this._check(win.bar.text === 'Settings', `Right gave "${win.bar.text}"`);

        // R2.7 calculator: Return copies the result and closes; the pick lands in the usage store.
        win.bar.entry.set_text('2*21');
        await this._until(() => model()?.topHit?.section === 'Calculator', 5000);
        this._check(model()?.topHit?.section === 'Calculator', 'no calculator top hit');
        this._key(Clutter.KEY_Return);
        await wait(300);
        const copied = await new Promise(r => St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (_c, t) => r(t)));
        this._check(copied === '42', `calculator copied "${copied}"`);
        this._check(!win.isOpen, 'activating a result did not close');
        const usage = Gio.File.new_for_path(`${GLib.get_user_data_dir()}/mbp115-spotlight/usage.json`);
        const mode = usage.query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null).get_attribute_uint32('unix::mode');
        this._check((mode & 0o777) === 0o600, `usage store mode ${(mode & 0o777).toString(8)}`);

        // Esc clears query and results.
        win.open();
        await wait(300);
        win.bar.entry.set_text('sett');
        await this._until(() => win.results.visible);
        this._key(Clutter.KEY_Escape);
        await this._until(() => !win.results.visible);
        this._check(!win.results.visible && win.isOpen, 'Esc did not clear results');
        win.close();
        await wait(300);
    }

    async _filesChecks() {
        const win = this._win;
        const model = () => win.results._model;
        const names = section => model()?.sections.find(s => s.name === section)?.items.map(i => i.name) ?? [];
        win.open();
        await wait(300);

        // The browse buttons react to clicks: Files on, then off again.
        const button = win.bar._buttons.get('files').button;
        const [bx, by] = button.get_transformed_position();
        const [bw, bh] = button.get_transformed_size();
        this._click(bx + bw / 2, by + bh / 2);
        await wait(200);
        this._check(win.isOpen && win.bar.entry.hint_text === 'Search Files', 'clicking Files did not open the view');
        this._click(bx + bw / 2, by + bh / 2);
        await wait(200);
        this._check(win.isOpen && win.bar.entry.hint_text === 'Spotlight Search', 'clicking Files again did not leave it');

        // R3.1 Ctrl+2 on an empty bar opens Files with recent files, newest first, deleted ones dropped.
        this._key(Clutter.KEY_Control_L, Clutter.KEY_2);
        await this._until(() => names('Recent').length);
        this._check(win.bar.entry.hint_text === 'Search Files', 'Ctrl+2 did not open Files');
        this._check(names('Recent').join() === 'report.pdf,shot.png', `recent files: ${names('Recent')}`);
        await this._shot('files-recent');

        // R3.5 Space opens Quick Look without closing Spotlight, Space again closes the preview.
        const previewer = () => global.get_window_actors().some(a => a.meta_window.get_wm_class() === 'org.gnome.NautilusPreviewer');
        this._key(Clutter.KEY_space);
        const qlMs = await this._until(previewer, 8000);
        console.log(`SPOTLIGHT-TEST quick look after ${qlMs.toFixed(0)} ms, open=${win.isOpen}`);
        this._check(previewer() && win.isOpen && win.bar.text === '', 'Space did not open Quick Look over Spotlight');
        await wait(1500);
        await this._shot('files-quicklook');
        this._key(Clutter.KEY_space);
        await this._until(() => !previewer(), 3000);
        this._check(!previewer() && win.isOpen, 'second Space did not close Quick Look');

        // R3.2/R3.4 completion offers the folder, Tab locks it, the query then searches only there.
        win.bar.entry.set_text('Down');
        await this._until(() => win.bar._completion === 'Downloads');
        this._key(Clutter.KEY_Tab);
        await this._until(() => win.bar._token.visible);
        this._check(win.bar._token.visible && win.bar._token.text === 'Downloads' && win.bar.text === '',
            'Tab did not lock the Downloads token');
        // The throwaway session's localsearch has an empty index, so this only proves the query
        // runs without errors; results are checked against the real index on the MBP.
        win.bar.entry.set_text('rep');
        const ms = await this._until(() => model()?.terms?.[0] === 'rep', 5000);
        console.log(`SPOTLIGHT-TEST localsearch answered after ${ms.toFixed(0)} ms, open=${win.isOpen}`);
        this._check(model()?.terms?.[0] === 'rep' && model().topHit === null, 'scoped search did not answer');
        await this._shot('files-scoped');

        // Backspace on the empty bar drops the token; Esc leaves the view, a second Esc closes.
        win.bar.entry.set_text('');
        this._key(Clutter.KEY_BackSpace);
        await this._until(() => !win.bar._token.visible);
        this._check(!win.bar._token.visible, 'Backspace did not drop the token');
        this._key(Clutter.KEY_Escape);
        await this._until(() => win.bar.entry.hint_text === 'Spotlight Search');
        this._check(win.isOpen && win.bar.entry.hint_text === 'Spotlight Search', 'Esc did not leave Files');
        this._key(Clutter.KEY_Escape);
        await wait(300);
        this._check(!win.isOpen, 'Esc did not close after leaving Files');

        // R3.6 Shift+Return reveals the file in Files and closes Spotlight.
        win.open();
        await wait(300);
        this._key(Clutter.KEY_Control_L, Clutter.KEY_2);
        await this._until(() => names('Recent').length);
        this._key(Clutter.KEY_Shift_L, Clutter.KEY_Return);
        const nautilus = () => global.get_window_actors().some(a => a.meta_window.get_wm_class() === 'org.gnome.Nautilus');
        const revealMs = await this._until(nautilus, 10000);
        console.log(`SPOTLIGHT-TEST reveal after ${revealMs.toFixed(0)} ms, open=${win.isOpen}`);
        this._check(nautilus() && !win.isOpen, 'Shift+Return did not reveal in Files');
        // A client window still open at shutdown makes the Shell's teardown print criticals.
        global.get_window_actors().forEach(a => a.meta_window.delete(global.get_current_time()));
        await this._until(() => !global.get_window_actors().length, 5000);
    }

    async _appsChecks() {
        const win = this._win;
        const model = () => win.results._model;
        const selected = () => win.results._selected;

        // R4.3 the Launchpad key opens straight into Apps and closes it again.
        this._key(Clutter.KEY_LaunchB);
        await wait(400);
        this._check(win.isOpen && win.bar.entry.hint_text === 'Search Apps', 'Launchpad key did not open Apps');

        // R4.1 all apps A to Z in a grid, with category chips.
        const names = model()?.apps?.map(a => a.name) ?? [];
        console.log(`SPOTLIGHT-TEST apps ${names.length}, categories ${model()?.categories}`);
        this._check(names.length > 10 && names.join() === [...names].sort((a, b) => a.localeCompare(b)).join(),
            'Apps view is not a sorted list of all apps');
        this._check(win.results.chips.visible && win.results.chips._names.length > 1, 'no category chips');
        this._check(win.results._rows[0]?.constructor.name.includes('GridCell'), 'Apps view is not a grid');
        await this._shot('apps-grid');

        // R4.2 arrows move in 2D.
        this._key(Clutter.KEY_Right);
        await this._until(() => selected() === 1);
        this._check(selected() === 1, `Right moved to ${selected()}`);
        this._key(Clutter.KEY_Down);
        await this._until(() => selected() === 7);
        this._check(selected() === 7, `Down moved to ${selected()}`);

        // A category chip filters, typing filters live.
        const chip = win.results.chips.get_first_child();
        const [cx, cy] = chip.get_transformed_position();
        this._click(cx + 10, cy + 10);
        await wait(200);
        const category = win.results.chips.active;
        this._check(category && win.results._rows.every(r => r.item.category === category), `chip ${category} did not filter`);
        this._click(cx + 10, cy + 10);
        await wait(100);
        win.bar.entry.set_text('sett');
        await wait(100);
        this._check(model().apps.length > 0 && model().apps.every(a => a.name.toLowerCase().includes('sett')),
            'typing did not filter the apps');

        // List toggle: rows instead of tiles, Down moves one row.
        const toggle = win.results._layoutToggle;
        const [tx, ty] = toggle.get_transformed_position();
        this._click(tx + 10, ty + 10);
        await wait(200);
        this._check(win.results._rows[0]?.constructor.name.includes('ResultRow'), 'toggle did not switch to list');
        this._click(tx + 10, ty + 10);
        await wait(100);

        win.bar.entry.set_text('');
        this._key(Clutter.KEY_LaunchB);
        await wait(300);
        this._check(!win.isOpen, 'second Launchpad press did not close');
    }

    async _actionsChecks() {
        const win = this._win;
        const model = () => win.results._model;
        const names = section => model()?.sections.find(s => s.name === section)?.items.map(i => i.name) ?? [];

        // Timer durations parse like people type them.
        const {parseDuration} = await import(`file://${Main.extensionManager.lookup(UUID).path}/lib/providers/builtins.js`);
        const durations = {'90s': 90, '5m': 300, '1h30m': 5400, '10': 600, '2 min': 120, 'soon': null, '': null};
        for (const [text, want] of Object.entries(durations))
            this._check(parseDuration(text) === want, `parseDuration(${text}) = ${parseDuration(text)}`);

        // Dark mode also flips fixed-variant themes, and points gtk.css at one file with both variants.
        const {swapVariant, setDarkMode} = await import(`file://${Main.extensionManager.lookup(UUID).path}/lib/core/appearance.js`);
        const swaps = [['WhiteSur-Dark', false, 'WhiteSur-Light'], ['WhiteSur-light', true, 'WhiteSur-dark'],
            ['Adwaita', false, 'Adwaita'], ['Yaru-dark', true, 'Yaru-dark']];
        for (const [name, dark, want] of swaps)
            this._check(swapVariant(name, dark) === want, `swapVariant(${name}, ${dark}) = ${swapVariant(name, dark)}`);
        const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        const gtkCss = `${GLib.get_user_config_dir()}/gtk-4.0/gtk.css`;
        setDarkMode(false);
        const autoCss = new TextDecoder().decode(GLib.file_get_contents(gtkCss)[1]);
        this._check(iface.get_string('color-scheme') === 'default' && iface.get_string('gtk-theme') === 'Fixture-Light' &&
            GLib.file_read_link(gtkCss).endsWith('gtk-auto.css') && autoCss.includes('light-variant') &&
            autoCss.includes('dark-variant') && autoCss.includes('@media (prefers-color-scheme: dark)'),
            `light: ${iface.get_string('gtk-theme')} ${GLib.file_read_link(gtkCss)}`);
        setDarkMode(true);
        this._check(iface.get_string('color-scheme') === 'prefer-dark' && iface.get_string('gtk-theme') === 'Fixture-Dark' &&
            GLib.file_read_link(gtkCss).endsWith('gtk-auto.css'), `dark: ${iface.get_string('gtk-theme')} ${GLib.file_read_link(gtkCss)}`);
        await wait(800);

        // R5.1 Ctrl+3 on an empty bar lists the built-ins and the valid user action, A to Z.
        win.open();
        await wait(300);
        this._key(Clutter.KEY_Control_L, Clutter.KEY_3);
        await this._until(() => names('Actions').length);
        const all = names('Actions');
        console.log(`SPOTLIGHT-TEST actions: ${all}`);
        this._check(win.bar.entry.hint_text === 'Search Actions' && model().topHit === null, 'Ctrl+3 did not open Actions');
        for (const want of ['Set Timer', 'New Email', 'Empty Trash', 'Toggle Wi-Fi', 'Touch Marker'])
            this._check(all.includes(want), `action ${want} missing`);
        this._check(all.join() === [...all].sort((a, b) => a.localeCompare(b)).join(), 'actions not sorted');
        await wait(500); // icons load asynchronously
        await this._shot('actions-browse');

        // R5.5 an exact Quick Key is the Top Hit; R5.4 Tab opens its fields, Esc steps back out.
        win.bar.entry.set_text('tm');
        await this._until(() => model()?.topHit?.name === 'Set Timer');
        this._check(model()?.topHit?.name === 'Set Timer', `tm top hit: ${model()?.topHit?.name}`);
        this._key(Clutter.KEY_Tab);
        await this._until(() => win.params.active);
        this._check(win.params.active && !win.results.visible && win.bar._token.text === 'Set Timer',
            'Tab did not open the timer fields');
        this._check(win.params._entries[0]?.clutter_text.has_key_focus(), 'timer field has no focus');
        await this._shot('actions-params');
        this._key(Clutter.KEY_Escape);
        await wait(200);
        this._check(win.isOpen && !win.params.active && !win.bar._token.visible && win.results.visible,
            'Esc did not leave the fields');

        // Return runs the timer; it notifies when done.
        const source = (await import('resource:///org/gnome/shell/ui/messageTray.js')).getSystemSource();
        const before = source.count;
        await this._until(() => model()?.topHit?.name === 'Set Timer');
        this._key(Clutter.KEY_Tab);
        await this._until(() => win.params.active);
        win.params._entries[0]?.set_text('1s');
        this._key(Clutter.KEY_Return);
        await wait(300);
        this._check(!win.isOpen, 'running the timer did not close');
        await this._until(() => source.count > before, 3000);
        this._check(source.count > before, 'timer did not notify');

        // R5.3 user action: Return asks for the parameter, then runs the command with it.
        const marker = Gio.File.new_for_path(GLib.getenv('SPOTLIGHT_TEST_MARKER'));
        win.open();
        await wait(300);
        win.bar.entry.set_text('tmk');
        await this._until(() => model()?.topHit?.name === 'Touch Marker');
        this._key(Clutter.KEY_Return);
        await this._until(() => win.params.active);
        this._check(win.params.active && win.params.item?.name === 'Touch Marker', 'Return did not ask for the parameter');
        win.params._entries[0]?.set_text(marker.get_path());
        this._key(Clutter.KEY_Return);
        await this._until(() => marker.query_exists(null));
        this._check(marker.query_exists(null), 'user action did not run');

        // R5.2 .desktop actions and R2.1 actions in the main search.
        win.open();
        await wait(300);
        win.bar.entry.set_text('new window');
        await this._until(() => names('Actions').some(n => n.includes(': ')));
        console.log(`SPOTLIGHT-TEST desktop actions: ${names('Actions')}`);
        this._check(names('Actions').some(n => n.includes(': ')), 'no .desktop actions');
        win.bar.entry.set_text('trash');
        await this._until(() => [model()?.topHit?.name, ...names('Actions')].includes('Empty Trash'));
        this._check([model()?.topHit?.name, ...names('Actions')].includes('Empty Trash'), 'main search has no actions');
        win.close();
        await wait(300);
    }

    async _clipboardChecks() {
        const win = this._win;
        const model = () => win.results._model;
        const names = section => model()?.sections.find(s => s.name === section)?.items.map(i => i.name) ?? [];
        const ext = Main.extensionManager.lookup(UUID);
        const clipboard = St.Clipboard.get_default();
        const CLIP = St.ClipboardType.CLIPBOARD;
        const mode = path => Gio.File.new_for_path(path).query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null)
            .get_attribute_uint32('unix::mode') & 0o777;

        // Store: pruning by age and the password manager hint, without the Shell's clipboard.
        const {ClipboardStore} = await import(`file://${ext.path}/lib/core/clipboardStore.js`);
        const secrets = await import(`file://${ext.path}/lib/core/secrets.js`);
        this._check(secrets.hasSecretHint(['text/plain', 'x-kde-passwordManagerHint']) &&
            !secrets.hasSecretHint(['text/plain']), 'hasSecretHint');
        this._check(secrets.isSecretApp('Bitwarden snap.bitwarden', ['bitwarden']) &&
            !secrets.isSecretApp('org.gnome.TextEditor', ['bitwarden']) && !secrets.isSecretApp('', ['']), 'isSecretApp');
        const secretSamples = ['Xk9#mQ2vLp8$wR4z', 'aB3xQ9zLm2Kp7T', 'ghp_1234567890abcdefABCDEF1234567890ab',
            'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijklmnop', '4111 1111 1111 1111',
            '-----BEGIN OPENSSH PRIVATE KEY-----\nabc', 'sk-proj-abcdefghijklmnop1234'];
        const plainSamples = ['getUserById2', 'hello world', 'https://example.com/a?B=1&c=2', 'a1b2c3d4e5f6a7b8c9d0',
            'MyDocument_v2.pdf', 'user@example.com', '/home/user/Documents', 'SPOTLIGHT_TEST_DIR', '+49 170 1234567',
            'IPv6Address', 'x86_64-linux-gnu', 'mbp115-spotlight@alexg-78', 'Ctrl+Shift+V', 'Ubuntu-26.10',
            'f47ac10b-58cc-4372-a567-0e02b2c3d479', '4111 1111 1111 1112'];
        for (const s of secretSamples)
            this._check(secrets.looksSecret(s), `not seen as secret: ${s}`);
        for (const s of plainSamples)
            this._check(!secrets.looksSecret(s), `wrongly seen as secret: ${s}`);
        const tmp = GLib.dir_make_tmp('spotlight-store-XXXXXX');
        const store = new ClipboardStore(tmp);
        store.add({kind: 'text', text: 'old'});
        store.add({kind: 'text', text: 'new'});
        store.add({kind: 'text', text: 'old'});
        this._check(store.entries.map(e => e.text).join() === 'old,new', 'copying again should move to the top');
        store.entries[1].time -= 31 * 60 * 1000;
        store.prune(30);
        this._check(store.entries.map(e => e.text).join() === 'old', 'prune kept an expired entry');

        // R6.1 off until opted in: the view only offers to turn history on, and copies are not kept.
        clipboard.set_text(CLIP, 'copied before opting in');
        await wait(200);
        win.open();
        await wait(300);
        this._key(Clutter.KEY_Control_L, Clutter.KEY_4);
        await this._until(() => names('Clipboard').length);
        this._check(win.bar.entry.hint_text === 'Search Clipboard' &&
            names('Clipboard').join() === 'Turn On Clipboard History', `opt-in view: ${names('Clipboard')}`);
        await this._shot('clipboard-optin');
        this._key(Clutter.KEY_Return);
        await wait(300);
        this._check(win.isOpen && ext.stateObj.getSettings().get_boolean('clipboard-history'), 'opting in failed or closed');
        win.close();
        await wait(300);

        // R6.2 text, links and images are recorded, newest first.
        const png = GLib.base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==');
        clipboard.set_content(CLIP, 'image/png', new GLib.Bytes(png));
        await wait(300);
        clipboard.set_text(CLIP, 'https://example.com/page');
        await wait(300);
        clipboard.set_text(CLIP, 'hello spotlight clipboard');
        await wait(300);
        win.open();
        await wait(300);
        this._key(Clutter.KEY_Control_L, Clutter.KEY_4);
        await this._until(() => names('Clipboard').length > 2);
        const history = names('Clipboard');
        console.log(`SPOTLIGHT-TEST clipboard: ${history}`);
        this._check(history.slice(0, 4).join() === 'hello spotlight clipboard,https://example.com/page,Image,Clear Clipboard History',
            `history: ${history}`);
        await wait(500); // icons load asynchronously
        await this._shot('clipboard-history');

        // R6.4 private files.
        const dir = `${GLib.get_user_data_dir()}/mbp115-spotlight`;
        const image = Gio.File.new_for_path(`${dir}/clipboard`).enumerate_children('standard::name', 0, null).next_file(null).get_name();
        this._check(mode(`${dir}/clipboard.json`) === 0o600 && mode(`${dir}/clipboard`) === 0o700 &&
            mode(`${dir}/clipboard/${image}`) === 0o600, 'clipboard files are not private');

        // R6.5 a click copies only.
        clipboard.set_text(CLIP, 'something else');
        await wait(200);
        const row = win.results._rows.find(r => r.item.name === 'https://example.com/page');
        const [rx, ry] = row.get_transformed_position();
        this._click(rx + 40, ry + 10);
        await wait(300);
        const copied = await new Promise(resolve => clipboard.get_text(CLIP, (_c, text) => resolve(text)));
        this._check(copied === 'https://example.com/page' && !win.isOpen, `click copied ${copied}`);

        // R6.5 Return pastes into the window that had focus, found through the main search (R2.1): a GTK 4 window that writes its field to a file.
        const out = `${GLib.get_tmp_dir()}/spotlight-paste-${GLib.uuid_string_random()}`;
        const proc = Gio.Subprocess.new(['gjs', `${GLib.getenv('SPOTLIGHT_TEST_DIR')}/paste-target.js`, out],
            Gio.SubprocessFlags.NONE);
        const appWin = () => global.display.list_all_windows().find(w => w.get_title() === 'Paste Target');
        await this._until(() => appWin() && global.display.focus_window === appWin(), 10000);
        console.log(`SPOTLIGHT-TEST paste target focused=${global.display.focus_window?.get_title()}`);
        await wait(500);
        win.open();
        await wait(300);
        win.bar.entry.set_text('hello spot');
        await this._until(() => names('Clipboard').length);
        this._check(names('Clipboard')[0] === 'hello spotlight clipboard', `main search clipboard: ${names('Clipboard')}`);
        win.results._select(win.results._rows.findIndex(r => r.item.section === 'Clipboard'));
        this._key(Clutter.KEY_Return);
        const readOut = () => GLib.file_test(out, GLib.FileTest.EXISTS) ? new TextDecoder().decode(GLib.file_get_contents(out)[1]) : '';
        await this._until(() => readOut() !== '', 3000);
        console.log(`SPOTLIGHT-TEST app paste focus=${global.display.focus_window?.get_title()} got "${readOut()}"`);
        this._check(readOut() === 'hello spotlight clipboard', `pasted into GTK app: "${readOut()}"`);
        appWin()?.delete(global.get_current_time());
        proc.force_exit();

        // R6.3 secrets never enter the history; a copy the source wipes again leaves it.
        const stored = () => win._controller._engine._clipboard._store.entries.map(e => e.text ?? e.kind);
        clipboard.set_text(CLIP, 'aB3xQ9zLm2Kp7T');
        await wait(300);
        this._check(!stored().includes('aB3xQ9zLm2Kp7T'), 'generated password entered the history');
        clipboard.set_text(CLIP, 'copied then wiped');
        await wait(300);
        this._check(stored()[0] === 'copied then wiped', `history before wipe: ${stored()}`);
        clipboard.set_text(CLIP, '');
        await wait(300);
        this._check(!stored().includes('copied then wiped') && stored().includes('hello spotlight clipboard'),
            `after wipe: ${stored()}`);
        clipboard.set_text(CLIP, 'aB3xQ9zLm2Kp7T');
        await wait(300);
        clipboard.set_text(CLIP, '');
        await wait(300);
        this._check(stored().includes('hello spotlight clipboard'), 'wiping a skipped secret dropped an older entry');

        // Ctrl+Backspace forgets the picked entry and keeps the view open.
        win.open();
        await wait(300);
        this._key(Clutter.KEY_Control_L, Clutter.KEY_4);
        await this._until(() => names('Clipboard').includes('https://example.com/page'));
        const linkIndex = win.results._rows.findIndex(r => r.item.name === 'https://example.com/page');
        win.results.moveSelection(linkIndex);
        this._key(Clutter.KEY_Control_L, Clutter.KEY_BackSpace);
        await wait(300);
        this._check(win.isOpen && !stored().includes('https://example.com/page') &&
            !names('Clipboard').includes('https://example.com/page') && stored().includes('hello spotlight clipboard'),
            `forget: ${stored()}`);
        win.close();
        await wait(300);

        // Turning history off deletes it.
        ext.stateObj.getSettings().set_boolean('clipboard-history', false);
        await wait(300);
        const left = JSON.parse(new TextDecoder().decode(GLib.file_get_contents(`${dir}/clipboard.json`)[1]));
        this._check(left.length === 0 && !GLib.file_test(`${dir}/clipboard/${image}`, GLib.FileTest.EXISTS),
            'turning history off did not delete it');
    }

    async _run() {
        const seat = global.stage.context.get_backend().get_default_seat();
        this._kbd = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this._ptr = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        // Hard-edged stripes behind the panel make blur and the rounded corner mask visible.
        const stripes = new St.BoxLayout({x: 340, y: 160, width: 760, height: 130});
        for (let i = 0; i < 19; i++) {
            stripes.add_child(new St.Widget({
                width: 40, height: 130,
                style: `background-color: ${i % 2 ? '#ffd60a' : '#0a84ff'};`,
            }));
        }
        global.window_group.add_child(stripes);
        await wait(1500);

        // R1.1 shortcut toggles, also while our own modal is up.
        this._key(Clutter.KEY_Super_L, Clutter.KEY_space);
        await wait(400);
        this._check(this._win.isOpen, 'Super+Space did not open');
        const focus = global.stage.get_key_focus();
        this._check(focus && this._win.contains(focus), 'R1.2 key focus not in Spotlight');
        await this._shot('open-dark');
        const [px, py] = this._win._panel.get_transformed_position();
        const [pw, ph] = this._win._panel.get_transformed_size();
        console.log(`SPOTLIGHT-TEST panel ${px},${py} ${pw}x${ph}`);
        this._check(pw === 680 && ph >= 52 && ph <= 54 &&px === 380 && py === 198, 'panel geometry off spec');
        this._key(Clutter.KEY_Super_L, Clutter.KEY_space);
        await wait(400);
        this._check(!this._win.isOpen && !this._win.visible, 'Super+Space did not close');

        // The top bar magnifier opens Spotlight; the setting removes it.
        const icon = () => Main.panel.statusArea[UUID];
        this._check(icon()?.visible, 'no top bar icon');
        const [ix, iy] = icon().get_transformed_position();
        const [iw, ih] = icon().get_transformed_size();
        this._click(ix + iw / 2, iy + ih / 2);
        await wait(400);
        this._check(this._win.isOpen, 'clicking the top bar icon did not open');
        await this._shot('panel-icon');
        this._win.close();
        await wait(300);
        const extSettings = Main.extensionManager.lookup(UUID).stateObj.getSettings();
        extSettings.set_boolean('show-panel-icon', false);
        await wait(100);
        this._check(!icon(), 'top bar icon still there after turning it off');
        extSettings.reset('show-panel-icon');
        await wait(100);

        // Esc clears the query first, then closes.
        // Esc clears the query first, then closes.
        this._win.open();
        await wait(300);
        this._win.bar.entry.set_text('abc');
        this._key(Clutter.KEY_Escape);
        await this._until(() => this._win.bar.text === '');
        this._check(this._win.isOpen && this._win.bar.text === '', 'first Esc should only clear');
        this._key(Clutter.KEY_Escape);
        await wait(300);
        this._check(!this._win.isOpen, 'second Esc did not close');

        // Click outside closes, click inside does not.
        this._win.open();
        await wait(300);
        this._click(px + 100, py + 26);
        await wait(200);
        this._check(this._win.isOpen, 'click inside panel closed it');
        this._click(50, 800);
        await wait(300);
        this._check(!this._win.isOpen, 'click outside did not close');

        // Overview opening closes.
        this._win.open();
        await wait(300);
        Main.overview.show();
        await wait(300);
        this._check(!this._win.isOpen, 'overview did not close');
        Main.overview.hide();
        await wait(800);

        await this._searchChecks();
        await this._filesChecks();
        await this._appsChecks();
        await this._actionsChecks();
        await this._clipboardChecks();

        // Light variant follows the system scheme live.
        new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).set_string('color-scheme', 'prefer-light');
        await wait(800);
        this._win.open();
        await wait(400);
        await this._shot('open-light');
        const bg = () => this._win._content.get_theme_node().get_background_color();
        console.log(`SPOTLIGHT-TEST light variant=${Main.getStyleVariant()} bg=${bg().red},${bg().green},${bg().blue}`);
        this._check(bg().red > 200 && this._win.has_style_class_name('spotlight-light'), 'light look not applied');

        // R7 appearance pinned to dark wins over the light system; reduce transparency is solid, no blur.
        const settings = Main.extensionManager.lookup(UUID).stateObj.getSettings();
        settings.set_string('appearance', 'dark');
        await wait(200);
        this._check(bg().red < 100, 'appearance=dark did not override the light system');
        settings.set_boolean('reduce-transparency', true);
        await wait(200);
        await this._shot('solid-dark');
        this._check(bg().alpha === 255 && !this._win._glass.visible, `solid: alpha ${bg().alpha}, blur ${this._win._glass.visible}`);
        settings.reset('appearance');
        settings.reset('reduce-transparency');
        this._win.close();
        await wait(300);

        // No motion when animations are off: open is complete at once.
        const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        iface.set_boolean('enable-animations', false);
        this._win.open();
        this._check(this._win.opacity === 255 && this._win._panel.scale_x === 1, 'open animated with animations off');
        this._win.close();
        this._check(!this._win.visible, 'close animated with animations off');
        iface.reset('enable-animations');
        await wait(300);

        // R7 the prefs window opens (Extension Manager shows the gear only when hasPrefs is set).
        const ext = Main.extensionManager.lookup(UUID);
        this._check(ext.hasPrefs && ext.metadata.name === 'Spotlight Search', `hasPrefs ${ext.hasPrefs}, name ${ext.metadata.name}`);
        Main.extensionManager.openExtensionPrefs(UUID, '', {});
        const prefsWin = () => global.display.list_all_windows().find(w => w.get_title() === 'Spotlight Search');
        await this._until(() => prefsWin(), 15000);
        this._check(prefsWin(), 'prefs window did not open');
        await wait(1500);
        await this._shot('prefs');
        prefsWin()?.delete(global.get_current_time());
        await wait(500);

        // Enable/disable 10x must leave nothing behind.
        const chromeBefore = Main.layoutManager.uiGroup.get_n_children();
        for (let i = 0; i < 10; i++) {
            await this._setEnabled(false);
            await this._setEnabled(true);
            this._win.open();
            // shortcut: destroying in the very frame of open() makes Clutter warn about a
            // spurious allocation; only reachable by a lock racing the shortcut, so tolerated.
            await wait(50);
            this._win.close();
        }
        await wait(500);
        await this._setEnabled(false);
        this._check(Main.layoutManager.uiGroup.get_n_children() === chromeBefore - 1,
            'actors leaked across enable/disable');
        this._check(!global.stage.get_children().some(a => a.name === 'mbp115-spotlight') &&
            !Main.layoutManager.uiGroup.get_children().some(a => a.name === 'mbp115-spotlight'),
            'window survived disable');
    }
}
