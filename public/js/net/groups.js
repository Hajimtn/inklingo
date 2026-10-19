// Study-group client: REST calls to /api/group/*, the group link stored on the profile,
// syncing the shared schedule into the profile and queueing progress reports.

import * as P from '../vocab/progress.js';
import { toast } from '../ui/dom.js';

import { tr, tServer } from '../i18n.js';
const cache = new Map(); // profileId -> last group state

export const link = (p = P.active()) => p?.group || null;
export const lastState = (p = P.active()) => cache.get(p.id) || null;

const auth = (p) => ({ code: p.group.code, memberId: p.group.memberId, secret: p.group.secret, date: P.today() });

export class ApiError extends Error {
  constructor(text, status) {
    super(text);
    this.status = status;
  }
}

async function api(action, body) {
  let res;
  try {
    res = await fetch('api/group/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError(tr('Không kết nối được server'), 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ? tServer(data.error) : tr('Lỗi máy chủ'), res.status);
  return data;
}

function applied(p, state) {
  cache.set(p.id, state);
  // Keep the name stored with the link current (the leader may have renamed the group).
  if (p.group && state?.name && p.group.name !== state.name) {
    p.group.name = state.name;
    P.save();
  }
  P.applyGroupState(p, state);
  return state;
}

/** Credentials lost (kicked, group deleted): unlink so the profile goes back to solo learning. */
function dropLink(p, e) {
  if (e.status === 403 || e.status === 404) {
    P.setGroupLink(p, null);
    cache.delete(p.id);
    toast(tr('Bạn không còn trong nhóm'), 'bad');
  }
}

export async function createGroup(name, p = P.active()) {
  const r = await api('create', { name, member: { name: p.name, avatar: p.avatar }, tz: -new Date().getTimezoneOffset(), date: P.today() });
  P.setGroupLink(p, { code: r.code, memberId: r.id, secret: r.secret, name: r.state.name });
  return applied(p, r.state);
}

export async function joinGroup(code, p = P.active()) {
  const r = await api('join', { code, member: { name: p.name, avatar: p.avatar }, date: P.today() });
  P.setGroupLink(p, { code: r.code, memberId: r.id, secret: r.secret, name: r.state.name });
  return applied(p, r.state);
}

/** Recovery code = "CODE.memberId.secret" – lets the same member continue on another device. */
export const recoveryCode = (p = P.active()) => (p.group ? `${p.group.code}.${p.group.memberId}.${p.group.secret}` : '');

export async function restore(text, p = P.active()) {
  const [code, memberId, secret] = String(text || '').trim().split('.');
  if (!code || !memberId || !secret) throw new ApiError(tr('Mã khôi phục không hợp lệ'), 400);
  const r = await api('state', { code, memberId, secret, date: P.today() });
  P.setGroupLink(p, { code: r.state.code, memberId, secret, name: r.state.name });
  return applied(p, r.state);
}

export async function sync(p = P.active()) {
  if (!p?.group) return null;
  await flush(p);
  try {
    return applied(p, (await api('state', auth(p))).state);
  } catch (e) {
    dropLink(p, e);
    throw e;
  }
}

/** sync() that never blocks a screen for long (offline -> keep the last mirrored schedule). */
export function syncQuick(p = P.active(), ms = 2500) {
  if (!p?.group) return Promise.resolve(null);
  return Promise.race([sync(p).catch(() => null), new Promise((r) => setTimeout(() => r(null), ms))]);
}

async function call(action, extra = {}, p = P.active()) {
  try {
    return applied(p, (await api(action, { ...auth(p), ...extra })).state);
  } catch (e) {
    dropLink(p, e);
    throw e;
  }
}

export const openQuiz = (p) => call('open-quiz', {}, p);
export const kick = (target, p) => call('kick', { target }, p);
export const rename = (name, p) => call('rename', { name }, p);
export const updateProfile = (p = P.active()) => (p.group ? call('profile', { member: { name: p.name, avatar: p.avatar } }, p).catch(() => null) : null);

export async function leave(p = P.active()) {
  try {
    await api('leave', auth(p));
  } finally {
    P.setGroupLink(p, null);
    cache.delete(p.id);
  }
}

// ------------------------------------------------------------------ progress reports

const timers = new Map();

function queue(p, report) {
  if (!p?.group) return;
  P.pushGroupReport(p, report);
  clearTimeout(timers.get(p.id));
  timers.set(p.id, setTimeout(() => flush(p).catch(() => {}), 1200));
}

async function flush(p) {
  const reports = P.takeGroupReports(p);
  if (!reports.length) return;
  try {
    applied(p, (await api('report', { ...auth(p), reports })).state);
  } catch (e) {
    if (e.status === 0) P.returnGroupReports(p, reports); // offline: keep for later
    else dropLink(p, e);
  }
}

/** Connect progress.js events to the group (called once at start-up). */
export function installHooks() {
  P.setGroupHooks({
    learned: (p) => queue(p, { kind: 'learned' }),
    recall: (p, { ok, source, cleared }) => queue(p, { kind: 'recall', source, ok: ok ? 1 : 0, bad: ok ? 0 : 1, cleared }),
    match: (p, points) => queue(p, { kind: 'match', points }),
  });
}
