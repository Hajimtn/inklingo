// Speech input via the browser's own recogniser (Web Speech API: Chrome, Edge, Safari; not Firefox).
// Chrome sends the audio to its speech service; nothing is stored by Inklingo.

import { tr } from '../i18n.js';

const Recognition = () => (typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null);

export const canRecognize = () => !!Recognition();

const MESSAGES = {
  'not-allowed': tr('Hãy cho phép dùng micro trong trình duyệt'),
  'service-not-allowed': tr('Trình duyệt không cho dùng nhận dạng giọng nói'),
  'audio-capture': tr('Không tìm thấy micro'),
  'no-speech': tr('Không nghe thấy gì – thử lại'),
  network: tr('Cần kết nối mạng để nhận dạng giọng nói'),
  aborted: '',
};
export const speechError = (code) => MESSAGES[code] ?? tr('Không nhận dạng được – thử lại');

let current = null;

/** Listen for one short utterance. Resolves to [{text, conf}] (best first), rejects with {code}. */
export function listenOnce({ lang = 'en-US', alternatives = 5, timeout = 7000 } = {}) {
  stopListening();
  return new Promise((resolve, reject) => {
    const Rec = Recognition();
    if (!Rec) return reject({ code: 'unsupported' });
    try { speechSynthesis.cancel(); } catch { /* no TTS */ }
    const r = new Rec();
    current = r;
    r.lang = lang;
    r.continuous = false;
    r.interimResults = false;
    r.maxAlternatives = alternatives;
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (current === r) current = null;
      fn(v);
    };
    const timer = setTimeout(() => { try { r.stop(); } catch { /* already stopped */ } }, timeout);
    r.onresult = (e) => {
      const res = e.results[0];
      const alts = [];
      for (let i = 0; i < res.length; i++) alts.push({ text: res[i].transcript, conf: res[i].confidence || 0 });
      finish(resolve, alts);
    };
    r.onerror = (e) => finish(reject, { code: e.error });
    r.onend = () => finish(reject, { code: 'no-speech' });
    try {
      r.start();
    } catch {
      finish(reject, { code: 'aborted' });
    }
  });
}

export function stopListening() {
  if (!current) return;
  try { current.abort(); } catch { /* ignore */ }
  current = null;
}
