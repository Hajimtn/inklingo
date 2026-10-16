// Original line-icon set (24×24, stroke = currentColor) used instead of emoji everywhere in the UI,
// plus colour/initial avatars. Icons are built from simple primitives so they render identically
// on every OS (emoji glyphs differ per platform and read as decoration rather than controls).

const NS = 'http://www.w3.org/2000/svg';

// Each icon is a list of [tag, attrs] primitives.
const P = (d) => ['path', { d }];
const C = (cx, cy, r) => ['circle', { cx, cy, r }];
const R = (x, y, width, height, rx = 0) => ['rect', { x, y, width, height, rx }];
const L = (x1, y1, x2, y2) => ['line', { x1, y1, x2, y2 }];

const SHAPES = {
  // navigation / actions
  play: [P('M7 4.5v15l12.5-7.5z')],
  home: [P('M3.5 11 12 4l8.5 7'), P('M6 9.5V20h12V9.5'), P('M10 20v-5.5h4V20')],
  door: [P('M5 20.5V4.5A1.5 1.5 0 0 1 6.5 3h8A1.5 1.5 0 0 1 16 4.5v16'), L(3, 20.5, 21, 20.5), C(13, 12, 0.6), P('M16 7h3v13.5')],
  login: [P('M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14'), P('M4 12h11'), P('M11 8l4 4-4 4')],
  logout: [P('M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10'), P('M9 12h11'), P('M16 8l4 4-4 4')],
  calendar: [R(3.5, 5, 17, 15.5, 2), L(3.5, 10, 20.5, 10), L(8, 3, 8, 7), L(16, 3, 16, 7), P('M8 14h2M14 14h2M8 17h2')],
  map: [P('M3.5 6.5 9 4l6 2.5L20.5 4v13.5L15 20l-6-2.5-5.5 2.5z'), L(9, 4, 9, 17.5), L(15, 6.5, 15, 20)],
  repeat: [P('M4 12a8 8 0 0 1 13.7-5.6L20 8.5'), P('M20 3.5v5h-5'), P('M20 12a8 8 0 0 1-13.7 5.6L4 15.5'), P('M4 20.5v-5h5')],
  settings: [C(12, 12, 3), P('M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1')],
  back: [P('M15 5l-7 7 7 7')],
  next: [P('M9 5l7 7-7 7')],
  arrowRight: [P('M4 12h15'), P('M13 6l6 6-6 6')],
  check: [P('M4.5 12.5l5 5 10-11')],
  checkCircle: [C(12, 12, 9), P('M8 12.5l2.8 2.8L16.5 9.5')],
  xCircle: [C(12, 12, 9), P('M9 9l6 6M15 9l-6 6')],
  close: [P('M6 6l12 12M18 6 6 18')],
  plus: [P('M12 5v14M5 12h14')],
  volume: [P('M4 9.5h3.5L12 5.5v13l-4.5-4H4z'), P('M15.5 9a4 4 0 0 1 0 6'), P('M18 6.5a7.5 7.5 0 0 1 0 11')],
  mic: [P('M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3z'), P('M5.5 11a6.5 6.5 0 0 0 13 0'), L(12, 17.5, 12, 20.5), L(9, 20.5, 15, 20.5)],
  bulb: [P('M9 17.5h6'), P('M10 20.5h4'), P('M8.5 14.5A6 6 0 1 1 15.5 14.5c-.7.6-1 1.3-1 2v1h-5v-1c0-.7-.3-1.4-1-2z')],
  lock: [R(5, 10.5, 14, 10, 2), P('M8 10.5V7.5a4 4 0 0 1 8 0v3'), L(12, 14.5, 12, 16.5)],
  trophy: [P('M8 4h8v5a4 4 0 0 1-8 0z'), P('M8 6H4.5v1.5A3.5 3.5 0 0 0 8 11M16 6h3.5v1.5A3.5 3.5 0 0 1 16 11'), P('M12 13v4M8.5 20.5h7M10 17h4v3.5h-4z')],
  chat: [P('M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z')],
  pencil: [P('M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z'), L(13.5, 7, 16.5, 10)],
  users: [C(9, 8, 3.5), P('M2.5 20a6.5 6.5 0 0 1 13 0'), P('M15.5 4.8a3.5 3.5 0 0 1 0 6.4'), P('M18 14a6.5 6.5 0 0 1 3.5 6')],
  crown: [P('M3.5 8l4.5 4 4-6.5 4 6.5 4.5-4-2 10.5h-13z')],
  copy: [R(8.5, 8.5, 12, 12, 2), P('M15.5 8.5v-3A1.5 1.5 0 0 0 14 4H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3')],
  link: [P('M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2'), P('M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2')],
  offline: [P('M2.5 9a14 14 0 0 1 4.6-2.8M10.5 5.6A14 14 0 0 1 21.5 9'), P('M5.5 12.5a9 9 0 0 1 3.3-2M13.5 10.3a9 9 0 0 1 5 2.2'), P('M9 16a4.5 4.5 0 0 1 6 0'), C(12, 19.5, 0.7), L(3, 3, 21, 21)],
  eyeOff: [P('M3 12s3.5-6.5 9-6.5c1.6 0 3 .5 4.2 1.2M21 12s-3.5 6.5-9 6.5c-1.6 0-3-.5-4.2-1.2'), P('M9.9 9.9a3 3 0 0 0 4.2 4.2'), L(3, 3, 21, 21)],
  skip: [P('M5 5l9 7-9 7z'), L(18, 5, 18, 19)],
  handoff: [P('M9 14 4 9l5-5'), P('M4 9h11a5 5 0 0 1 0 10h-3')],
  book: [P('M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z'), P('M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z')],
  test: [R(5, 3.5, 14, 17, 2), P('M8.5 8h7M8.5 12h7M8.5 16h4')],
  star: [P('M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z')],
  image: [R(3.5, 4.5, 17, 15, 2), C(9, 9.5, 1.8), P('M20.5 16l-5-5-9 8.5')],
  trash: [P('M4 6.5h16M9.5 6.5V4h5v2.5'), P('M6.5 6.5l1 14h9l1-14'), L(10.5, 10, 10.5, 17), L(13.5, 10, 13.5, 17)],
  camera: [P('M3.5 8.5A1.5 1.5 0 0 1 5 7h2.5L9 4.5h6L16.5 7H19a1.5 1.5 0 0 1 1.5 1.5v10A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5z'), C(12, 13, 3.5)],
  globe: [C(12, 12, 8.5), P('M3.5 12h17'), P('M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z')],
  phone: [R(7, 2.5, 10, 19, 2), L(11, 18.5, 13, 18.5)],
  shuffle: [P('M3.5 7h3c4.5 0 6.5 10 11 10h3'), P('M18 14.5l2.5 2.5-2.5 2.5'), P('M3.5 17h3c1.7 0 3-1.4 4-3M13.5 10c1-1.6 2.3-3 4-3h3'), P('M18 4.5 20.5 7 18 9.5')],
  ghost: [P('M5.5 20.5V11a6.5 6.5 0 0 1 13 0v9.5l-2.2-1.6-2.1 1.6-2.2-1.6-2.2 1.6-2.1-1.6z'), C(9.5, 11, 0.8), C(14.5, 11, 0.8)],
  palette: [P('M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1-.8-1.4-.8-2.3 0-1 .8-1.6 1.8-1.6h1.9a3.8 3.8 0 0 0 3.8-3.8c0-4.3-3.8-7.6-8.5-7.6z'), C(7.5, 12, 1), C(9.5, 7.8, 1), C(14.5, 7.8, 1)],
  user: [C(12, 8, 4), P('M4 20.5a8 8 0 0 1 16 0')],
  info: [C(12, 12, 9), L(12, 11, 12, 16.5), C(12, 7.8, 0.6)],
  clock: [C(12, 12, 8.5), P('M12 7.5V12l3 2')],
  flame: [P('M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.4-5.4 3.6-8.3.9 1.6 1.8 2.4 2.9 2.9C12.6 6.6 13.5 4.6 15 3c.6 3.7 3.5 6.3 3.5 11.2 0 3.9-2.6 6.8-6.5 6.8z')],

  search: [C(11, 11, 6.5), L(16, 16, 20.5, 20.5)],
  chevronDown: [P('M6 9l6 6 6-6')],
  chart: [L(4, 20.5, 20.5, 20.5), R(5.5, 12, 3, 6.5, .8), R(10.5, 6.5, 3, 12, .8), R(15.5, 9.5, 3, 9, .8)],
  help: [C(12, 12, 9), P('M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.8'), C(12, 17, 0.6)],
  cards: [R(7.5, 3.5, 12, 15, 2), P('M4.5 7v11.5A2 2 0 0 0 6.5 20.5H15')],
  menu: [L(4, 7, 20, 7), L(4, 12, 20, 12), L(4, 17, 20, 17)],

  // topic icons
  briefcase: [R(3.5, 7, 17, 12.5, 2), P('M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7'), P('M3.5 12.5h17')],
  plane: [P('M10.5 3.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5v6l7.5 4.5v2l-7.5-2.5v4.5l2 1.5V21l-3.5-1-3.5 1v-1.5l2-1.5V13l-7.5 2.5v-2L10.5 9.5z')],
  bell: [P('M4 17.5h16'), P('M5.5 17.5a6.5 6.5 0 0 1 13 0'), L(12, 8.5, 12, 11), L(10, 8.5, 14, 8.5), L(3, 20.5, 21, 20.5)],
  bag: [P('M5 8h14l-1 12.5H6z'), P('M9 10V7a3 3 0 0 1 6 0v3')],
  wrench: [P('M14.5 4.2a5 5 0 0 0-5.3 6.6L3.7 16.3a2 2 0 0 0 2.9 2.9l5.5-5.5a5 5 0 0 0 6.6-5.3l-3 3-2.8-.6-.6-2.8z')],
  stethoscope: [P('M6 3.5v5a4.5 4.5 0 0 0 9 0v-5'), P('M10.5 13v2.5a4.5 4.5 0 0 0 9 0v-2'), C(19.5, 11.5, 2), L(4.5, 3.5, 7.5, 3.5), L(13.5, 3.5, 16.5, 3.5)],
  hardhat: [P('M3 17.5h18v2H3z'), P('M5 17.5V15a7 7 0 0 1 14 0v2.5'), P('M10 8.5V6h4v2.5')],
  presentation: [R(3.5, 4, 17, 11, 1.5), L(2.5, 4, 21.5, 4), P('M12 15v3M8.5 21l3.5-3 3.5 3'), P('M7.5 11.5l3-3 2.5 2 3.5-3.5')],
  factory: [P('M3 20.5V10l5 3V10l5 3V10l5 3V4.5h3v16z'), P('M7 17h2M12 17h2M17 17h1')],
  banknote: [R(2.5, 6, 19, 12, 2), C(12, 12, 2.8), P('M6 9.5v5M18 9.5v5')],
  megaphone: [P('M3.5 10v4h3l8.5 4.5v-13L6.5 10z'), P('M7 14l1.5 5.5h2.5L10 15'), P('M18.5 9.5a3.5 3.5 0 0 1 0 5')],
};

