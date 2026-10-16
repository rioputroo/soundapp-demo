// Inti bersama: jam demo, bus event (narasi + "fakta" untuk checklist panduan), format.

// ---------------------------------------------------------------- jam demo
// Semua aturan waktu (interval, timeout, jadwal WIB) memakai clock.now().
// Tombol "majukan waktu" menambah selisih tanpa mengubah nilai parameter PRD.
export const clock = {
  skew: 0,
  now() { return Date.now() + this.skew; },
  advance(ms) { this.skew += ms; emit({ kind: 'clock', ms }); },
  reset() { this.skew = 0; },
};

// ---------------------------------------------------------------- bus
const listeners = new Set();
let seq = 0;
export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(msg) { for (const l of [...listeners]) { try { l(msg); } catch (e) { console.error(e); } } }

// Fakta = kejadian terstruktur yang dicocokkan oleh checklist skenario.
export function fact(type, data = {}) { emit({ kind: 'fact', f: { type, ...data, t: clock.now(), seq: ++seq } }); }

// Narasi = kalimat yang tampil di panel "Alur". actor: hp | firebase | server | admin | demo
export function narrate(actor, text, extra = {}) { emit({ kind: 'narr', n: { actor, text, ...extra, t: clock.now(), seq: ++seq } }); }

// ---------------------------------------------------------------- format
export const rupiah = (n) => 'Rp' + Number(n).toLocaleString('id-ID');
const fmt = (opts) => new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour12: false, ...opts });
export const fmtTime = (ms) => fmt({ hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(ms)).replace(/\./g, ':');
export const fmtDateTime = (ms) => ms ? fmt({ day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ms)).replace(/\./g, ':') + ' WIB' : '–';
export const fmtShort = (ms) => ms ? fmt({ day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(ms)).replace(/\./g, ':') : '–';
export const fmtDur = (ms) => (ms / 1000).toFixed(ms < 10000 ? 1 : 0).replace('.', ',') + ' dtk';
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const uid = (p) => `${p}${Math.random().toString(36).slice(2, 8)}`;

// datetime-local (WIB) <-> epoch ms
export const toWibInput = (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 16);
export const fromWibInput = (v) => new Date(v + ':00+07:00').getTime();
