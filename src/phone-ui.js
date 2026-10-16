// Tampilan HP merchant + panel kontrol simulasi + status internal aplikasi.
import morphdom from 'morphdom';
import { clock, esc, rupiah, fmtTime, fmtDur } from './core.js';
import * as srv from './server.js';

const I = {
  home: '<svg viewBox="0 0 24 24"><path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"/></svg>',
  qr: '<svg viewBox="0 0 24 24"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2zM16 16h2v2h-2z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.6 2.3-1.9-.4a7 7 0 0 0-.8-1.9l1.1-1.6-1.9-1.9-1.6 1.1a7 7 0 0 0-1.9-.8L13.2 3h-2.4l-.4 1.9a7 7 0 0 0-1.9.8L6.9 4.6 5 6.5l1.1 1.6a7 7 0 0 0-.8 1.9l-1.9.4v2.4l1.9.4c.2.7.4 1.3.8 1.9L5 16.7l1.9 1.9 1.6-1.1c.6.4 1.2.6 1.9.8l.4 1.9h2.4l.4-1.9c.7-.2 1.3-.4 1.9-.8l1.6 1.1 1.9-1.9-1.1-1.6c.4-.6.6-1.2.8-1.9l1.9-.4z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5 8 12l7 7"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><path d="M5 4h3l2 5-2 1.5a11 11 0 0 0 5.5 5.5L15 14l5 2v3a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z"/></svg>',
};

import { qrisInfo, qrSvgReal } from './qris.js';

// Pola QR dekoratif (bukan QR sungguhan) dari MID
function qrSvg(seed) {
  let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const n = 25; let cells = '';
  const finder = (x, y) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (finder(x, y)) continue;
    h = (h * 1103515245 + 12345) >>> 0;
    if ((h >> 16) & 1) cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  }
  const fp = (x, y) => `<rect x="${x}" y="${y}" width="7" height="7"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" class="w"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3"/>`;
  return `<svg viewBox="-1 -1 ${n + 2} ${n + 2}" class="qr" role="img" aria-label="Kode QR contoh">${fp(0, 0)}${fp(n - 7, 0)}${fp(0, n - 7)}${cells}</svg>`;
}

function soundStatus(d) {
  if (!d.soundOn) return { tone: 'off', title: 'Notifikasi suara nonaktif', sub: 'Aktifkan di Pengaturan untuk mendengar setiap pembayaran.' };
  if (d.inCall) return { tone: 'hold', title: 'Ditahan selama panggilan', sub: 'Pembayaran yang masuk saat telepon tidak dibacakan.' };
  if (d.ad?.stage === 'PLAYING') return { tone: 'ad', title: 'Memutar promosi', sub: d.ad.campaignName };
  if (d.speaking) return { tone: 'pay', title: `Pembayaran diterima ${rupiah(d.speaking.amount)}`, sub: 'Sedang dibacakan' };
  if (d.quietTimer) return { tone: 'wait', title: 'Jeda tenang', sub: `${Math.max(0, d.quietUntil - Date.now())} ms tanpa pembayaran baru` };
  if (d.ad?.holding) return { tone: 'hold', title: 'Promosi menunggu', sub: 'Pembayaran baru didahulukan' };
  if (d.ad) return { tone: 'wait', title: { REQUESTING: 'Meminta promosi', LOADING: 'Memuat promosi', READY: 'Promosi siap', GATING: 'Cek ulang ke server' }[d.ad.stage], sub: d.ad.campaignName || 'Menunggu jawaban server' };
  return { tone: 'on', title: 'Siap membacakan pembayaran', sub: 'Notifikasi suara aktif' };
}