/** icon('play', {size: 20, label}) -> <svg>. Decorative unless a label is given. */
export function icon(name, { size = 20, label, className = '' } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('class', ('ico ' + className).trim());
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  for (const [tag, attrs] of SHAPES[name] || SHAPES.info) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  if (name === 'play' || name === 'skip') svg.firstChild.setAttribute('fill', 'currentColor');
  return svg;
}

export const hasIcon = (name) => name in SHAPES;

// ------------------------------------------------------------------ avatars

/** Avatar colours. A profile stores the key ("c0"…"c11"); the face is the first letter of the name. */
// Earthy tones that sit on the cream paper UI (all keep light text readable).
export const AVATAR_COLORS = ['#bc4b24', '#1c3a28', '#b7791f', '#3f5f8a', '#7b3f61', '#2f7a6f', '#8a5a2b', '#5c6b45', '#a8352a', '#4a5a7a', '#6b4a3a', '#8e5a7c'];
export const AVATAR_KEYS = AVATAR_COLORS.map((_, i) => 'c' + i);

export function avatarColor(key) {
  const m = /^c(\d{1,2})$/.exec(String(key || ''));
  if (m && AVATAR_COLORS[+m[1]]) return AVATAR_COLORS[+m[1]];
  // Legacy/unknown value (e.g. an old emoji avatar): derive a stable colour from it.
  let hsh = 0;
  for (const ch of String(key || '')) hsh = (hsh * 31 + ch.codePointAt(0)) >>> 0;
  return AVATAR_COLORS[hsh % AVATAR_COLORS.length];
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const last = parts[parts.length - 1];
  // "Người chơi 2" -> "N2"; "Lan Anh" -> "LA"; "Minh" -> "M"
  if (parts.length > 1 && /^\d+$/.test(last)) return (parts[0][0] + last).toUpperCase().slice(0, 3);
  return (parts.length > 1 ? parts[0][0] + last[0] : parts[0][0]).toUpperCase();
}

/** <span class="avatar"> with a coloured disc and the player's initials. */
export function avatar(name, key, size = 36) {
  const el = document.createElement('span');
  el.className = 'avatar';
  el.style.setProperty('--av', avatarColor(key));
  el.style.width = el.style.height = size + 'px';
  el.style.fontSize = Math.round(size * 0.4) + 'px';
  el.setAttribute('aria-hidden', 'true');
  el.textContent = initials(name);
  return el;
}
