// Tiny DOM helpers shared by every screen.

import * as prefs from './prefs.js';

import { tr } from '../i18n.js';
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** h('div.card#id', {onclick, ...attrs}, ...children) */
export function h(tag, attrs, ...children) {
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9-]*)(.*)$/i);
  const el = document.createElement(name || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  // A first argument that is not an attribute object is content (including 0 and '').
  if (attrs !== null && attrs !== undefined && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

let toastTimer;
export function toast(text, kind = '') {
  let t = $('#toast');
  if (!t) document.body.append((t = h('div#toast')));
  t.textContent = text;
  t.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 2600);
}

/** Non-blocking modal. Resolves with the value of the clicked button. */
export function dialog({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], dismissable = true, className = '' }) {
  return new Promise((resolve) => {
    const close = (v) => {
      layer.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissable) close(null);
    };
    const box = h('div.dialog' + (className ? '.' + className : ''), { role: 'dialog', 'aria-modal': 'true' },
      title ? h('h2', title) : null,
      body instanceof Node ? body : h('p', body || ''),
      h('div.dialog-actions', buttons.map((b) => h('button.btn' + (b.primary ? '.primary' : '') + (b.danger ? '.danger' : ''), { onclick: () => close(b.value) }, b.label))));
    const layer = h('div.dialog-layer', { onclick: (e) => { if (e.target === layer && dismissable) close(null); } }, box);
    document.body.append(layer);
    document.addEventListener('keydown', onKey);
    const primary = box.querySelector('.btn.primary');
    if (primary) setTimeout(() => primary.focus(), 0);
  });
}

export const confirmDialog = (title, body, okLabel = tr('Đồng ý'), danger = false) =>
  dialog({ title, body, buttons: [{ label: tr('Hủy'), value: false }, { label: okLabel, value: true, primary: !danger, danger }] }).then(Boolean);

export function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
}

/** English voices this browser offers (for the voice setting). */
export function englishVoices() {
  if (!('speechSynthesis' in window)) return [];
  return speechSynthesis.getVoices().filter((v) => /^en([-_]|$)/i.test(v.lang));
}

export function speak(text, rate) {
  if (!('speechSynthesis' in window)) return false;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = englishVoices();
    const voice = voices.find((v) => v.voiceURI === prefs.get('voice')) || voices.find((v) => /^en[-_]US/i.test(v.lang)) || voices[0];
    u.lang = voice?.lang || 'en-US';
    u.rate = rate || prefs.get('rate') || 0.85;
    if (voice) u.voice = voice;
    speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

/** Pronounce a word automatically (after an answer is revealed) unless the player turned it off. */
export const autoSpeak = (text) => (prefs.get('autoSpeak') ? speak(text) : false);

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
