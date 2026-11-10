#!/bin/bash
# Spotlight Search - run as a REGULAR user (sudo only for the search packages).
#   bash install.sh            list the changes, ask, install
#   bash install.sh remove     restore the previous shortcuts, remove the extension
#   bash install.sh status     exit 0 if installed and set up
# Installs ~/.local/share/gnome-shell/extensions/mbp115-spotlight@alexg-78 ("Spotlight Search", GPL-3.0-or-later,
# based on Spotlight by itsnin) and gives it ⌘Space and the Launchpad key F4 (its app view), like on macOS.
# An existing symlink there (development checkout) is kept. Previous shortcuts are saved in
# ~/.config/mbp115/spotlight.backup on the first install.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
UUID=mbp115-spotlight@alexg-78
OLD=spotlight@nin                     # the third-party original; it crashed the overview here
EXTDIR=$HOME/.local/share/gnome-shell/extensions/$UUID
B=$HOME/.config/mbp115/spotlight.backup
SK=org.gnome.shell.keybindings WM=org.gnome.desktop.wm.keybindings
PKGS=(gnome-sushi localsearch gir1.2-tsparql-3.0)     # Quick Look preview, file index, its query API
# ⌘ is Super on Apple keyboards; altwin:ctrl_win (GNOME Tweaks) or ctrl:swap_lwin_lctl (Mac layout) make it Ctrl
KEY='<Super>space'; gsettings get org.gnome.desktop.input-sources xkb-options | grep -qE 'altwin:ctrl_win|ctrl:swap_lwin_lctl' && KEY='<Control>space'
[ "$(id -u)" -ne 0 ] || { echo "Run without sudo (the extension is installed for your user)"; exit 1; }

spot() { gsettings --schemadir "$EXTDIR/schemas" "$@" 2>/dev/null; }
has() { gsettings get "$1" "$2" | grep -qF "'$3'"; }
strv_drop() {
    local cur; cur=$(gsettings get "$1" "$2")
    gsettings set "$1" "$2" "$(echo "$cur" | sed "s/, '$3'//; s/'$3', //; s/'$3'//; s/^@as //")"
}
enabled() { gsettings get org.gnome.shell enabled-extensions | grep -qF "'$1'"; }
ext() {   # ext enable|disable <uuid>; works before GNOME has seen a new extension (active after the next login)
    gnome-extensions "$1" "$2" 2>/dev/null && return 0
    local cur; cur=$(gsettings get org.gnome.shell enabled-extensions)
    if [ "$1" = enable ]; then
        case $cur in *"'$2'"*) ;; "@as []"|"[]") gsettings set org.gnome.shell enabled-extensions "['$2']" ;;
            *) gsettings set org.gnome.shell enabled-extensions "${cur%]}, '$2']" ;; esac
    else
        gsettings set org.gnome.shell enabled-extensions "$(echo "$cur" | sed "s/, '$2'//;s/'$2', //;s/'$2'//")"
    fi
}
own_key() {   # another shortcut picked in Spotlight's settings stays
    local c; c=$(spot get org.gnome.shell.extensions.mbp115-spotlight toggle-spotlight 2>/dev/null)
    [ -n "$c" ] && [ "$c" != "@as []" ] && [[ $c != *"'<Super>space'"* && $c != *"'<Control>space'"* ]]
}
applied() {
    enabled "$UUID" && ! enabled "$OLD" && [ -d "$EXTDIR/schemas" ] \
        && { [ -L "$EXTDIR" ] || diff -rq -x gschemas.compiled "$here/extension/$UUID" "$EXTDIR" >/dev/null; } \
        && { own_key || spot get org.gnome.shell.extensions.mbp115-spotlight toggle-spotlight | grep -qF "'$KEY'"; } \
        && ! has $SK toggle-overview "$KEY" && ! has $SK toggle-application-view XF86LaunchB \
        && ! has $WM switch-input-source "$KEY"
}

case ${1:-install} in
  install)
    applied && { echo "Spotlight Search is already set up."; exit 0; }
    cat <<TXT
This installs Spotlight Search for your user and sets these shortcuts (⌘ = Command):
   ⌘Space   opens Spotlight Search (GNOME's overview stays on F3)
   F4       Launchpad key: Spotlight's app view instead of GNOME's app grid
   $([ "$KEY" = '<Super>space' ] && echo "⌃Space   stays free for apps (e.g. autocomplete in editors)" \
        || echo "         (⌘ sends Ctrl here, so the binding is Ctrl+Space)")
   packages via apt (sudo), if missing: ${PKGS[*]}
   the older third-party "Spotlight" ($OLD) is turned off if it is on
Your current shortcuts are saved first. Undo: bash $0 remove
TXT
    if [ -z "${MBP115_ANSWERS:-}" ]; then   # with setup.sh --answers the user chose it in MacBook Pro Setup
        [ -t 0 ] || { echo "Not asking without a terminal - nothing changed."; exit 3; }
        read -r -p "   Install Spotlight Search? [Y/n] " a
        [[ ${a:-y} =~ ^[YyJj] ]] || { echo "Nothing changed."; exit 3; }
    fi

    missing=(); for p in "${PKGS[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p"); done
    [ ${#missing[@]} -eq 0 ] || sudo apt-get install -y -qq "${missing[@]}" >/dev/null || exit 1

    if [ ! -e "$B" ]; then    # only the first install saves: later runs must not overwrite the originals
        mkdir -p "${B%/*}"
        { for k in "$SK toggle-overview" "$SK toggle-application-view" "$WM switch-input-source"; do
              echo "$k $(gsettings get $k)"; done
          echo "old $(enabled "$OLD" && echo on || echo off)"
          echo "dir $([ -e "$EXTDIR" ] && echo existed || echo new)"; } > "$B"
    fi
    if [ -L "$EXTDIR" ]; then
        echo "   keeping the development symlink $EXTDIR -> $(readlink "$EXTDIR")"
    else
        rm -rf "$EXTDIR" && mkdir -p "$EXTDIR" && cp -r "$here/extension/$UUID/." "$EXTDIR/" || exit 1
    fi
    glib-compile-schemas "$EXTDIR/schemas" || exit 1

    own_key || spot set org.gnome.shell.extensions.mbp115-spotlight toggle-spotlight "['$KEY']"
    strv_drop $SK toggle-overview "$KEY"
    strv_drop $SK toggle-application-view XF86LaunchB
    strv_drop $WM switch-input-source "$KEY"
    enabled "$OLD" && ext disable "$OLD"
    ext enable "$UUID"
    applied || { echo "Spotlight Search is installed, but not all settings took effect."; exit 1; }
    gnome-extensions info "$UUID" >/dev/null 2>&1 && echo "Done - press ⌘Space." \
        || echo "Done. Log out once and back in, then press ⌘Space."
    ;;
  remove)
    [ -e "$B" ] || { echo "No backup ($B) - nothing to restore."; exit 0; }
    ext disable "$UUID"
    while read -r s k v; do
        case $s in
            old) [ "$k" = on ] && ext enable "$OLD" ;;
            dir) [ "$k" = new ] && [ ! -L "$EXTDIR" ] && rm -rf "$EXTDIR" ;;
            *) gsettings set "$s" "$k" "$v" ;;
        esac
    done < "$B"
    rm -f "$B"
    echo "Previous shortcuts restored, Spotlight Search removed (the search packages stay installed)."
    ;;
  status) applied ;;
  *) echo "Usage: $0 [install|remove|status]"; exit 2 ;;
esac
