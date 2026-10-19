// App shell: hash router + header. Screens live in js/screens/*.

import { h, $, clear, toast } from './ui/dom.js';
import { icon, avatar } from './ui/icons.js';
import { loadVocab } from './vocab/data.js';
import * as P from './vocab/progress.js';
import { serverAvailable } from './net/online.js';
import { renderHome, renderDaily, renderWord } from './screens/learn.js';
import { renderStats, renderHelp } from './screens/stats.js';
import { mountSearch } from './ui/search.js';
import { renderTopics, renderQuiz } from './screens/topics.js';
import { renderReview } from './screens/review.js';
import { renderSettings, renderCredits } from './screens/settings.js';
import { renderAccount } from './screens/account.js';
import { uploadAvatar } from './ui/avatar-draw.js';
import { isDrawnAvatar } from './ui/icons.js';
import * as prefs from './ui/prefs.js';
import { renderCreate, renderJoin, startQuick, startGroupRoom, joinCode, leaveCurrentRoom } from './screens/play.js';
import { renderFast, leaveFast } from './screens/fast.js';
import { renderGroup, stopGroupPolling } from './screens/group.js';
import { renderGroupQuiz, leaveGroupQuiz } from './game/quiz-view.js';
import * as G from './net/groups.js';

import { tr } from './i18n.js';
const view = $('#view');
let serverOk = false;

const NAV = [
  ['', 'home', tr('Trang chủ')],
  ['daily', 'calendar', tr('Học hôm nay'), tr('Hôm nay')],
  ['fast', 'flame', tr('Học nhanh')],
  ['topics', 'map', tr('Chủ đề')],
  ['review', 'repeat', tr('Ôn tập')],
  ['group', 'users', tr('Nhóm')],
  ['stats', 'chart', tr('Thống kê')],
];
const NAV2 = [
  ['account', 'user', tr('Tài khoản')],
  ['settings', 'settings', tr('Cài đặt')],
  ['help', 'help', tr('Trợ giúp')],
];
const TABS = ['', 'daily', 'fast', 'review', 'group']; // phone tab bar; the rest is in the profile menu
// Sub-pages highlight their parent entry.
const NAV_PARENT = { quiz: 'topics', credits: 'settings', play: '', join: '', room: '', gquiz: 'group', word: 'daily' };

function header() {
  const p = P.active();
  const streak = P.studyStreak(p);
  const menu = h('div.menu-pop', { hidden: true, role: 'menu' });
  const btn = h('button.profile-btn', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: serverOk ? 'Online' : tr('Offline – chỉ chơi cùng một máy') },
    h('span.av-wrap', avatar(p.name, p.avatar, 34), h('span.net-dot.' + (serverOk ? 'on' : 'off'))), h('span.profile-name', p.name), icon('chevronDown', { size: 16 }));
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', outside, true); };
  const outside = (e) => { if (!menu.contains(e.target) && !btn.contains(e.target)) close(); };
  btn.addEventListener('click', () => {
    if (!menu.hidden) return close();
    clear(menu).append(
      ...P.profiles().map((x) => h('button.menu-item' + (x.id === p.id ? '.on' : ''), { type: 'button', role: 'menuitem', onclick: () => {
        close();
        if (x.id !== p.id) { P.switchProfile(x.id); header(); route(); }
      } }, avatar(x.name, x.avatar, 24), h('span', x.name), x.id === p.id ? icon('check', { size: 16 }) : null)),
      h('hr'),
      ...[['topics', 'map', tr('Chủ đề')], ['stats', 'chart', tr('Thống kê')], ...NAV2].map(([r, ic, label]) => h('a.menu-item', { href: '#/' + r, role: 'menuitem', onclick: close }, icon(ic, { size: 18 }), h('span', label))),
      h('div.menu-status', h('span.net-dot.' + (serverOk ? 'on' : 'off')), serverOk ? tr('Đã kết nối server') : tr('Offline – chỉ chơi cùng một máy')));
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    setTimeout(() => document.addEventListener('click', outside, true));
  });
  clear($('#header-right')).append(
    h('span.streak' + (streak ? '' : '.zero'), { title: tr('Số ngày học liên tiếp') }, icon('flame', { size: 20 }), h('b', streak), h('span.streak-label', tr(' ngày liên tiếp'))),
    h('div.profile-wrap', btn, menu));
  renderNav();
}