function screenHtml(app) {
  const d = app.dev;
  const now = clock.now();
  const bar = `<div class="sbar"><span>${fmtTime(now).slice(0, 5)}</span><span class="sbar-r">${d.inCall ? `<span class="sb-call">${I.phone} Panggilan</span>` : ''}${d.online ? '<span class="sb-sig" title="Online"><i></i><i></i><i></i><i></i></span>' : '<span class="sb-off">Offline</span>'}<span class="sb-bat"></span></span></div>`;
  if (!d.alive) {
    return `${bar}<div class="homescreen"><button class="appicon" data-act="revive"><span class="appicon-img">P</span><span>Paydia Bisnis</span></button><p class="home-hint">Aplikasi ditutup. Ketuk ikon untuk membuka lagi.</p></div>`;
  }
  if (!d.account) {
    return `${bar}<div class="login"><div class="login-brand"><span class="wordmark">paydia</span><b>Bisnis</b></div><p>Pilih akun merchant demo untuk masuk.</p>
      <div class="acc-list">${srv.ACCOUNTS.map((a) => { const m = srv.merchantOf(a.mid); return `<button class="acc" data-act="login" data-user="${a.userId}"><b>${esc(m.name)}</b><span>${esc(a.name)} · MID ${a.mid}</span></button>`; }).join('')}</div></div>`;
  }
  const m = srv.merchantOf(d.account.mid);
  const st = soundStatus(d);
  let body = '';
  if (d.page === 'dasbor') {
    const ad = d.ad;
    const progress = ad?.stage === 'PLAYING' && ad.audio ? Math.min(100, (ad.audio.currentTime / (ad.audio.duration || ad.durationMs / 1000)) * 100) : 0;
    body = `<div class="pcard sound ${st.tone}"><div class="pcard-h"><span class="ico">${I.speaker}</span><span>Notifikasi suara</span><span class="pill-s ${d.soundOn ? 'on' : 'off'}">${d.soundOn ? 'ON' : 'OFF'}</span></div>
        <div class="st-title">${esc(st.title)}</div><div class="st-sub">${esc(st.sub)}</div>
        ${ad?.stage === 'PLAYING' ? `<div class="pbar"><div style="width:${progress}%"></div></div>` : ''}
        ${!d.soundOn ? '<button class="pbtn" data-act="page" data-page="pengaturan">Buka Pengaturan</button>' : ''}</div>
      <div class="pcard"><div class="pcard-h"><span>Transaksi masuk</span></div>
        ${d.txs.length ? `<ul class="txlist">${d.txs.slice(0, 8).map((t) => `<li><span>${fmtTime(t.at).slice(0, 5)}</span><b>${rupiah(t.amount)}</b><span class="txs ${t.status}">${t.status === 'SUKSES' ? 'Sukses' : t.status === 'PENDING' ? 'Pending' : 'Gagal'}</span></li>`).join('')}</ul>` : '<p class="empty">Belum ada transaksi. Kirim transaksi dari panel simulasi di bawah HP.</p>'}</div>`;
  } else if (d.page === 'qr') {
    const qi = m.qris && qrisInfo(m.qris);
    body = qi
      ? `<div class="pcard qrcard"><div class="qris">QRIS</div>${qrSvgReal(m.qris)}<b>${esc(qi.name)}</b><span>${esc(qi.city)} · NMID ${esc(qi.nmid)}</span><p class="empty">QR Statis untuk menerima pembayaran.</p></div>`
      : `<div class="pcard qrcard"><div class="qris">QRIS</div>${qrSvg(m.mid)}<b>${esc(m.name)}</b><span>NMID ${m.mid}</span><p class="empty">QR Statis untuk menerima pembayaran.</p></div>`;
  } else {
    body = `<div class="pcard list">
        <div class="row"><span class="ico">${I.speaker}</span><div><b>Notifikasi suara</b><span>Bacakan setiap pembayaran sukses</span></div>
          <label class="pswitch" aria-label="Notifikasi suara"><input type="checkbox" id="ph-sound" ${d.soundOn ? 'checked' : ''}/><span></span></label></div>
        <button class="row link" data-act="tnc"><span class="ico">§</span><div><b>Syarat &amp; Ketentuan</b><span>Baca kembali ketentuan layanan</span></div>${I.chev}</button>
        <div class="row"><span class="ico">${I.pin}</span><div><b>Izin lokasi</b><span>${{ belum: 'Belum ditanya', once: 'Diizinkan sekali', while: 'Diizinkan saat aplikasi digunakan', denied: 'Ditolak', expired: 'Izin sekali sudah berakhir' }[d.location.status]}</span></div></div>
      </div>
      <div class="pcard list"><div class="row"><span class="avatar">${esc(d.account.name[0])}</span><div><b>${esc(d.account.name)}</b><span>${esc(d.account.phone)}</span></div></div>
        <button class="row link danger" data-act="logout"><span class="ico">⎋</span><div><b>Keluar</b></div></button></div>
      <p class="ver">Paydia Bisnis 3.8.0 · demo</p>`;
  }
  let overlay = '';
  if (d.overlay === 'consent') {
    const t = srv.getTnc();
    overlay = `<div class="ovl full" id="consent-page"><div class="ovl-h"><button class="iconbtn" data-act="consent-back" aria-label="Kembali">${I.back}</button><b>${esc(t.title)}</b></div>
      <div class="tnc-scroll" id="tnc-scroll"><p class="tnc-ver">Versi ${t.version}</p>${t.body.map((p, i) => `<p>${i + 1}. ${esc(p)}</p>`).join('')}</div>
      <div class="consent-foot"><label class="pcheck"><input type="checkbox" id="tnc-check" ${app.ui.tncScrolled ? '' : 'disabled'} ${app.ui.tncChecked ? 'checked' : ''}/> <span>Saya Setuju dan Sudah Membaca Syarat &amp; Ketentuan</span></label>
      ${app.ui.tncScrolled ? '' : '<p class="hint-s">Scroll sampai bawah untuk mengaktifkan centang.</p>'}
      ${d.consentError ? `<p class="perr">${esc(d.consentError)}</p>` : ''}
      <button class="pbtn primary" data-act="consent-agree" ${app.ui.tncChecked && !d.consentSaving ? '' : 'disabled'}>${d.consentSaving ? 'Menyimpan…' : 'Setuju'}</button>
      <button class="ptext" data-act="consent-reject">Tolak</button></div></div>`;
  } else if (d.overlay === 'tnc') {
    const t = srv.getTnc();
    overlay = `<div class="ovl full"><div class="ovl-h"><button class="iconbtn" data-act="close-ovl" aria-label="Kembali">${I.back}</button><b>Syarat &amp; Ketentuan</b></div>
      ${d.tncError ? `<div class="tnc-err"><p>${esc(d.tncError)}</p><button class="pbtn" data-act="tnc">Coba lagi</button></div>` : `<div class="tnc-scroll"><p class="tnc-ver">Versi ${t.version} · mode baca</p>${t.body.map((p, i) => `<p>${i + 1}. ${esc(p)}</p>`).join('')}</div>`}</div>`;
  } else if (d.overlay === 'location') {
    overlay = `<div class="ovl dim"><div class="sheet"><span class="ico big">${I.pin}</span><b>Izinkan <u>Paydia Bisnis</u> mengakses lokasi perangkat ini?</b>
      <button data-act="loc" data-v="while">Saat aplikasi digunakan</button><button data-act="loc" data-v="once">Hanya kali ini</button><button data-act="loc" data-v="denied">Jangan izinkan</button></div></div>`;
  }
  return `${bar}<div class="appbar"><span class="wordmark sm">paydia</span><div class="ab-m"><b>${esc(m.name)}</b><span>MID ${m.mid}</span></div></div>
    <div class="ajakan">Ingin usaha Anda dipromosikan lewat suara? Ajukan iklan <button class="inline-link" data-act="ajakan">disini</button></div>
    <div class="pbody">${body}</div>
    <nav class="bnav">${[['dasbor', 'Dasbor', I.home], ['qr', 'QR Statis', I.qr], ['pengaturan', 'Pengaturan', I.gear]].map(([k, l, ic]) => `<button data-act="page" data-page="${k}" class="${d.page === k ? 'on' : ''}">${ic}<span>${l}</span></button>`).join('')}</nav>
    ${overlay}${d.toast ? `<div class="ptoast">${esc(d.toast.text)}</div>` : ''}`;
}

