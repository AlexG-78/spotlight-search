// Paste target for the headless test: a GTK 4 window with one text field that mirrors
// its text into the file given as the first argument.
imports.gi.versions.Gtk = '4.0';
const {GLib, Gtk} = imports.gi;

const app = new Gtk.Application({application_id: 'org.mbp115.PasteTarget'});
app.connect('activate', () => {
    const entry = new Gtk.Entry();
    entry.connect('changed', () => GLib.file_set_contents(ARGV[0], entry.get_text()));
    const win = new Gtk.ApplicationWindow({application: app, title: 'Paste Target', child: entry});
    win.present();
    entry.grab_focus();
});
app.run([]);