function renderNav() {
  const [, name = ''] = location.hash.split('/');
  const cur = name in NAV_PARENT ? NAV_PARENT[name] : name;
  const link = (cls, short) => ([route, ic, label, s]) => h('a.' + cls + (route === cur ? '.active' : ''), { href: '#/' + route, title: label, 'aria-current': route === cur ? 'page' : null }, icon(ic, { size: 22 }), h('span', short && s ? s : label));
  clear($('#nav')).append(...NAV.map(link('nav-link')));
  clear($('#nav2')).append(...NAV2.map(link('nav-link')));
  clear($('#tabbar')).append(...NAV.filter(([r]) => TABS.includes(r)).map(link('tab', true)));
  document.body.classList.toggle('in-room', ['play', 'join', 'room', 'gquiz'].includes(name));
}

async function route() {
  const [, name = '', arg = '', rest = ''] = location.hash.split('/');
  // Leaving the room screen by navigation closes the room view.
  if (!['play', 'join', 'room'].includes(name)) leaveCurrentRoom();
  if (name !== 'group') stopGroupPolling();
  if (name !== 'gquiz') leaveGroupQuiz();
  if (name !== 'fast') leaveFast();
  window.scrollTo(0, 0);
  if ($('#header-right').childElementCount) header();
  else renderNav();
  // A group member's daily words come from the server: refresh before showing learning screens.
  if (['', 'daily', 'fast', 'topics', 'review', 'stats'].includes(name) && G.link()) {
    const at = location.hash;
    await G.syncQuick();
    if (location.hash !== at) return; // the user navigated on meanwhile
  }
  switch (name) {
    case '':
      return renderHome(view, { serverOk });
    case 'daily':
      return renderDaily(view, arg);
    case 'topics':
      return renderTopics(view);
    case 'fast':
      return renderFast(view, arg, rest);
    case 'quiz':
      return renderQuiz(view, arg);
    case 'review':
      return renderReview(view, arg);
    case 'account':
      return renderAccount(view, header, arg === 'scoring' ? rest || 'draw' : null);
    case 'settings':
      return renderSettings(view, () => { header(); route(); });
    case 'credits':
      return renderCredits(view);
    case 'stats':
      return renderStats(view);
    case 'help':
      return renderHelp(view);
    case 'word':
      return renderWord(view, arg);
    case 'group':
      return renderGroup(view, arg, rest.toUpperCase());
    case 'gquiz':
      return renderGroupQuiz(view, arg);
    case 'join':
    case 'room':
      return joinCode(view, arg);
    case 'play':
      leaveCurrentRoom();
      if (arg === 'quick') return startQuick(view);
      if (arg === 'group') return startGroupRoom(view);
      if (arg === 'join') return renderJoin(view, serverOk);
      return renderCreate(view, serverOk, arg === 'easy' ? 'easy' : 'mine');
    default:
      location.hash = '#/';
  }
}

/** Text that is written in index.html (title, sidebar footer, landmark labels). */
function translateStatic() {
  document.title = tr('Inklingo – Vẽ, đoán và nhớ từ TOEIC');
  document.querySelectorAll('[data-i18n-label]').forEach((el) => {
    el.dataset.i18nSrc ||= el.getAttribute('aria-label');
    el.setAttribute('aria-label', tr(el.dataset.i18nSrc));
  });
  const foot = $('#side-foot');
  if (foot) clear(foot).append(tr('Không liên kết với Detach Entertainment · Ảnh: Wikimedia Commons –') + ' ', h('a', { href: '#/credits' }, tr('giấy phép')));
}

async function boot() {
  prefs.apply();
  translateStatic();
  try {
    await loadVocab();
  } catch (e) {
    clear(view).append(h('div.card', h('h2', tr('Không tải được dữ liệu')), h('p', String(e.message || e)), h('p.small.muted', tr('Hãy chạy server bằng “npm start” và mở http://localhost:8787'))));
    return;
  }
  serverOk = location.protocol.startsWith('http') && (await serverAvailable());
  // A drawn avatar saved while offline is uploaded once the server is reachable.
  if (serverOk) for (const p of P.profiles()) if (isDrawnAvatar(p.avatar) && p.pic) uploadAvatar(p.pic);
  G.installHooks();
  mountSearch($('#search'));
  header();
  window.addEventListener('hashchange', route);
  await route();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    setTimeout(precacheTopic, 4000);
  }
}

/** Fetch the current topic's main photos in the background, so learning works offline later. */
function precacheTopic() {
  if (navigator.connection?.saveData) return;
  const t = P.currentTopic();
  if (!t) return;
  const urls = t.words.map((w) => w.images[0]?.file).filter(Boolean).map((f) => new URL(f, location.href).href);
  navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: 'precache', urls })).catch(() => {});
}

window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast(tr('Có lỗi xảy ra: ') + (e.reason?.message || e.reason), 'bad');
});

boot();