// ---------------------------------------------------------------- status internal (di bawah HP)
function internalsHtml(app) {
  const d = app.dev; const c = srv.getConfig(); const now = clock.now();
  const ad = d.ad;
  const da = srv.getDeviceAd(d.id);
  const intervalLeft = da.lastEndAt ? Math.max(0, da.lastEndAt + c.intervalSec * 1000 - now) : 0;
  const quietPct = d.quietTimer ? Math.max(0, Math.min(100, 100 - ((d.quietUntil - Date.now()) / c.quietMs) * 100)) : 0;
  const stageText = !ad ? 'Tidak ada' : ad.holding ? 'Menunggu pembayaran selesai' : { REQUESTING: 'Minta ke server', LOADING: 'Memuat audio', READY: 'Siap', GATING: 'Cek ulang', PLAYING: 'Berbunyi' }[ad.stage];
  const startup = ad && ad.stage !== 'PLAYING' ? `${Math.floor(ad.startupElapsed / 1000)} / ${c.startupTimeoutSec} dtk${ad.holding ? ' (dijeda)' : ''}` : '–';
  const stall = ad?.stage === 'PLAYING' ? `${Math.max(0, Math.floor((now - ad.lastProgressAt) / 1000))} / ${c.stallTimeoutSec} dtk` : '–';
  return `<div class="int-grid">
    <div class="int wide"><span>Antrean suara pembayaran</span><div class="chips">${d.speaking ? `<i class="chip now">▶ ${rupiah(d.speaking.amount)}</i>` : ''}${d.voiceQueue.map((q) => `<i class="chip">${rupiah(q.amount)}</i>`).join('') || (d.speaking ? '' : '<em>kosong</em>')}</div></div>
    <div class="int"><span>Jeda tenang ${c.quietMs} ms</span><div class="mbar"><div style="width:${quietPct}%"></div></div></div>
    <div class="int"><span>Iklan</span><b>${stageText}</b></div>
    <div class="int"><span>Timer startup</span><b>${startup}</b></div>
    <div class="int"><span>Timer macet</span><b>${stall}</b></div>
    <div class="int"><span>Interval iklan berikutnya</span><b>${intervalLeft ? Math.ceil(intervalLeft / 1000) + ' dtk lagi' : 'siap'}</b></div>
    <div class="int"><span>Konfirmasi tertunda</span><b>${d.outbox.length}</b></div>
  </div>`;
}

