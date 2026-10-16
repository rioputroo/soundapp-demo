import { clock, on, narrate, fmtTime, sleep, esc } from './core.js';
import { unlockAudio } from './audio.js';
import * as srv from './server.js';
import { createDevice } from './device.js';
import { mountPhone } from './phone-ui.js';
import { mountFlow } from './flow-ui.js';
import { mountAdmin } from './admin-ui.js';
import { mountGuide } from './guide.js';
import { setVoiceType, voice, speakAmount, angkaKeToken } from './nominal.js';
import { fcm, enableFcm, onFcmChange, addFcmLog, clearFcmLog } from './fcm.js';

const $ = (id) => document.getElementById(id);
srv.resetServer();
const app = createDevice();
window.demo = { app, srv, clock };

mountPhone(app, { phoneEl: $('screen'), controlsEl: $('controls'), internalsEl: $('internals') });
mountFlow($('flow-list'), $('flow-filter'), $('flow-clear'));
const admin = mountAdmin($('admin'));

// ------------------------------------------------------------ tab panel kanan
function setTab(t) {
  document.querySelectorAll('[data-tab]').forEach((b) => { const on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  for (const k of ['flow', 'admin', 'params']) $('tab-' + k).hidden = k !== t;
  if (t === 'params') renderParams();
  if (t === 'admin') admin.render();
}
document.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });

// ------------------------------------------------------------ FCM
const STATUS = { off: 'Belum aktif', connecting: 'Menghubungkan…', on: 'Terhubung', error: 'Gagal' };
window.demo.fcmMessage = onFcmMessage; // untuk uji tanpa FCM sungguhan
function onFcmMessage(ev, raw, source) {
  narrate('firebase', `Pesan FCM masuk (${source}): ${JSON.stringify(raw)}`);
  addFcmLog({ source, raw, outcome: app.receiveExternal(ev, raw) });
}
function fcmLogHtml() {
  const rows = fcm.log.map((l) => `<tr><td class="num">${fmtTime(l.at)}</td><td>${esc(l.source)}</td><td><code>${esc(JSON.stringify(l.raw))}</code></td><td>${esc(l.outcome)}</td></tr>`).join('');
  return `<div class="row-btns left" style="margin-top:10px"><b>Log pesan FCM masuk (${fcm.log.length})</b>${fcm.log.length ? '<button type="button" class="btn ghost sm" id="fcm-clear">Bersihkan</button>' : ''}</div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Waktu</th><th>Diterima saat</th><th>Data</th><th>Hasil</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">Belum ada pesan masuk.</td></tr>'}</tbody></table></div>`;
}
function fcmCard() {
  return `<div class="kv"><span>Status</span><b>${STATUS[fcm.status]}</b></div>
    <label class="pfield"><span>VAPID key (Web Push certificate)</span><div class="pin"><input type="text" id="fcm-vapid" value="${esc(fcm.vapid)}" placeholder="B…" /></div></label>
    ${fcm.error ? `<p class="note">${esc(fcm.error)}</p>` : ''}
    ${fcm.token ? `<label class="pfield"><span>FCM token (kirim data message ke token ini)</span><div class="pin"><input type="text" id="fcm-token" readonly value="${esc(fcm.token)}" /></div></label>` : ''}
    <div class="row-btns left"><button class="btn primary" id="fcm-on">${fcm.token ? 'Ambil token ulang' : 'Aktifkan FCM'}</button>${fcm.token ? '<button class="btn" id="fcm-copy">Salin token</button>' : ''}</div>
    ${fcmLogHtml()}
    <small class="sub">Login dulu di HP dengan salah satu akun demo. Data message harus berisi topic=transaction, refid (ID transaksi), dan amount. status dan mid tidak diperlukan: pesan dianggap pembayaran sukses untuk akun yang login.</small>`;
}
onFcmChange(() => { const c = $('fcm-card'); if (c) c.innerHTML = fcmCard(); });
$('params').addEventListener('change', (e) => { if (e.target.id === 'voice-type') { setVoiceType(e.target.value); narrate('demo', `Jenis suara pembayaran: ${e.target.value === '1' ? 'Formal Pria' : 'Formal Wanita'}.`); } });
$('params').addEventListener('click', (e) => {
  if (e.target.id === 'voice-test') { unlockAudio(); speakAmount(25000); narrate('demo', `Contoh suara: ${angkaKeToken(25000).join(' ')}.`); }
  if (e.target.id === 'fcm-on') enableFcm($('fcm-vapid').value.trim(), onFcmMessage);
  if (e.target.id === 'fcm-clear') clearFcmLog();
  if (e.target.id === 'fcm-copy') navigator.clipboard?.writeText(fcm.token).then(() => narrate('demo', 'FCM token disalin.'));
});

