// Interface language. The Vietnamese text is the key; i18n/en.js maps it to English.
//   tr('Đã lưu hồ sơ')                       -> 'Profile saved'
//   tr('{n} từ đến hạn', { n: 3 })           -> '3 words due'   (EN value may be [one, many])
// Vocabulary content (meanings, explanations) stays Vietnamese: the learners are Vietnamese.

import EN from './i18n/en.js';
import * as prefs from './ui/prefs.js';

const DICTS = { en: EN };
export const LANGS = [['vi', 'Tiếng Việt'], ['en', 'English']];
export const lang = () => (prefs.get('lang') === 'en' ? 'en' : 'vi');

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);

export function tr(vi, vars) {
  const d = DICTS[lang()];
  let out = d ? d[vi] : vi;
  if (Array.isArray(out)) out = vars && Number(vars.n) === 1 ? out[0] : out[1];
  if (out == null) out = vi;
  return fill(out, vars);
}

/** Messages that arrive as finished Vietnamese text (from the server): translate known patterns. */
export function tServer(text) {
  if (lang() === 'vi' || !text) return text;
  if (EN[text] != null) return tr(text);
  for (const [re, en] of EN_PATTERNS) {
    const m = re.exec(text);
    if (m) return en.replace(/\$(\d)/g, (_, i) => m[+i]);
  }
  return text;
}

// Server texts with values inside (game-core.js, groups.js, server.js).
const EN_PATTERNS = [
  [/^(.+) đã vào phòng\.$/, '$1 joined the room.'],
  [/^(.+) đã mất kết nối\.$/, '$1 lost the connection.'],
  [/^(.+) đã rời phòng\.$/, '$1 left the room.'],
  [/^(.+) là chủ phòng mới\.$/, '$1 is the new host.'],
  [/^Bạn đã gửi “(.+)” rồi\.$/, 'You already sent “$1”.'],
  [/^Từ của lượt dang dở: (.+)$/, 'Word of the unfinished turn: $1'],
  [/^Không tìm thấy phòng ?(.*)\.$/, 'Room $1 not found.'],
  [/^Nhóm đã đủ (\d+) người$/, 'The group is full ($1 people)'],
];
