// =============================================================================
// Suara nominal pembayaran, setara aplikasi asli (audio-nominal-rn 0.12.0):
// nominal → daftar kata → klip WAV rekaman digabung (potong diam, jeda 30 ms) → diputar.
// =============================================================================
import { CLIPS } from './clips.js';
import { getCtx } from './audio.js';

const MAX_AMOUNT = 999_999_999_999;
const GAP_MS = 30;
const TRIM_THRESHOLD = 400 / 32768; // sama dengan trimSilence di library (amplitudo 400 dari 16-bit)
const TRIM_PAD_MS = 8;
const DIGIT = ['nol', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan'];

function threeDigits(n, t) {
  const h = Math.floor(n / 100), r = n % 100;
  if (h > 0) { if (h === 1) t.push('seratus'); else t.push(DIGIT[h], 'ratus'); }
  if (r > 0) {
    if (r < 10) t.push(DIGIT[r]);
    else if (r === 10) t.push('sepuluh');
    else if (r === 11) t.push('sebelas');
    else if (r < 20) t.push(DIGIT[r % 10], 'belas');
    else { t.push(DIGIT[Math.floor(r / 10)], 'puluh'); if (r % 10) t.push(DIGIT[r % 10]); }
  }
}
function group(t, g, unit, se) {
  if (!g) return;
  if (g === 1 && se) return void t.push(se);
  threeDigits(g, t); t.push(unit);
}
// Port 1:1 dari angkaKeToken (backend audio-nominal).
export function angkaKeToken(amount, { isReceive = true, company = true } = {}) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) throw new RangeError('amount must be a finite number >= 0');
  const v = Math.trunc(amount);
  if (v > MAX_AMOUNT) throw new RangeError(`amount must be <= ${MAX_AMOUNT}`);
  const t = [];
  if (v === 0) t.push('nol');
  else {
    let r = v;
    const mi = Math.floor(r / 1e9); r %= 1e9;
    const ju = Math.floor(r / 1e6); r %= 1e6;
    const ri = Math.floor(r / 1e3); r %= 1e3;
    group(t, mi, 'miliar'); group(t, ju, 'juta'); group(t, ri, 'ribu', 'seribu');
    if (r > 0) threeDigits(r, t);
  }
  t.push('rupiah');
  if (isReceive) t.push('diterima');
  if (company) t.push('paydia');
  return t;
}

export const voice = { type: '1' };
export function setVoiceType(t) { voice.type = t === '2' ? '2' : '1'; }

const decoded = new Map(); // `${type}/${token}` → AudioBuffer yang sudah dipotong
async function clip(type, token) {
  const key = `${type}/${token}`;
  if (!decoded.has(key)) {
    decoded.set(key, (async () => {
      const ctx = getCtx();
      const buf = await ctx.decodeAudioData(await (await fetch(CLIPS[type][token])).arrayBuffer());
      const d = buf.getChannelData(0);
      let s = 0, e = d.length - 1;
      while (s < d.length && Math.abs(d[s]) <= TRIM_THRESHOLD) s++;
      while (e >= s && Math.abs(d[e]) <= TRIM_THRESHOLD) e--;
      if (s > e) return buf;
      const pad = Math.round(buf.sampleRate * TRIM_PAD_MS / 1000);
      return { sampleRate: buf.sampleRate, data: d.slice(Math.max(0, s - pad), Math.min(d.length, e + 1 + pad)) };
    })());
  }
  return decoded.get(key);
}
const dataOf = (c) => c.data || c.getChannelData(0);

export async function buildAmountBuffer(amount, type = voice.type, opts) {
  const tokens = angkaKeToken(amount, opts);
  const clips = await Promise.all(tokens.map((t) => clip(type, t)));
  const sr = clips[0].sampleRate, gap = Math.round(sr * GAP_MS / 1000);
  const total = clips.reduce((n, c) => n + dataOf(c).length, 0) + gap * (clips.length - 1);
  const out = getCtx().createBuffer(1, total, sr);
  const ch = out.getChannelData(0); let o = 0;
  clips.forEach((c, i) => { if (i) o += gap; ch.set(dataOf(c), o); o += dataOf(c).length; });
  return { buffer: out, tokens };
}

// Mengembalikan { done, cancel() }, bentuk yang sama dengan speak() lama.
export function speakAmount(amount, onFail) {
  let finished = false, src = null, resolve;
  const done = new Promise((r) => { resolve = r; });
  const finish = () => { if (finished) return; finished = true; resolve(); };
  buildAmountBuffer(amount).then(({ buffer }) => {
    if (finished) return;
    const ctx = getCtx(); ctx.resume();
    src = ctx.createBufferSource(); src.buffer = buffer; src.connect(ctx.destination);
    src.onended = finish; src.start();
  }).catch((e) => { onFail?.(e); finish(); });
  return { done, cancel() { try { src?.stop(); } catch { /* */ } finish(); } };
}
