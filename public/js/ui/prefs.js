// Game settings of this device (not per profile): theme, text size, motion, language, voice.

const KEY = 'sw:prefs';
const DEFAULTS = { theme: 'system', font: 'm', motion: 'full', lang: 'vi', voice: '', rate: 0.85, autoSpeak: true };

function load() {
  let p = {};
  try {
    p = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    // Older builds kept only the speech rate.
    const oldRate = Number(localStorage.getItem('sw:ttsRate'));
    if (p.rate == null && oldRate) p.rate = oldRate;
  } catch {
    p = {}; // no storage (private mode, tests)
  }
  return { ...DEFAULTS, ...p };
}

let prefs = load();
const listeners = new Set();

export const get = (k) => prefs[k];
export const all = () => ({ ...prefs });

export function set(k, v) {
  prefs = { ...prefs, [k]: v };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage blocked: the setting lasts for this visit */
  }
  apply();
  for (const fn of listeners) fn(k, v);
}

export const onChange = (fn) => listeners.add(fn);

const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
media?.addEventListener?.('change', () => apply());

/** Reflect the settings on <html>: data-theme (light|dark), data-font (s|m|l), data-motion, lang. */
export function apply() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && media?.matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.font = prefs.font;
  root.dataset.motion = prefs.motion;
  root.lang = prefs.lang;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#1c1814' : '#fbf7f1';
}