// ---------------------------------------------------------------- kontrol simulasi
function controlsHtml(app) {
  const d = app.dev;
  const amt = app.ui.amount;
  const seg = (name, val, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button data-ctl="${name}" data-v="${v}" class="${val === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const disabled = !d.account || !d.alive ? 'disabled' : '';
  return `<div class="ctl-sec"><h4>Kirim transaksi ke merchant ini</h4>
      <div class="ctl-row">${seg('amount', amt, [[15000, 'Rp15.000'], [50000, 'Rp50.000'], [125000, 'Rp125.000']])}</div>
      <div class="ctl-row btns">
        <button class="btn primary" data-ctl="pay1" ${!d.account ? 'disabled' : ''}>Kirim 1 pembayaran</button>
        <button class="btn" data-ctl="pay3" ${!d.account ? 'disabled' : ''}>3 sekaligus</button>
        <button class="btn" data-ctl="dup" ${!d.account ? 'disabled' : ''}>Event dobel</button>
        <button class="btn" data-ctl="pending" ${!d.account ? 'disabled' : ''}>Pending → sukses</button>
        <button class="btn" data-ctl="failed" ${!d.account ? 'disabled' : ''}>Gagal</button>
      </div></div>
    <div class="ctl-sec"><h4>Kondisi HP</h4>
      <div class="toggles">
        <label class="tg"><input type="checkbox" data-ctl="call" ${d.inCall ? 'checked' : ''} ${disabled}/><span></span>Sedang telepon</label>
        <label class="tg"><input type="checkbox" data-ctl="online" ${d.online ? 'checked' : ''}/><span></span>Internet tersambung</label>
        <label class="tg"><input type="checkbox" data-ctl="fg" ${d.foreground ? 'checked' : ''}/><span></span>Aplikasi di layar depan</label>
      </div>
      <div class="ctl-grid">
        <label>Platform ${seg('platform', d.platform, [['android', 'Android'], ['ios', 'iOS']])}</label>
        <label>Streaming audio iklan<select data-ctl="load">${[['normal', 'Normal'], ['slow', 'Lambat (±3 dtk)'], ['never', 'Tidak bisa dimuat'], ['stall', 'Macet di tengah'], ['stallRecover', 'Macet lalu pulih']].map(([v, l]) => `<option value="${v}" ${d.loadMode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Simpan persetujuan S&amp;K<select data-ctl="consentSave">${[['ok', 'Berhasil'], ['fail', 'Selalu gagal'], ['failOnce', 'Gagal sekali, lalu berhasil']].map(([v, l]) => `<option value="${v}" ${d.consentSaveMode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div class="ctl-row btns"><button class="btn ${d.alive ? '' : 'primary'}" data-ctl="power">${d.alive ? 'Tutup paksa aplikasi' : 'Buka aplikasi'}</button></div>
    </div>`;
}

export function mountPhone(app, { phoneEl, controlsEl, internalsEl }) {
  app.ui = { amount: 50000, tncScrolled: false, tncChecked: false, lastOverlay: null };
  const render = () => {
    const d = app.dev;
    if (d.overlay !== app.ui.lastOverlay) { app.ui.tncScrolled = false; app.ui.tncChecked = false; app.ui.lastOverlay = d.overlay; }
    morphdom(phoneEl, `<div class="screen" id="${phoneEl.id}">${screenHtml(app)}</div>`);
    if (d.overlay === 'consent' && !app.ui.tncScrolled) {
      const sc = phoneEl.querySelector('#tnc-scroll');
      if (sc && sc.scrollHeight <= sc.clientHeight + 4) { app.ui.tncScrolled = true; render(); return; }
    }
  };
  const renderAll = () => { render(); morphdom(controlsEl, `<div id="${controlsEl.id}" class="${controlsEl.className}">${controlsHtml(app)}</div>`); morphdom(internalsEl, `<div id="${internalsEl.id}" class="${internalsEl.className}">${internalsHtml(app)}</div>`); };
  app.onChange(renderAll);
  setInterval(() => { render(); morphdom(internalsEl, `<div id="${internalsEl.id}" class="${internalsEl.className}">${internalsHtml(app)}</div>`); }, 200);

  phoneEl.addEventListener('scroll', (e) => {
    if (e.target.id !== 'tnc-scroll' || app.ui.tncScrolled) return;
    const s = e.target;
    if (s.scrollTop + s.clientHeight >= s.scrollHeight - 6) { app.ui.tncScrolled = true; render(); }
  }, true);
  phoneEl.addEventListener('change', (e) => {
    if (e.target.id === 'tnc-check') { app.ui.tncChecked = e.target.checked; render(); }
    if (e.target.id === 'ph-sound') app.setSound(e.target.checked);
  });
  phoneEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const a = b.dataset.act;
    if (a === 'login') app.login(b.dataset.user);
    else if (a === 'logout') app.logout('logout');
    else if (a === 'page') app.goPage(b.dataset.page);
    else if (a === 'tnc') app.openTnc();
    else if (a === 'close-ovl') app.closeOverlay();
    else if (a === 'consent-back' || a === 'consent-reject') app.rejectConsent();
    else if (a === 'consent-agree') app.agreeConsent();
    else if (a === 'loc') app.answerLocation(b.dataset.v);
    else if (a === 'revive') app.revive();
    else if (a === 'ajakan') app.toast(app.dev.online ? 'Membuka form pengajuan iklan milik tim Bisnis di browser.' : 'Browser: halaman form tidak dapat diakses (tidak ada koneksi).');
  });

  controlsEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-ctl]'); if (!b || b.disabled) return;
    const c = b.dataset.ctl; const mid = app.dev.account?.mid; const amt = app.ui.amount;
    if (c === 'amount') { app.ui.amount = Number(b.dataset.v); renderAll(); }
    else if (c === 'platform') app.setPlatform(b.dataset.v);
    else if (c === 'pay1') srv.simulateTransaction(mid, amt);
    else if (c === 'pay3') [0, 1, 2].forEach((i) => setTimeout(() => srv.simulateTransaction(mid, amt + i * 1000), i * 150));
    else if (c === 'dup') srv.simulateTransaction(mid, amt, { duplicates: 3 });
    else if (c === 'pending') { const tx = srv.simulateTransaction(mid, amt, { status: 'PENDING' }); setTimeout(() => srv.simulateTransaction(mid, amt, { status: 'SUKSES', txId: tx.txId }), 2500); }
    else if (c === 'failed') srv.simulateTransaction(mid, amt, { status: 'GAGAL' });
    else if (c === 'power') (app.dev.alive ? app.kill() : app.revive());
  });
  controlsEl.addEventListener('change', (e) => {
    const t = e.target; const c = t.dataset.ctl;
    if (c === 'call') app.setCall(t.checked);
    else if (c === 'online') app.setOnline(t.checked);
    else if (c === 'fg') app.setForeground(t.checked);
    else if (c === 'load') app.setLoadMode(t.value);
    else if (c === 'consentSave') app.setConsentSaveMode(t.value);
  });
  renderAll();
  return { render: renderAll };
}
export { fmtDur };
