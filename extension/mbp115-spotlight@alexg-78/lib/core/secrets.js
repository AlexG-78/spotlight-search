// Spotlight Search: decides what must never enter the clipboard history (R6.3)
// SPDX-License-Identifier: GPL-3.0-or-later

// Set by password managers: KDE's hint (KeePassXC, Bitwarden, KDE apps) and the nspasteboard.org
// types that cross-platform apps send along.
const SECRET_MIMES = ['x-kde-passwordManagerHint', 'org.nspasteboard.ConcealedType', 'org.nspasteboard.TransientType'];

const PATTERNS = [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
    /^eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}$/, // JWT
    /^(gh[pousr]_|github_pat_|glpat-|sk-|sk_live_|rk_live_|xox[abpr]-|AKIA|ASIA|AIza|ya29\.|npm_|pypi-)[\w.-]{12,}$/,
];

export function hasSecretHint(mimetypes) {
    return mimetypes.some(m => SECRET_MIMES.includes(m));
}

// apps: substrings of window classes / app ids, e.g. 'bitwarden'.
export function isSecretApp(windowClass, apps) {
    const name = (windowClass ?? '').toLowerCase();
    return name !== '' && apps.some(app => name.includes(app.toLowerCase()));
}

function luhn(digits) {
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
        let d = Number(digits[digits.length - 1 - i]);
        if (i % 2) {
            d *= 2;
            if (d > 9)
                d -= 9;
        }
        sum += d;
    }
    return sum % 10 === 0;
}

// A generated password: one word without spaces, mixing at least three of lower, upper, digits
// and symbols, and mostly not made of word pieces. Names like getUserById2 or x86_64-linux-gnu
// are at least half word pieces (get, User, linux); random strings are not. Hex hashes and UUIDs
// stay: copied all the time and not secret by themselves.
// shortcut: catches about 60 % of 14-char letters+digits passwords and 80 % with symbols; the
// MIME hint, app list and wipe detection carry the rest. Tune with real misses if any show up.
function looksGenerated(text) {
    if (!/^\S{8,128}$/.test(text) || /^[0-9a-f-]+$/i.test(text) ||
        /^[a-z][\w+.-]*:\/\/|^[\w.+-]+@[\w-]+\.[\w.]+$|^[~/.]/i.test(text))
        return false;
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(c => c.test(text)).length;
    if (classes < 3)
        return false;
    const wordChars = (text.match(/[A-Z]?[a-z]{2,}|[A-Z]{3,}/g) ?? []).filter(w => w.length >= 3).join('').length;
    return wordChars / text.length < 0.5;
}

export function looksSecret(text) {
    const t = text.trim();
    if (PATTERNS.some(p => p.test(t)))
        return true;
    const digits = t.replace(/[ -]/g, '');
    if (/^\d{13,19}$/.test(digits) && /^[\d -]+$/.test(t) && luhn(digits))
        return true; // card number
    return looksGenerated(t);
}
