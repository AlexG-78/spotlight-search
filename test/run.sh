#!/bin/bash
# Headless test for mbp115-spotlight: runs a throwaway GNOME Shell 51 on a 1440x900
# virtual monitor with its own config, drives the extension, saves screenshots to out/.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
ext=mbp115-spotlight@alexg-78
test_ext=mbp115-spotlight-test@alexg-78
out=$here/out
tmp=$(mktemp -d)
# Session daemons may still be writing into the runtime dir while we clean up.
trap 'rm -rf "$tmp" 2>/dev/null || true' EXIT

rm -rf "$out"
mkdir -p "$out" "$tmp/data/gnome-shell/extensions" "$tmp/config" "$tmp/cache" "$tmp/run"
chmod 700 "$tmp/run"
cp -r "$here/../extension/$ext" "$here/$test_ext" "$tmp/data/gnome-shell/extensions/"
glib-compile-schemas --strict "$tmp/data/gnome-shell/extensions/$ext/schemas"

# Files view fixtures: a folder that plays Downloads, and recent files. localsearch indexes nothing here.
files=$tmp/files
mkdir -p "$files"
printf '%%PDF-1.4\n' >"$files/report.pdf"
printf '\x89PNG\r\n\x1a\n' >"$files/shot.png"
echo "XDG_DOWNLOAD_DIR=\"$files\"" >"$tmp/config/user-dirs.dirs"
cat >"$tmp/data/recently-used.xbel" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<xbel version="1.0">
  <bookmark href="file://$files/shot.png" added="2026-01-01T10:00:00Z" modified="2026-01-01T10:00:00Z" visited="2026-01-01T10:00:00Z"/>
  <bookmark href="file://$files/report.pdf" added="2026-01-02T10:00:00Z" modified="2026-01-02T10:00:00Z" visited="2026-01-02T10:00:00Z"/>
  <bookmark href="file://$files/gone.txt" added="2026-01-03T10:00:00Z" modified="2026-01-03T10:00:00Z" visited="2026-01-03T10:00:00Z"/>
</xbel>
EOF

# Actions fixture: one user action with a parameter and a Quick Key, and one broken entry.
mkdir -p "$tmp/config/mbp115-spotlight"
echo '[{"name": "Touch Marker", "command": "touch {path}", "quickKey": "tmk", "params": ["path"]}, {"broken": true}]' \
    >"$tmp/config/mbp115-spotlight/actions.json"

# Dark mode fixture: a theme installed as fixed Dark/Light variants, like WhiteSur.
mkdir -p "$tmp/data/themes/Fixture-Dark" "$tmp/data/themes/Fixture-Light" "$tmp/config/gtk-4.0"
echo '/* dark-variant */' >"$tmp/config/gtk-4.0/gtk-Dark.css"
echo '/* light-variant */' >"$tmp/config/gtk-4.0/gtk-Light.css"
ln -s "$tmp/config/gtk-4.0/gtk-Dark.css" "$tmp/config/gtk-4.0/gtk.css"

export XDG_DATA_HOME=$tmp/data XDG_CONFIG_HOME=$tmp/config XDG_CACHE_HOME=$tmp/cache
export XDG_RUNTIME_DIR=$tmp/run SPOTLIGHT_TEST_OUT=$out
export SPOTLIGHT_TEST_MARKER=$tmp/marker SPOTLIGHT_TEST_DIR=$here

# The test extension goes first: disabling an extension also cycles every one enabled after it.
# Ubuntu 26.10's uutils timeout (0.12.0) aborted under a headless shell, so GNU's is preferred.
dbus-run-session -- bash -c "
    gsettings set org.gnome.shell enabled-extensions \"['$test_ext', '$ext']\"
    gsettings set org.gnome.shell disable-user-extensions false
    gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
    gsettings set org.gnome.desktop.wm.keybindings switch-input-source \"['XF86Keyboard']\"
    gsettings set org.gnome.shell.keybindings toggle-application-view \"['<Super>a']\"
    gsettings set org.gnome.desktop.interface color-scheme prefer-dark
    gsettings set org.gnome.desktop.interface gtk-theme Fixture-Dark
    gsettings set org.freedesktop.Tracker3.Miner.Files index-recursive-directories \"[]\"
    gsettings set org.freedesktop.Tracker3.Miner.Files index-single-directories \"[]\"
    gsettings set org.freedesktop.Tracker3.Miner.Files initial-sleep 0
    $(command -v gnutimeout || echo timeout) 120 gnome-shell --headless --wayland --no-x11 --virtual-monitor 1440x900
" >"$out/shell.log" 2>&1 || true

# Only the Shell's own criticals count; helper apps like Sushi complain about the headless session.
bad='JS ERROR|JS WARNING|\(gnome-shell:[0-9]+\): [A-Za-z -]*CRITICAL|Spurious|needs an allocation|mbp115-spotlight.*(error|warning)'
grep -E "SPOTLIGHT-TEST|$bad" "$out/shell.log" || true
if grep -qE "$bad" "$out/shell.log" || ! grep -q 'SPOTLIGHT-TEST PASS' "$out/shell.log"; then
    echo "FAILED, full log: $out/shell.log"
    exit 1
fi
echo "PASSED, screenshots in $out"
