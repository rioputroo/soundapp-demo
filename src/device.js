// =============================================================================
// APLIKASI MERCHANT (simulasi HP)
// Satu speaker, satu antrean. Pembayaran selalu didahulukan; iklan hanya mengisi waktu sepi.
// Alur iklan: antrean kosong → jeda 0,5 dtk → minta kesempatan (server) → muat audio (streaming)
//             → cek ulang (server) → putar → kirim hasil (retry sampai diterima server)
// =============================================================================
import { clock, on, fact, narrate, rupiah, sleep, uid } from './core.js';
import { speakAmount } from './nominal.js';
import * as srv from './server.js';

const DAY = 864e5;
export function createDevice() {
  const dev = {
    id: 'HP-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
    platform: 'android', foreground: true, alive: true, online: true, inCall: false,
    loadMode: 'normal', consentSaveMode: 'ok',
    account: null, soundPrefs: {}, soundOn: false, consentValid: false,
    page: 'dasbor', overlay: null, consentReason: null, consentError: '', consentSaving: false, tncError: '', toast: null,
    location: { status: 'belum', lastAskAt: 0 },
    txs: [], seenTx: new Set(), voiceQueue: [], speaking: null, group: new Set(), quietTimer: null, quietUntil: 0,
    ad: null, outbox: [], outboxTimer: null, heartbeatTimer: null, failOnceUsed: false,
  };
  let gen = 0;
  const cfg = () => srv.getConfig();
  const changed = new Set();
  const notify = () => changed.forEach((f) => f());

  // ------------------------------------------------------------ jaringan (API ke backend)
  async function api(fn, ...args) {
    if (!dev.online) throw Object.assign(new Error('Tidak ada koneksi'), { code: 'OFFLINE' });
    await sleep(80 + Math.random() * 90);
    if (!dev.online || !dev.alive) throw Object.assign(new Error('Tidak ada koneksi'), { code: 'OFFLINE' });
    return fn(...args);
  }
  const say = (text, extra) => narrate('hp', text, extra);
  function toast(text) { dev.toast = { text, at: Date.now() }; notify(); setTimeout(() => { if (dev.toast?.text === text) { dev.toast = null; notify(); } }, 3200); }

  // ------------------------------------------------------------ event pembayaran dari Firebase
  function onFirebaseEvent(e) {
    if (!dev.alive || e.mid !== dev.account?.mid) return;
    say(`Event diterima dari Firebase: transaksi ${rupiah(e.amount)} (${e.status.toLowerCase()}).`, { tone: 'muted' });
    if (e.status !== 'SUKSES') {
      upsertTx(e);
      say('Transaksi belum sukses → tidak dibacakan dan tidak memicu iklan.', { tone: 'muted' });
      fact('pay.ignored', { why: 'status', status: e.status });
      return notify();
    }
    if (dev.seenTx.has(e.txId)) {
      say(`Event untuk transaksi ${e.txId} sudah pernah diterima → diabaikan (tidak ada suara tambahan).`, { tone: 'muted' });
      fact('pay.dup');
      return;
    }
    dev.seenTx.add(e.txId); upsertTx(e);
    if (!dev.soundOn) { say('Notifikasi suara OFF → pembayaran tidak dibacakan.', { tone: 'muted' }); fact('pay.ignored', { why: 'sound' }); return notify(); }
    if (dev.inCall) {
      say(`Sedang ada panggilan telepon → ${rupiah(e.amount)} tidak dibacakan dan tidak diantrekan. Transaksinya tetap sah.`, { tone: 'warn' });
      fact('pay.ignored', { why: 'call' });
      return notify();
    }
    dev.voiceQueue.push({ txId: e.txId, amount: e.amount });
    if (!dev.ad || dev.ad.stage === 'PLAYING') dev.group.add(e.txId);
    fact('pay.queued', { amount: e.amount });
    const ad = dev.ad;
    if (ad?.stage === 'PLAYING') {
      say(`Iklan sedang berbunyi → suara ${rupiah(e.amount)} menunggu sampai iklan selesai (tidak memotong iklan).`, { tone: 'warn' });
      fact('pay.waits');
    } else if (ad && !ad.holding) {
      ad.holding = true;
      say('Iklan belum mulai berbunyi → pembayaran didahulukan. Iklan menunggu antrean kosong + jeda 0,5 dtk lagi.', { tone: 'warn' });
      fact('ad.held');
    }
    clearQuiet(); pump();
  }
  function upsertTx(e) {
    const i = dev.txs.findIndex((t) => t.txId === e.txId);
    const row = { txId: e.txId, amount: e.amount, status: e.status, at: clock.now() };
    if (i >= 0) dev.txs[i] = row; else dev.txs.unshift(row);
    dev.txs.length = Math.min(dev.txs.length, 30);
  }

  // ------------------------------------------------------------ antrean suara pembayaran
  function pump() {
    if (!dev.alive || dev.inCall || !dev.soundOn || dev.speaking || dev.ad?.stage === 'PLAYING') return notify();
    const item = dev.voiceQueue.shift();
    if (!item) return startQuiet();
    const sp = speakAmount(item.amount, (e) => say(`Suara pembayaran gagal dibuat: ${e.message}`, { tone: 'warn' }));
    const me = { ...item, cancel: sp.cancel };
    dev.speaking = me;
    say(`🔊 Membacakan "Pembayaran diterima ${rupiah(item.amount)}"`, { tone: 'pay' });
    fact('pay.spoken', { amount: item.amount });
    notify();
    sp.done.then(() => { if (dev.speaking !== me) return; dev.speaking = null; pump(); });
  }
  function clearQuiet() { if (dev.quietTimer) { clearTimeout(dev.quietTimer); dev.quietTimer = null; dev.quietUntil = 0; fact('quiet.reset'); } }
  function startQuiet() {
    if (dev.quietTimer) { clearTimeout(dev.quietTimer); dev.quietTimer = null; }
    if (!dev.group.size && !dev.ad) return notify();
    dev.quietUntil = Date.now() + cfg().quietMs;
    dev.quietTimer = setTimeout(onQuiet, cfg().quietMs);
    say(`Antrean suara kosong → tunggu ${cfg().quietMs} ms tanpa pembayaran baru.`, { tone: 'muted' });
    notify();
  }
  function onQuiet() {
    dev.quietTimer = null; dev.quietUntil = 0;
    if (dev.speaking || dev.voiceQueue.length) return;
    fact('quiet.done');
    if (dev.ad) {
      dev.ad.holding = false; dev.ad.lastTick = clock.now();
      say('Jeda 0,5 dtk terpenuhi lagi → lanjutkan iklan yang tadi menunggu.');
      if (dev.ad.stage === 'READY') runGate(dev.ad);
      return notify();
    }
    const triggers = [...dev.group]; dev.group.clear();
    // Syarat yang diperiksa di perangkat (PRD: suara ON, koneksi, platform, tidak ada telepon)
    const blocked = !dev.soundOn ? 'notifikasi suara OFF' : !dev.consentValid ? 'belum ada persetujuan S&K' : !dev.online ? 'tidak ada koneksi'
      : dev.inCall ? 'ada panggilan telepon' : (dev.platform === 'ios' && !dev.foreground) ? 'iOS: aplikasi tidak di foreground' : null;
    if (blocked) { say(`Jeda 0,5 dtk terpenuhi, tetapi ${blocked} → tidak minta iklan.`, { tone: 'muted' }); fact('ad.skip', { why: blocked }); return notify(); }
    reserve(triggers);
  }

  // ------------------------------------------------------------ iklan
  async function reserve(triggerTxIds) {
    const ad = { gen: ++gen, stage: 'REQUESTING', holding: false, startupElapsed: 0, lastTick: clock.now(), triggerTxIds };
    dev.ad = ad;
    ad.ticker = setInterval(() => tickStartup(ad), 200);
    say(`Jeda 0,5 dtk terpenuhi → minta 1 kesempatan iklan ke server (pemicu: ${triggerTxIds.length} transaksi).`);
    fact('ad.request', { n: triggerTxIds.length });
    notify();
    let r;
    try { r = await api(srv.requestOpportunity, { deviceId: dev.id, mid: dev.account.mid, triggerTxIds }); }
    catch { if (dev.ad !== ad) return; say('Server iklan tidak bisa dihubungi → tanpa iklan. Pembayaran tetap berjalan.', { tone: 'warn' }); return dropAd(ad); }
    if (dev.ad !== ad) { if (r.ad) queueReport(r.ad.playbackId, 'FAILED_TO_START', ad.cancelReason || 'SESSION_CHANGED'); return; }
    if (!r.ad) { say(`Server: tidak ada iklan (${r.label}). Pembayaran tetap berlaku.`, { tone: 'muted' }); fact('ad.none', { reason: r.reason }); return dropAd(ad); }
    Object.assign(ad, r.ad, { stage: 'LOADING' });
    say(`Mulai streaming "${ad.campaignName}"…`);
    fact('ad.loading', { campaignId: ad.campaignId });
    const audio = new Audio();
    audio.preload = 'auto';
    ad.audio = audio;
    audio.addEventListener('canplaythrough', () => {
      if (dev.ad !== ad || ad.stage !== 'LOADING') return;
      ad.stage = 'READY';
      if (!ad.holding) runGate(ad); else { say('Audio iklan siap, tetapi masih menunggu antrean pembayaran selesai.'); notify(); }
    });
    audio.addEventListener('ended', () => { if (dev.ad === ad && ad.stage === 'PLAYING') finishAd('COMPLETED'); });
    audio.addEventListener('error', () => { if (dev.ad === ad && ad.audio?.src) finishAd(ad.stage === 'PLAYING' ? 'INTERRUPTED' : 'FAILED_TO_START', 'MEDIA_ERROR'); });
    const mode = dev.loadMode;
    if (mode === 'never') say('(Simulasi) jaringan tidak bisa memuat audio iklan.', { tone: 'muted' });
    else if (mode === 'slow') { say('(Simulasi) jaringan lambat: audio butuh ±3 dtk untuk siap.', { tone: 'muted' }); setTimeout(() => { if (dev.ad === ad) { audio.src = r.ad.mediaUrl; audio.load(); } }, 3000); }
    else { audio.src = r.ad.mediaUrl; audio.load(); }
    notify();
  }

  // Timeout startup 30 dtk: dihitung dari permintaan sampai audio mulai.
  // Penundaan yang sengaja (melayani pembayaran) tidak dihitung.
  function tickStartup(ad) {
    if (dev.ad !== ad || ad.stage === 'PLAYING') return clearInterval(ad.ticker);
    const now = clock.now();
    if (!ad.holding) ad.startupElapsed += now - ad.lastTick;
    ad.lastTick = now;
    if (ad.startupElapsed >= cfg().startupTimeoutSec * 1000) finishAd('FAILED_TO_START', 'STARTUP_TIMEOUT');
  }

  async function runGate(ad) {
    ad.stage = 'GATING';
    say('Audio siap → cek ulang ke server tepat sebelum berbunyi.');
    notify();
    let r;
    try { r = await api(srv.gate, ad.playbackId, dev.id); }
    catch { if (dev.ad !== ad) return; return finishAd('FAILED_TO_START', 'NETWORK_LOST'); }
    if (dev.ad !== ad) return;
    if (!r.go) { fact('ad.gateReject', { reason: r.reason }); return finishAd('FAILED_TO_START', r.reason, { reported: true }); }
    if (ad.holding) { ad.stage = 'READY'; say('Cek ulang OK, tetapi ada pembayaran baru → tunggu antrean kosong lagi, lalu cek ulang lagi.'); return notify(); }
    const blocked = !dev.soundOn ? 'SOUND_OFF' : dev.inCall ? 'CALL' : (dev.platform === 'ios' && !dev.foreground) ? 'PLATFORM_NOT_READY' : null;
    if (blocked) return finishAd('FAILED_TO_START', blocked);
    ad.stage = 'PLAYING'; ad.lastPos = 0; ad.lastProgressAt = clock.now();
    clearInterval(ad.ticker);
    ad.audio.play().catch(() => { if (dev.ad === ad) finishAd('FAILED_TO_START', 'MEDIA_ERROR'); });
    ad.stallTicker = setInterval(() => tickStall(ad), 250);
    if (dev.loadMode === 'stall' || dev.loadMode === 'stallRecover') {
      setTimeout(() => {
        if (dev.ad !== ad || ad.stage !== 'PLAYING') return;
        ad.simStall = true; ad.audio.pause();
        say('(Simulasi) streaming macet: audio berhenti maju, menunggu data…', { tone: 'muted' });
        if (dev.loadMode === 'stallRecover') setTimeout(() => { if (dev.ad === ad) { ad.simStall = false; ad.audio.play().catch(() => {}); say('(Simulasi) data masuk lagi → audio maju, hitungan macet di-reset.', { tone: 'muted' }); } }, 4000);
      }, 2000);
    }
    say(`▶ Iklan "${ad.campaignName}" mulai berbunyi.`, { tone: 'ad' });
    fact('ad.start', { campaignId: ad.campaignId, name: ad.campaignName });
    notify();
  }
  // Timeout buffering: 30 dtk berturut-turut tanpa kemajuan
  function tickStall(ad) {
    if (dev.ad !== ad || ad.stage !== 'PLAYING') return clearInterval(ad.stallTicker);
    const pos = ad.audio.currentTime;
    if (pos > ad.lastPos + 0.01) { ad.lastPos = pos; ad.lastProgressAt = clock.now(); }
    else if (clock.now() - ad.lastProgressAt >= cfg().stallTimeoutSec * 1000) finishAd('INTERRUPTED', 'STALL_TIMEOUT');
  }

  function dropAd(ad) {
    if (dev.ad !== ad) return;
    clearInterval(ad.ticker); clearInterval(ad.stallTicker);
    dev.ad = null; notify(); pump();
  }
  const RESULT_TEXT = { COMPLETED: '✓ Iklan selesai diputar sampai habis', INTERRUPTED: '⨯ Iklan terputus', FAILED_TO_START: '⨯ Iklan gagal dimulai' };
  function finishAd(result, reason = null, { reported = false, silent = false } = {}) {
    const ad = dev.ad; if (!ad) return;
    ad.cancelReason = reason;
    clearInterval(ad.ticker); clearInterval(ad.stallTicker);
    if (ad.audio) { try { ad.audio.pause(); ad.audio.removeAttribute('src'); ad.audio.load(); } catch { /* */ } }
    dev.ad = null;
    if (!silent) {
      say(`${RESULT_TEXT[result]}${reason ? ` (${srv.REASON_LABEL[reason] || reason})` : ''}.${result !== 'COMPLETED' ? ' Tidak diulang otomatis.' : ''}`, { tone: result === 'COMPLETED' ? 'ad' : 'warn' });
      fact('ad.result', { result, reason, campaignId: ad.campaignId });
      if (ad.playbackId && !reported) queueReport(ad.playbackId, result, reason);
    }
    notify(); pump();
  }

  // ------------------------------------------------------------ konfirmasi hasil (retry sampai diterima)
  function queueReport(playbackId, result, reason) {
    dev.outbox.push({ playbackId, result, reason, at: clock.now() });
    flushOutbox();
  }
  let flushing = false;
  async function flushOutbox() {
    if (flushing || !dev.alive) return;
    flushing = true; clearTimeout(dev.outboxTimer);
    try {
      while (dev.outbox.length) {
        const it = dev.outbox[0];
        try {
          await api(srv.reportResult, it.playbackId, dev.id, it.result, it.reason, it.at);
          dev.outbox.shift();
          fact('report.sent', { result: it.result });
        } catch {
          say(`Konfirmasi hasil iklan gagal terkirim (tidak ada koneksi) → disimpan, dicoba lagi otomatis.`, { tone: 'warn' });
          fact('report.retry');
          dev.outboxTimer = setTimeout(flushOutbox, 3000);
          break;
        }
      }
    } finally { flushing = false; notify(); }
  }

  // ------------------------------------------------------------ sesi
  async function login(userId) {
    if (dev.account) await logout('ganti akun');
    const acc = srv.accountOf(userId);
    dev.account = acc;
    try {
      await api(srv.login, dev.id, userId, dev.platform);
    } catch { say('Gagal mencatat sesi login (tidak ada koneksi) → akan dicoba lagi. Selama itu iklan tidak dipilih.', { tone: 'warn' }); }
    say(`Login sebagai ${acc.name} (${srv.merchantOf(acc.mid).name}).`);
    srv.registerDevice(dev.id, acc.mid, onFirebaseEvent);
    srv.setDeviceConnected(dev.id, dev.online);
    dev.soundOn = !!dev.soundPrefs[userId];
    dev.page = 'dasbor'; dev.overlay = null;
    await refreshConsent();
    fact('login', { userId });
    enterDasbor();
    notify();
  }
  async function logout(reason = 'logout') {
    if (dev.ad) finishAd(dev.ad.stage === 'PLAYING' ? 'INTERRUPTED' : 'FAILED_TO_START', 'SESSION_CHANGED');
    stopSpeech(); clearQuiet(); dev.voiceQueue = []; dev.group.clear();
    srv.unregisterDevice(dev.id);
    try { await api(srv.logout, dev.id, reason); } catch { /* dicatat ulang saat online */ }
    if (reason === 'logout') say(`Logout ${dev.account?.name}.`);
    dev.account = null; dev.soundOn = false; dev.txs = [];
    notify();
  }
  async function sendHeartbeat() {
    if (!dev.alive || !dev.account) return;
    try {
      const ok = await api(srv.heartbeat, dev.id);
      if (!ok) { say('Sesi di server sudah tidak aktif → aplikasi mencatat login ulang.', { tone: 'warn' }); await api(srv.login, dev.id, dev.account.userId, dev.platform); }
      await refreshConsent();
    } catch { /* coba lagi di heartbeat berikutnya */ }
  }

  // ------------------------------------------------------------ consent (halaman penuh)
  async function refreshConsent() {
    try { const s = await api(srv.consentStatus, dev.account.userId); dev.consentValid = s.valid; } catch { /* pakai status terakhir */ }
    if (dev.soundOn && !dev.consentValid && dev.overlay !== 'consent') {
      say('Suara ON tetapi belum ada persetujuan S&K yang berlaku → halaman persetujuan dibuka.');
      openConsent('check');
    }
    notify();
  }
  function openConsent(reason) {
    dev.overlay = 'consent'; dev.consentReason = reason; dev.consentError = '';
    fact('consent.shown');
    notify();
  }
  async function agreeConsent() {
    dev.consentSaving = true; dev.consentError = ''; notify();
    try {
      const mode = dev.consentSaveMode;
      await sleep(250);
      if (!dev.online || mode === 'fail' || (mode === 'failOnce' && !dev.failOnceUsed)) {
        if (mode === 'failOnce') dev.failOnceUsed = true;
        throw new Error('gagal');
      }
      await api(srv.saveConsent, dev.account.userId, dev.id, srv.getTnc().version);
      dev.consentValid = true; dev.overlay = null;
      dev.soundOn = true; dev.soundPrefs[dev.account.userId] = true;
      fact('consent.saved'); fact('sound.on');
      say('Persetujuan tersimpan → notifikasi suara ON.');
      afterSoundOn();
    } catch {
      dev.consentError = 'Persetujuan belum tersimpan. Silakan coba lagi.';
      say('Penyimpanan persetujuan gagal → suara tetap OFF, merchant bisa menekan Setuju lagi.', { tone: 'warn' });
      fact('consent.failed');
    } finally { dev.consentSaving = false; notify(); }
  }
  function rejectConsent() {
    dev.overlay = null; dev.soundOn = false; dev.soundPrefs[dev.account.userId] = false;
    say('Merchant menolak / kembali dari halaman persetujuan → aktivasi dibatalkan, suara OFF.');
    fact('consent.rejected'); fact('sound.off');
    notify();
  }
  function setSound(on) {
    if (on) {
      if (!dev.consentValid) { say('Merchant mengaktifkan suara → belum pernah setuju S&K versi ini → halaman persetujuan dibuka.'); return openConsent('activate'); }
      dev.soundOn = true; dev.soundPrefs[dev.account.userId] = true;
      say('Notifikasi suara ON (sudah pernah setuju, halaman persetujuan tidak muncul lagi).'); fact('sound.on');
      afterSoundOn();
    } else {
      dev.soundOn = false; dev.soundPrefs[dev.account.userId] = false;
      stopSpeech(); clearQuiet(); dev.voiceQueue = []; dev.group.clear();
      if (dev.ad) { say('(Belum diatur PRD) suara dimatikan saat iklan berjalan → demo menghentikan iklan.', { tone: 'muted' }); finishAd(dev.ad.stage === 'PLAYING' ? 'INTERRUPTED' : 'FAILED_TO_START', 'SOUND_OFF'); }
      say('Notifikasi suara OFF.'); fact('sound.off');
    }
    notify();
  }
  function afterSoundOn() {
    // PRD: bila izin lokasi ditolak, minta ulang saat mengaktifkan suara dan paling cepat 3 hari setelah permintaan terakhir
    if (dev.location.status === 'denied' && clock.now() - dev.location.lastAskAt >= 3 * DAY) askLocation('aktivasi suara');
  }

  // ------------------------------------------------------------ izin lokasi (popup native disimulasikan)
  function enterDasbor() {
    dev.page = 'dasbor';
    if (dev.location.status === 'belum' || dev.location.status === 'expired') askLocation('masuk Dasbor');
    else if (dev.location.status === 'while' || dev.location.status === 'once') sendLocation();
  }
  function askLocation(why) {
    if (dev.overlay === 'consent') { dev.pendingLocationAsk = why; return; }
    dev.overlay = 'location'; dev.location.lastAskAt = clock.now();
    say(`Popup izin lokasi bawaan perangkat muncul (${why}).`, { tone: 'muted' });
    fact('location.prompt');
    notify();
  }
  function answerLocation(choice) {
    dev.overlay = null;
    dev.location.status = choice;
    if (choice === 'denied') { say('Izin lokasi ditolak → tidak ada lokasi dikirim. Notifikasi suara & iklan tetap berjalan.'); fact('location.denied'); }
    else { fact('location.granted', { choice }); sendLocation(); }
    if (dev.pendingLocationAsk) dev.pendingLocationAsk = null;
    notify();
  }
  async function sendLocation() {
    if (!['once', 'while'].includes(dev.location.status) || !dev.online) return;
    try { await api(srv.reportLocation, dev.id, { lat: -6.2, lng: 106.8, mode: dev.location.status }); } catch { /* */ }
  }

  // ------------------------------------------------------------ gangguan & kondisi perangkat
  function stopSpeech() { if (dev.speaking) { const s = dev.speaking; dev.speaking = null; s.cancel(); } }
  function setCall(onCall) {
    dev.inCall = onCall;
    if (onCall) {
      say('📞 Panggilan telepon aktif.', { tone: 'warn' });
      if (dev.speaking) { stopSpeech(); say('Suara pembayaran yang sedang dibacakan dihentikan.', { tone: 'muted' }); }
      clearQuiet(); dev.group.clear();
      if (dev.ad) finishAd(dev.ad.stage === 'PLAYING' ? 'INTERRUPTED' : 'FAILED_TO_START', 'CALL');
      fact('call.start');
    } else { say('📞 Panggilan selesai. Iklan berikutnya butuh transaksi sukses baru.'); fact('call.end'); pump(); }
    notify();
  }
  function setOnline(v) {
    dev.online = v;
    if (!v) {
      say('📶 Koneksi internet terputus.', { tone: 'warn' });
      srv.setDeviceConnected(dev.id, false);
      if (dev.ad) finishAd(dev.ad.stage === 'PLAYING' ? 'INTERRUPTED' : 'FAILED_TO_START', 'NETWORK_LOST');
    } else {
      say('📶 Koneksi tersambung kembali.');
      srv.setDeviceConnected(dev.id, true);
      flushOutbox(); sendHeartbeat();
    }
    fact(v ? 'net.on' : 'net.off');
    notify();
  }
  function setForeground(v) {
    dev.foreground = v;
    say(v ? 'Aplikasi kembali ke layar depan.' : 'Aplikasi pindah ke background.', { tone: 'muted' });
    if (!v && dev.platform === 'ios' && dev.ad) finishAd(dev.ad.stage === 'PLAYING' ? 'INTERRUPTED' : 'FAILED_TO_START', 'PLATFORM_NOT_READY');
    notify();
  }
  function setPlatform(p) {
    dev.platform = p;
    say(p === 'ios' ? 'Platform iOS: iklan hanya dimulai saat aplikasi di layar depan.' : 'Platform Android: berjalan di background mengikuti layanan notifikasi suara.', { tone: 'muted' });
    if (dev.account) api(srv.login, dev.id, dev.account.userId, p).catch(() => {});
    notify();
  }
  function kill() {
    dev.alive = false;
    stopSpeech(); clearQuiet(); dev.voiceQueue = []; dev.group.clear();
    if (dev.ad) finishAd('INTERRUPTED', 'APP_CLOSED', { silent: true });
    srv.setDeviceConnected(dev.id, false);
    clearInterval(dev.heartbeatTimer); clearTimeout(dev.outboxTimer);
    if (dev.location.status === 'once') dev.location.status = 'expired'; // izin sekali berakhir
    narrate('hp', '⏻ Aplikasi ditutup paksa. Tidak ada laporan yang terkirim; event baru tertahan di Firebase.', { tone: 'warn' });
    fact('app.killed');
    notify();
  }
  async function revive() {
    dev.alive = true;
    narrate('hp', '⏻ Aplikasi dibuka kembali.');
    dev.heartbeatTimer = setInterval(sendHeartbeat, 30000);
    if (dev.account) {
      await sendHeartbeat();
      srv.setDeviceConnected(dev.id, dev.online);
      enterDasbor();
    }
    flushOutbox();
    fact('app.opened');
    notify();
  }

  // Majukan waktu: audio yang sedang maju normal tidak dianggap macet
  on((m) => {
    if (m.kind !== 'clock') return;
    if (dev.ad?.stage === 'PLAYING' && !dev.ad.simStall && !dev.ad.audio.paused) dev.ad.lastProgressAt += m.ms;
    if (dev.ad?.stage === 'PLAYING') return;
    sendHeartbeat();
  });

  function start() {
    dev.heartbeatTimer = setInterval(sendHeartbeat, 30000);
    dev.overlay = 'login';
    notify();
  }

  return {
    dev, start, login, logout, setSound, agreeConsent, rejectConsent, openConsent, answerLocation, setCall, setOnline,
    setForeground, setPlatform, kill, revive, toast, sendHeartbeat,
    setLoadMode(m) { dev.loadMode = m; notify(); }, setConsentSaveMode(m) { dev.consentSaveMode = m; dev.failOnceUsed = false; notify(); },
    goPage(p) { dev.page = p; if (p === 'dasbor') enterDasbor(); notify(); },
    openTnc() {
      dev.overlay = 'tnc';
      dev.tncError = dev.online ? '' : 'Syarat & Ketentuan belum dapat dimuat. Silakan coba lagi.';
      notify();
    },
    closeOverlay() { if (dev.overlay === 'consent') return rejectConsent(); dev.overlay = null; notify(); },
    onChange(fn) { changed.add(fn); return () => changed.delete(fn); },
    refresh: notify,
    // Bantuan skenario demo: bersihkan antrean & interval perangkat (bukan fitur produk)
    resetForScenario() {
      stopSpeech(); clearQuiet(); dev.voiceQueue = []; dev.group.clear();
      if (dev.ad) finishAd('INTERRUPTED', 'APP_CLOSED', { silent: true });
      dev.outbox = [];
      srv.resetDeviceInterval(dev.id);
      notify();
    },
    // Event dari FCM sungguhan (backend → Firebase → HP)
    // Event dari FCM sungguhan. Mengembalikan keterangan hasil untuk log FCM.
    receiveExternal(e, raw) {
      const out = (msg, tone = 'muted') => { say(msg, { tone }); return msg; };
      if (!e) return out(`Pesan FCM dengan topic "${raw?.topic}" bukan transaksi → diabaikan.`);
      if (!dev.account) return out('Event FCM diterima tetapi belum ada akun login → diabaikan.', 'warn');
      if (!e.txId || !Number.isFinite(e.amount)) return out('Event FCM tidak lengkap (butuh refid/txId dan amount) → diabaikan.', 'warn');
      const dup = dev.seenTx.has(e.txId);
      // Backend tidak mengirim MID: event dianggap untuk merchant akun yang sedang login di HP ini.
      e = { ...e, mid: dev.account.mid };
      srv.injectTransaction(e);
      onFirebaseEvent(e);
      if (dup) return 'Diabaikan: refid sudah pernah diterima (duplikat)';
      if (e.status !== 'SUKSES') return `Dicatat, tidak dibacakan (status ${e.status})`;
      if (!dev.soundOn) return 'Dicatat, tidak dibacakan (notifikasi suara OFF)';
      if (dev.inCall) return 'Dicatat, tidak dibacakan (sedang telepon)';
      return 'Diterima → masuk antrean suara pembayaran';
    },
    cfg, uid,
  };
}
