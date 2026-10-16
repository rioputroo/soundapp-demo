// Audio contoh (WAV) dibuat di browser, plus suara pembayaran (Web Speech API, cadangan: nada).
const SR = 22050;

function toWavBlob(samples) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return new Blob([buf], { type: 'audio/wav' });
}

const MELODIES = {
  a: [[3, .5], [7, .5], [10, .5], [15, 1], [null, .5], [10, .5], [15, 1.5], [null, .5]],
  b: [[0, 1], [4, 1], [7, 1], [12, 2], [null, 1]],
  c: [[5, .75], [9, .75], [12, .75], [9, .75], [null, 1]],
  d: [[-2, .5], [2, .5], [5, .5], [9, .5], [5, .5], [2, .5], [null, .5]],
};
export function makeSampleAd(kind, sec) {
  const total = Math.round(sec * SR);
  const out = new Float32Array(total);
  const mel = MELODIES[kind] || MELODIES.a;
  const beat = 60 / 120;
  let t = 0; let i = 0;
  while (t < sec) {
    const [semi, beats] = mel[i++ % mel.length];
    const len = beats * beat;
    if (semi !== null) {
      const f = 440 * Math.pow(2, semi / 12);
      const s0 = Math.round(t * SR);
      for (let k = 0; k < len * SR && s0 + k < total; k++) {
        const tt = k / SR;
        out[s0 + k] += (Math.sin(2 * Math.PI * f * tt) * 0.5 + Math.sin(4 * Math.PI * f * tt) * 0.12) * Math.min(1, tt / 0.01) * Math.exp(-3 * tt / len) * 0.55;
      }
    }
    t += len;
  }
  const fade = Math.round(0.05 * SR);
  for (let k = 0; k < fade; k++) { out[k] *= k / fade; out[total - 1 - k] *= k / fade; }
  const blob = toWavBlob(out);
  return { url: URL.createObjectURL(blob), size: blob.size, durationMs: sec * 1000, format: 'WAV', fileName: `materi-${kind}-${sec}s.wav` };
}

// ---------------------------------------------------------------- suara pembayaran
let ctx = null;
let idVoice = null;
function pickVoice() { try { idVoice = speechSynthesis.getVoices().find((v) => /^id/i.test(v.lang)) || null; } catch { /* */ } }
if (typeof speechSynthesis !== 'undefined') { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

export function getCtx() { ctx = ctx || new AudioContext(); return ctx; }
export function unlockAudio() {
  try { ctx = ctx || new AudioContext(); ctx.resume(); } catch { /* */ }
  try { speechSynthesis.speak(new SpeechSynthesisUtterance(' ')); } catch { /* */ }
}
function chime() {
  try {
    ctx = ctx || new AudioContext();
    [880, 1318].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.16;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      o.start(t); o.stop(t + 0.5);
    });
  } catch { /* */ }
}
// Mengembalikan { done: Promise, cancel() }
export function speak(text) {
  let finished = false; let timer = null; let resolve;
  const done = new Promise((r) => { resolve = r; });
  const finish = () => { if (finished) return; finished = true; clearTimeout(timer); resolve(); };
  let usedTTS = false;
  try {
    if (speechSynthesis.getVoices().length) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'id-ID'; if (idVoice) u.voice = idVoice; u.rate = 1.05;
      u.onend = finish; u.onerror = finish;
      speechSynthesis.speak(u); usedTTS = true;
      timer = setTimeout(finish, 2500 + text.length * 110);
    }
  } catch { /* */ }
  if (!usedTTS) { chime(); timer = setTimeout(finish, 1800); }
  return { done, cancel() { try { speechSynthesis.cancel(); } catch { /* */ } finish(); } };
}
