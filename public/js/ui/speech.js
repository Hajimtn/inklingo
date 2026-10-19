// Speech input via the browser's own recogniser (Web Speech API: Chrome, Edge, Safari; not Firefox).
// Chrome sends the audio to its speech service; nothing is stored by Inklingo.

import { tr } from '../i18n.js';

const Recognition = () => (typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null);

export const canRecognize = () => !!Recognition();

const MESSAGES = {
  'not-allowed': tr('Hãy cho phép dùng micro trong trình duyệt'),
  'service-not-allowed': tr('Trình duyệt không cho dùng nhận dạng giọng nói'),
  'audio-capture': tr('Không tìm thấy micro'),
  'no-speech': tr('Không nghe thấy tiếng – kiểm tra micro rồi nói to hơn'),
  'no-match': tr('Nghe thấy tiếng nhưng chưa nhận ra từ – nói chậm, rõ hơn'),
  network: tr('Cần kết nối mạng để nhận dạng giọng nói'),
  aborted: '',
};
export const speechError = (code) => MESSAGES[code] ?? tr('Không nhận dạng được – thử lại');

let current = null;

/**
 * Listen for one short utterance. Resolves to [{text, conf}] (best first), rejects with {code}.
 *   onPartial(text) – words recognised so far, while the person is still speaking
 *   onState(s)      – 'audio' (mic is open), 'speech' (a voice is heard)
 *   onEvent(name, detail) – every raw recogniser event, for the mic test in Settings
 * A silent end after a voice was heard rejects with 'no-match' (heard sound, no words);
 * with no voice at all it rejects with 'no-speech'.
 */
export function listenOnce({ lang = 'en-US', alternatives = 5, timeout = 8000, onPartial, onState, onEvent } = {}) {
  stopListening();
  return new Promise((resolve, reject) => {
    const Rec = Recognition();
    if (!Rec) return reject({ code: 'unsupported' });
    try { speechSynthesis.cancel(); } catch { /* no TTS */ }
    const r = new Rec();
    current = r;
    r.lang = lang;
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = alternatives;
    let done = false;
    let voice = false;
    let partial = '';
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(watchdog);
      if (current === r) current = null;
      fn(v);
    };
    // Stop after `timeout`; if the recogniser then never reports back, give up a little later.
    const timer = setTimeout(() => { try { r.stop(); } catch { /* already stopped */ } }, timeout);
    const watchdog = setTimeout(() => {
      ev('timeout', 'no reply from the recogniser');
      try { r.abort(); } catch { /* ignore */ }
      if (partial) finish(resolve, [{ text: partial, conf: 0 }]);
      else finish(reject, { code: voice ? 'no-match' : 'no-speech' });
    }, timeout + 4000);
    const ev = (name, detail = '') => {
      try { onEvent?.(name, detail); } catch { /* the log must not break listening */ }
      console.debug('[speech]', name, detail);
    };
    for (const name of ['soundstart', 'speechend', 'soundend', 'audioend']) r.addEventListener(name, () => ev(name));
    r.onaudiostart = () => { ev('audiostart'); onState?.('audio'); };
    r.onspeechstart = () => { ev('speechstart'); voice = true; onState?.('speech'); };
    r.onresult = (e) => {
      const res = e.results[e.results.length - 1];
      ev(res.isFinal ? 'result' : 'interim', Array.from(e.results, (x) => x[0].transcript).join(''));
      if (!res.isFinal) {
        partial = Array.from(e.results, (x) => x[0].transcript).join('').trim();
        if (partial) onPartial?.(partial);
        return;
      }
      const alts = [];
      for (let i = 0; i < res.length; i++) alts.push({ text: res[i].transcript.trim(), conf: res[i].confidence || 0 });
      finish(resolve, alts);
    };
    r.onnomatch = () => { ev('nomatch'); voice = true; };
    r.onerror = (e) => {
      ev('error', e.error + (e.message ? ' – ' + e.message : ''));
      if (e.error === 'aborted' && partial) return finish(resolve, [{ text: partial, conf: 0 }]);
      finish(reject, { code: e.error === 'no-speech' && voice ? 'no-match' : e.error });
    };
    r.onend = () => {
      ev('end');
      if (partial) finish(resolve, [{ text: partial, conf: 0 }]);
      else finish(reject, { code: voice ? 'no-match' : 'no-speech' });
    };
    current.finishNow = () => { try { r.stop(); } catch { finish(reject, { code: 'aborted' }); } };
    try {
      r.start();
      ev('start', lang);
    } catch (err) {
      ev('error', 'start failed – ' + (err?.message || err));
      finish(reject, { code: 'aborted' });
    }
  });
}

/** Cancel listening. With `keep`, stop and grade what was heard so far instead. */
export function stopListening(keep = false) {
  if (!current) return;
  if (keep) return current.finishNow();
  try { current.abort(); } catch { /* ignore */ }
  current = null;
}