// ------------------------------------------------------------ parameter
function renderParams() {
  const c = srv.getConfig(); const t = srv.getTnc();
  const field = (k, label, unit, note) => `<label class="pfield"><span>${label}</span><div class="pin"><input type="number" min="0" id="p-${k}" value="${c[k]}"/><em>${unit}</em></div><small>${note}</small></label>`;
  $('params').innerHTML = `<div class="adm-h"><h3>Parameter engine</h3></div>
    <p class="note">PRD: parameter dapat diubah; halaman pengaturan parameter ditunda. Panel ini hanya untuk demo. Untuk melompati waktu tunggu, pakai tombol <b>+10 dtk / +30 dtk / +1 mnt / +1 hari</b> di bagian atas, nilai PRD tidak perlu diubah.</p>
    <form id="pform" class="pgrid">
      ${field('quietMs', 'Jeda tenang setelah antrean pembayaran kosong', 'ms', 'PRD: 0,5 detik')}
      ${field('intervalSec', 'Interval antar iklan per perangkat', 'dtk', 'PRD: 1 menit sejak selesai/terputus')}
      ${field('startupTimeoutSec', 'Timeout startup streaming', 'dtk', 'PRD: 30 detik sejak permintaan sampai audio mulai')}
      ${field('stallTimeoutSec', 'Timeout buffering tanpa kemajuan', 'dtk', 'PRD: 30 detik berturut-turut')}
      ${field('sessionTimeoutMin', 'Batas sesi tidak aktif', 'menit', 'PRD menyebut batas ini, nilainya belum ditetapkan')}
      <div class="row-btns"><button type="button" class="btn" id="p-reset">Kembalikan nilai PRD</button><button class="btn primary">Simpan parameter</button></div>
    </form>
    <div class="adm-h"><h3>Suara pembayaran</h3></div>
    <div class="dcard"><label class="pfield"><span>Jenis suara (sama dengan aplikasi merchant)</span><div class="pin"><select id="voice-type"><option value="1" ${voice.type === '1' ? 'selected' : ''}>1 · Formal Pria</option><option value="2" ${voice.type === '2' ? 'selected' : ''}>2 · Formal Wanita</option></select></div></label>
      <div class="row-btns left"><button type="button" class="btn" id="voice-test">Coba suara (Rp 25.000)</button></div>
      <small class="sub">Memakai klip rekaman asli dari audio-nominal-rn 0.12.0: nominal → kata → klip digabung, jeda 30 ms, diakhiri "rupiah diterima paydia".</small></div>
    <div class="adm-h"><h3>Firebase FCM (backend asli)</h3></div>
    <div class="dcard" id="fcm-card">${fcmCard()}</div>
    <div class="adm-h"><h3>Syarat &amp; Ketentuan</h3></div>
    <div class="dcard"><div class="kv"><span>Versi naskah berlaku</span><b>v${t.version}</b></div><div class="kv"><span>Diterbitkan</span><b>${fmtTime(t.publishedAt)} WIB</b></div>
      <div class="row-btns left"><button class="btn" id="p-tnc">Terbitkan naskah S&amp;K baru (simulasi Risk &amp; Compliance)</button></div>
      <small class="sub">Setiap perubahan naskah memerlukan persetujuan ulang dari merchant.</small></div>
    <div class="adm-h"><h3>Sesi merchant aktif</h3></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Perangkat</th><th>Akun</th><th>MID</th><th>Platform</th><th>Login</th><th>Aktivitas terakhir</th></tr></thead><tbody>
    ${srv.listSessions().map((s) => `<tr><td class="num">${s.deviceId}</td><td>${esc(srv.accountOf(s.userId).name)}</td><td class="num">${s.mid}</td><td>${s.platform}</td><td class="num">${fmtTime(s.loginAt)}</td><td class="num">${fmtTime(s.lastSeenAt)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Belum ada sesi aktif.</td></tr>'}</tbody></table></div>`;
}
$('params').addEventListener('submit', (e) => {
  e.preventDefault();
  const patch = {}; for (const k of Object.keys(srv.PRD_CONFIG)) patch[k] = $('p-' + k).value;
  srv.setConfig(patch, 'andi'); narrate('admin', 'Parameter engine diubah.'); renderParams();
});
$('params').addEventListener('click', (e) => {
  if (e.target.id === 'p-reset') { srv.setConfig({ ...srv.PRD_CONFIG }, 'andi'); narrate('admin', 'Parameter dikembalikan ke nilai PRD.'); renderParams(); }
  if (e.target.id === 'p-tnc') { srv.publishTnc('andi'); renderParams(); app.sendHeartbeat(); }
});

// ------------------------------------------------------------ panduan
const ui = {
  showAdmin(view, id) { setTab('admin'); admin.go(view, id); },
  refreshParams() { if (!$('tab-params').hidden) renderParams(); },
  async scrollAndCheck() {
    const sc = document.querySelector('#tnc-scroll'); if (!sc) return;
    narrate('demo', 'Scroll S&K sampai bawah, lalu centang "Saya Setuju dan Sudah Membaca Syarat & Ketentuan".');
    sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
    await sleep(800);
    sc.scrollTop = sc.scrollHeight; sc.dispatchEvent(new Event('scroll'));
    await sleep(300);
    const cb = document.querySelector('#tnc-check');
    if (cb && !cb.disabled) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  },
};
window.demo.guide = mountGuide($("guide"), { app, ui });

// ------------------------------------------------------------ jam demo & tombol waktu
const clockEl = $('clock');
setInterval(() => { clockEl.textContent = `${fmtTime(clock.now())} WIB${clock.skew ? ` · +${humanSkew(clock.skew)}` : ''}`; }, 250);
function humanSkew(ms) { const d = Math.floor(ms / 864e5); const h = Math.floor((ms % 864e5) / 36e5); const m = Math.floor((ms % 36e5) / 6e4); const s = Math.round((ms % 6e4) / 1000); return [d && `${d} hari`, h && `${h} jam`, m && `${m} mnt`, s && `${s} dtk`].filter(Boolean).join(' ') || '0 dtk'; }
document.querySelector('.timebtns').addEventListener('click', (e) => {
  const b = e.target.closest('[data-adv]'); if (!b) return;
  clock.advance(Number(b.dataset.adv));
  narrate('demo', `Waktu demo dimajukan ${b.textContent.trim()}. Semua aturan waktu (interval, timeout, jadwal WIB) mengikuti jam ini.`);
});
$('reset').addEventListener('click', () => location.reload());

// ------------------------------------------------------------ mulai
$('start').addEventListener('click', async () => {
  unlockAudio();
  $('intro').hidden = true;
  app.start();
  narrate('demo', 'Demo dimulai. Pilih skenario di panel Panduan, atau login di HP dan coba sendiri.');
});
on(() => {});
