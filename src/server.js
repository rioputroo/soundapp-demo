// =============================================================================
// BACKEND TIRUAN (berjalan di browser) — hanya aturan yang tertulis di PRD.
// Saat diintegrasikan, modul ini diganti adapter ke backend rekan (lihat README).
// =============================================================================
import { clock, narrate, fact, uid, rupiah, fmtDur } from './core.js';
import { makeSampleAd } from './audio.js';

const DAY = 864e5;
const HOUR = 36e5;

export const MCC = [
  { code: '5411', name: 'Toko Kelontong / Supermarket' },
  { code: '5812', name: 'Restoran / Rumah Makan' },
  { code: '5814', name: 'Kedai Kopi / Makanan Cepat Saji' },
  { code: '5912', name: 'Apotek' },
  { code: '5999', name: 'Toko Ritel Lainnya' },
  { code: '7230', name: 'Salon Kecantikan' },
];
export const MERCHANTS = [
  { mid: '241122001000000', name: 'Mini Clo', mcc: '5812',
    qris: '00020101021126650013ID.PAYDIA.WWW011893600818024112200102152411220010000000303UME51440014WWW.QRIS.CO.ID0215IDX0306199900010303UME5204472253033605802ID5910  Mini Clo6008KETAPANG6105788646219071524112200100000063048DA0' },
  { mid: '250519005000102', name: 'Apotek Sehat Selalu', mcc: '5912' },
  { mid: '250519005000103', name: 'Kedai Kopi Senja', mcc: '5814' },
  { mid: '250519005000104', name: 'Toko Kelontong Makmur', mcc: '5411' },
];
export const ACCOUNTS = [
  { userId: 'sari', name: 'Bu Sari', phone: '0812-1000-0101', mid: MERCHANTS[0].mid },
  { userId: 'budi', name: 'Pak Budi', phone: '0812-1000-0102', mid: MERCHANTS[1].mid },
  { userId: 'dion', name: 'Mas Dion', phone: '0812-1000-0103', mid: MERCHANTS[2].mid },
  { userId: 'lina', name: 'Ci Lina', phone: '0812-1000-0104', mid: MERCHANTS[3].mid },
];
// Hak akses (PRD): "Manajemen Iklan" dan "Approval Iklan" independen. Log mengikuti dashboard existing.
export const ADMINS = [
  { id: 'andi', name: 'Andi · Bisnis', perms: ['IKLAN', 'APPROVAL', 'LOG'] },
  { id: 'bella', name: 'Bella · Bisnis', perms: ['IKLAN', 'APPROVAL', 'LOG'] },
  { id: 'citra', name: 'Citra · Bisnis', perms: ['IKLAN'] },
  { id: 'dodi', name: 'Dodi · Audit', perms: ['LOG'] },
];
export const merchantOf = (mid) => MERCHANTS.find((m) => m.mid === mid);
export const accountOf = (id) => ACCOUNTS.find((a) => a.userId === id);

export const PRD_CONFIG = Object.freeze({
  quietMs: 500, intervalSec: 60, startupTimeoutSec: 30, stallTimeoutSec: 30,
  sessionTimeoutMin: 15, // PRD: "batas waktu tidak aktif" (nilai belum ditetapkan)
});

export const STATUS_LABEL = {
  MENUNGGU_PERSETUJUAN: 'Menunggu Persetujuan', DITOLAK: 'Ditolak', MENUNGGU_TAYANG: 'Menunggu Tayang',
  SEDANG_TAYANG: 'Sedang Tayang', PAUSED: 'Paused', SELESAI: 'Selesai',
};
export const RESULT_LABEL = { COMPLETED: 'Selesai', FAILED_TO_START: 'Gagal dimulai', INTERRUPTED: 'Terputus' };
export const REASON_LABEL = {
  STARTUP_TIMEOUT: 'Audio tidak mulai dalam 30 detik', STALL_TIMEOUT: 'Buffering tanpa kemajuan 30 detik',
  CALL: 'Panggilan telepon', NETWORK_LOST: 'Koneksi terputus', CAMPAIGN_PAUSED: 'Campaign di-pause',
  CAMPAIGN_NOT_ELIGIBLE: 'Campaign tidak lagi eligible', SESSION_CHANGED: 'Sesi/akun berubah', NO_CONSENT: 'Consent tidak valid',
  PLATFORM_NOT_READY: 'Platform tidak siap (iOS background)', MEDIA_ERROR: 'Materi gagal diputar',
  SOUND_OFF: 'Suara dimatikan', APP_CLOSED: 'Aplikasi ditutup',
};

// ---------------------------------------------------------------- state
let S;
export function resetServer() {
  S = {
    config: { ...PRD_CONFIG },
    tnc: { version: 1, publishedAt: clock.now() },
    media: new Map(), campaigns: new Map(), requests: new Map(), audit: [],
    sessions: new Map(), consents: [], locations: [], transactions: new Map(),
    usedTriggers: new Map(), playbacks: new Map(), deviceAd: new Map(), queueSeq: 0,
    devices: new Map(), // Firebase sim: deviceId -> { mid, connected, deliver, pending[] }
  };
  seed();
}
export const getConfig = () => S.config;
export function setConfig(patch, actor) {
  const before = { ...S.config };
  for (const k of Object.keys(PRD_CONFIG)) if (patch[k] !== undefined && Number(patch[k]) >= 0) S.config[k] = Number(patch[k]);
  audit(actor, 'UBAH_PARAMETER', null, before, { ...S.config }, 'Parameter engine');
}

// ---------------------------------------------------------------- status campaign (dihitung, bukan disimpan)
export function deriveStatus(c, now = clock.now()) {
  if (c.pendingRequestId) return 'MENUNGGU_PERSETUJUAN';
  if (!c.inServingCycle) return 'DITOLAK';
  if (now >= c.endAt) return 'SELESAI';             // Selesai mengalahkan Paused
  if (c.isPaused) return 'PAUSED';
  if (now < c.startAt) return 'MENUNGGU_TAYANG';
  return 'SEDANG_TAYANG';
}
// Edit: Menunggu Tayang, Paused, Ditolak, Selesai (bagian "Edit campaign" PRD). Sedang Tayang: pause dulu.
export function allowedActions(status) {
  return {
    MENUNGGU_TAYANG: ['EDIT', 'PAUSE'], SEDANG_TAYANG: ['PAUSE'], PAUSED: ['EDIT', 'RESUME'],
    DITOLAK: ['EDIT'], SELESAI: ['EDIT'], MENUNGGU_PERSETUJUAN: [],
  }[status];
}

// ---------------------------------------------------------------- audit (append-only)
function audit(actor, action, campaign, before, after, label) {
  S.audit.push(Object.freeze({ id: uid('aud'), at: clock.now(), actor, action, campaignId: campaign?.id || null,
    campaignName: campaign?.name || label || '', before: before && JSON.parse(JSON.stringify(before)), after: after && JSON.parse(JSON.stringify(after)) }));
}
const editable = (c) => ({ name: c.name, startAt: c.startAt, endAt: c.endAt, advertiserMid: c.advertiserMid, excludeSelf: c.excludeSelf, mccExclusions: [...c.mccExclusions] });

export class ValidationError extends Error { constructor(fields) { super('Data belum valid'); this.fields = fields; } }
export class ActionError extends Error {}

function validate(input, { requireMedia }) {
  const f = {};
  const now = clock.now();
  if (requireMedia) {
    if (!input.advertiserName?.trim()) f.advertiserName = 'Nama pengiklan wajib diisi.';
    if (!/^(\+62|62|0)8\d{7,11}$/.test(String(input.advertiserPhone || '').replace(/[\s-]/g, ''))) f.advertiserPhone = 'Format nomor telepon belum sesuai, contoh 081234567890.';
    if (!input.media) f.media = 'Unggah materi audio dulu.';
  }
  if (!input.name?.trim()) f.name = 'Nama campaign wajib diisi.';
  if (!input.startAt) f.startAt = 'Waktu mulai wajib diisi.';
  if (!input.endAt) f.endAt = 'Waktu akhir wajib diisi.';
  else if (input.startAt && input.endAt <= input.startAt) f.endAt = 'Waktu akhir harus setelah waktu mulai.';
  else if (input.endAt <= now) f.endAt = 'Waktu akhir harus lebih besar dari waktu sekarang.';
  if (input.advertiserMid && !merchantOf(input.advertiserMid)) f.advertiserMid = 'MID tidak ditemukan di master merchant.';
  if (input.excludeSelf && !input.advertiserMid) f.excludeSelf = 'Pilih MID dulu.';
  for (const code of input.mccExclusions || []) if (!MCC.some((m) => m.code === code)) f.mccExclusions = `MCC ${code} tidak ada di master.`;
  if (Object.keys(f).length) throw new ValidationError(f);
}

// ---------------------------------------------------------------- manajemen iklan
export function addCampaign(input, actor) {
  validate(input, { requireMedia: true });
  const mediaId = uid('med');
  S.media.set(mediaId, input.media);
  const c = {
    id: uid('cmp'), queueKey: ++S.queueSeq, advertiserName: input.advertiserName.trim(), advertiserPhone: input.advertiserPhone.trim(),
    name: input.name.trim(), mediaId, startAt: input.startAt, endAt: input.endAt,
    advertiserMid: input.advertiserMid || null, excludeSelf: !!input.excludeSelf, mccExclusions: [...new Set(input.mccExclusions || [])],
    inServingCycle: false, isPaused: false, pauseReason: null, pendingRequestId: null, createdBy: actor, createdAt: clock.now(), submittedAt: clock.now(),
  };
  const r = { id: uid('req'), campaignId: c.id, kind: 'TAMBAH', status: 'MENUNGGU', makerId: actor, checkerId: null, submittedAt: clock.now(), decidedAt: null, base: null, proposed: editable(c) };
  c.pendingRequestId = r.id;
  S.campaigns.set(c.id, c); S.requests.set(r.id, r);
  audit(actor, 'AJUKAN_TAMBAH', c, null, editable(c));
  narrate('admin', `${adminName(actor)} menyimpan iklan "${c.name}" → status Menunggu Persetujuan, request "Tambah Iklan" terbentuk.`);
  fact('admin.add', { campaignId: c.id });
  return c;
}

export function editCampaign(id, proposed, actor) {
  const c = S.campaigns.get(id);
  const st = deriveStatus(c);
  if (st === 'MENUNGGU_PERSETUJUAN') throw new ActionError('Iklan sedang menunggu persetujuan.');
  if (st === 'SEDANG_TAYANG') { fact('admin.editBlocked'); throw new ActionError('Pause campaign terlebih dahulu untuk mengedit.'); }
  validate(proposed, { requireMedia: false });
  const base = editable(c);
  const next = { ...base, ...proposed, name: proposed.name.trim() };
  if (next.advertiserMid !== base.advertiserMid && !proposed.excludeSelfConfirmed) next.excludeSelf = false;
  delete next.excludeSelfConfirmed;
  const changed = Object.keys(next).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(base[k]));
  if (!changed.length) throw new ActionError('Tidak ada perubahan untuk diajukan.');
  const r = { id: uid('req'), campaignId: id, kind: 'UBAH', status: 'MENUNGGU', makerId: actor, checkerId: null, submittedAt: clock.now(), decidedAt: null, base, proposed: next, prevStatus: st };
  c.pendingRequestId = r.id;
  S.requests.set(r.id, r);
  audit(actor, 'AJUKAN_UBAH', c, base, next);
  narrate('admin', `${adminName(actor)} mengajukan perubahan "${c.name}" (${changed.join(', ')}) → status Menunggu Persetujuan. Data aktif belum berubah.`);
  fact('admin.edit', { campaignId: id });
  return r;
}

export function decide(reqId, actor, decision) {
  const r = S.requests.get(reqId);
  if (!r || r.status !== 'MENUNGGU') throw new ActionError('Request sudah diproses.');
  if (r.makerId === actor) { fact('admin.selfBlocked'); throw new ActionError('Pembuat request tidak dapat memproses request miliknya sendiri.'); }
  if (!hasPerm(actor, 'APPROVAL')) throw new ActionError('Akun ini tidak punya hak akses Approval Iklan.');
  const c = S.campaigns.get(r.campaignId);
  const before = { status: deriveStatus(c), ...editable(c) };
  r.status = decision === 'approve' ? 'DISETUJUI' : 'DITOLAK'; r.checkerId = actor; r.decidedAt = clock.now();
  c.pendingRequestId = null;
  if (decision === 'approve') {
    if (r.kind === 'UBAH') Object.assign(c, r.proposed); // status Paused dipertahankan (isPaused tidak diubah)
    c.inServingCycle = true;
  }
  const after = { status: deriveStatus(c), ...editable(c) };
  audit(actor, decision === 'approve' ? 'SETUJUI' : 'TOLAK', c, before, after);
  narrate('admin', `${adminName(actor)} ${decision === 'approve' ? 'menyetujui' : 'menolak'} request "${r.kind === 'TAMBAH' ? 'Tambah Iklan' : 'Ubah Iklan'}" untuk "${c.name}" → status ${STATUS_LABEL[after.status]}.`);
  fact('admin.decide', { decision, campaignId: c.id, status: after.status });
  return c;
}

export function pause(id, actor, reason) {
  const c = S.campaigns.get(id);
  if (!allowedActions(deriveStatus(c)).includes('PAUSE')) throw new ActionError('Pause tidak tersedia untuk status ini.');
  if (!reason?.trim()) throw new ValidationError({ reason: 'Alasan pause wajib diisi.' });
  if (reason.length > 255) throw new ValidationError({ reason: 'Maksimal 255 karakter.' });
  const before = { status: deriveStatus(c) };
  c.isPaused = true; c.pauseReason = reason.trim();
  audit(actor, 'PAUSE', c, before, { status: deriveStatus(c), alasan: c.pauseReason });
  narrate('admin', `${adminName(actor)} mem-pause "${c.name}" (alasan: ${c.pauseReason}). Audio yang sudah berbunyi dibiarkan selesai; pemutaran baru tidak dimulai.`);
  fact('admin.pause', { campaignId: id });
}
export function resume(id, actor) {
  const c = S.campaigns.get(id);
  if (!allowedActions(deriveStatus(c)).includes('RESUME')) throw new ActionError('Resume tidak tersedia: campaign sudah selesai atau tidak di-pause.');
  const before = { status: deriveStatus(c) };
  c.isPaused = false;
  audit(actor, 'RESUME', c, before, { status: deriveStatus(c) });
  narrate('admin', `${adminName(actor)} me-resume "${c.name}" → ${STATUS_LABEL[deriveStatus(c)]}. Iklan baru berbunyi lagi setelah ada transaksi sukses baru.`);
  fact('admin.resume', { campaignId: id });
}

export const hasPerm = (adminId, p) => ADMINS.find((a) => a.id === adminId)?.perms.includes(p);
const adminName = (id) => ADMINS.find((a) => a.id === id)?.name.split(' ·')[0] || id;

// ---------------------------------------------------------------- S&K & consent
export const getTnc = () => ({ ...S.tnc, title: 'Syarat dan Ketentuan Merchant Apps', body: tncBody(S.tnc.version) });
function tncBody(v) {
  const base = [
    'Layanan notifikasi suara membacakan setiap pembayaran sukses yang diterima akun merchant Anda.',
    'Setelah notifikasi pembayaran selesai, perangkat Anda dapat memutar promosi suara dari pengiklan yang telah dikurasi dan disetujui Paydia.',
    'Promosi suara diputar melalui streaming dan menggunakan kuota data perangkat Anda.',
    'Promosi suara tidak mengubah, menunda pencatatan, ataupun membatalkan transaksi pembayaran Anda.',
    'Notifikasi suara dan promosi tidak diputar saat perangkat sedang dalam panggilan telepon.',
    'Paydia mencatat sesi login, perangkat, dan hasil pemutaran promosi untuk keperluan operasional dan audit.',
    'Jika Anda memberikan izin lokasi, lokasi perangkat dapat digunakan untuk pengembangan layanan sesuai izin yang berlaku.',
    'Anda dapat menonaktifkan notifikasi suara kapan saja melalui menu Pengaturan.',
    'Pengiklan bertanggung jawab atas kebenaran materi promosi; Paydia berhak menolak materi yang tidak sesuai ketentuan.',
    'Persetujuan ini dicatat per akun beserta waktu dan versi naskah. Perubahan naskah memerlukan persetujuan ulang.',
    'Ketentuan lain mengikuti Syarat dan Ketentuan umum Paydia Bisnis.',
    'Naskah ini adalah contoh untuk demo. Naskah final disediakan oleh tim Risk & Compliance.',
  ];
  if (v > 1) base.splice(2, 0, `Pembaruan versi ${v}: ketentuan tambahan mengenai durasi dan frekuensi promosi suara.`);
  return base;
}
export function publishTnc(actor) {
  S.tnc = { version: S.tnc.version + 1, publishedAt: clock.now() };
  audit(actor, 'TERBITKAN_SK', null, null, { versi: S.tnc.version }, 'Syarat & Ketentuan');
  narrate('admin', `Risk & Compliance menerbitkan naskah S&K versi ${S.tnc.version}. Persetujuan lama tidak berlaku; merchant wajib setuju ulang.`);
  fact('admin.tnc', { version: S.tnc.version });
}
export function consentStatus(userId) {
  const rec = [...S.consents].reverse().find((c) => c.userId === userId && c.tncVersion === S.tnc.version);
  return { valid: !!rec, version: S.tnc.version };
}
export function saveConsent(userId, deviceId, tncVersion) {
  if (tncVersion !== S.tnc.version) throw new ActionError('Naskah sudah berubah.');
  const rec = Object.freeze({ id: uid('cns'), userId, mid: accountOf(userId).mid, deviceId, tncVersion, agreedAt: clock.now() });
  S.consents.push(rec);
  narrate('server', `Persetujuan S&K v${tncVersion} tersimpan untuk ${accountOf(userId).name} (waktu & versi naskah dicatat).`);
  return rec;
}

// ---------------------------------------------------------------- sesi perangkat
export function login(deviceId, userId, platform) {
  const old = S.sessions.get(deviceId);
  if (old) { S.sessions.delete(deviceId); narrate('server', `Sesi lama ${accountOf(old.userId).name} (MID …${old.mid.slice(-4)}) dinonaktifkan.`); }
  const acc = accountOf(userId);
  const s = { deviceId, userId, mid: acc.mid, platform, loginAt: clock.now(), lastSeenAt: clock.now() };
  S.sessions.set(deviceId, s);
  narrate('server', `Sesi aktif tercatat: ${acc.name}, MID ${acc.mid}, perangkat ${deviceId}, ${platform}.`);
  return s;
}
export function logout(deviceId, reason = 'logout') {
  const s = S.sessions.get(deviceId);
  if (s) { S.sessions.delete(deviceId); narrate('server', `Sesi ${accountOf(s.userId).name} diakhiri (${reason}). Engine tidak memilih iklan untuk MID ini lagi.`); }
}
export function heartbeat(deviceId) {
  const s = activeSession(deviceId);
  if (s) s.lastSeenAt = clock.now();
  return !!s;
}
function activeSession(deviceId) {
  const s = S.sessions.get(deviceId);
  if (!s) return null;
  if (clock.now() - s.lastSeenAt > S.config.sessionTimeoutMin * 60e3) {
    S.sessions.delete(deviceId);
    narrate('server', `Sesi ${accountOf(s.userId).name} melewati batas tidak aktif → ditandai tidak aktif.`);
    return null;
  }
  return s;
}
export function reportLocation(deviceId, loc) {
  S.locations.push({ deviceId, ...loc, at: clock.now() });
  narrate('server', `Lokasi perangkat diterima (${loc.mode === 'once' ? 'izin sekali' : 'izin selama aplikasi digunakan'}). Tidak dipakai engine pada fase ini.`);
}

// ---------------------------------------------------------------- transaksi + Firebase (simulasi)
export function registerDevice(deviceId, mid, deliver) { S.devices.set(deviceId, { mid, connected: true, deliver, pending: [] }); }
export function unregisterDevice(deviceId) { S.devices.delete(deviceId); }
export function setDeviceConnected(deviceId, connected) {
  const d = S.devices.get(deviceId); if (!d) return;
  d.connected = connected;
  if (connected && d.pending.length) {
    narrate('firebase', `Perangkat terhubung kembali → ${d.pending.length} event yang tertahan dikirim.`);
    const list = d.pending.splice(0);
    list.forEach((e, i) => setTimeout(() => d.connected && d.deliver(e), 120 + i * 60));
  }
}
function publish(mid, event) {
  for (const [deviceId, d] of S.devices) {
    if (d.mid !== mid) continue;
    if (d.connected) setTimeout(() => (d.connected ? d.deliver(event) : d.pending.push(event)), 150 + Math.random() * 120);
    else { d.pending.push(event); narrate('firebase', `Perangkat ${deviceId} sedang tidak terhubung → event ${rupiah(event.amount)} ditahan.`); }
  }
}
// Transaksi dari backend asli (via FCM): dicatat agar engine simulasi mengenalinya saat memilih iklan.
export function injectTransaction({ txId, mid, amount, status, txTime }) {
  S.transactions.set(txId, { txId, mid, amount, status, createdAt: txTime || clock.now() });
}
export function simulateTransaction(mid, amount, { status = 'SUKSES', duplicates = 1, txId } = {}) {
  let tx = txId && S.transactions.get(txId);
  if (!tx) { tx = { txId: uid('TRX'), mid, amount, status, createdAt: clock.now() }; S.transactions.set(tx.txId, tx); }
  tx.status = status;
  narrate('server', `Transaksi ${rupiah(amount)} ke ${merchantOf(mid).name}: ${status.toLowerCase()} → event dikirim lewat Firebase${duplicates > 1 ? ` (${duplicates}× event untuk transaksi yang sama)` : ''}.`);
  for (let i = 0; i < duplicates; i++) publish(mid, { eventId: uid('evt'), txId: tx.txId, mid, amount, status, txTime: tx.createdAt });
  return tx;
}

// ---------------------------------------------------------------- ENGINE: reservasi → gate → hasil
function deviceAd(deviceId) {
  if (!S.deviceAd.has(deviceId)) S.deviceAd.set(deviceId, { lastEndAt: 0, cursor: 0, activePlayback: null, activeUntil: 0 });
  return S.deviceAd.get(deviceId);
}
export function resetDeviceInterval(deviceId) { const d = deviceAd(deviceId); d.lastEndAt = 0; d.activePlayback = null; }
export const getDeviceAd = (deviceId) => deviceAd(deviceId);

function campaignCheck(c, merchant, now) {
  const st = deriveStatus(c, now);
  if (st !== 'SEDANG_TAYANG') return { ok: false, why: STATUS_LABEL[st] };
  if (c.mccExclusions.includes(merchant.mcc)) return { ok: false, why: `MCC ${merchant.mcc} dikecualikan` };
  if (c.excludeSelf && c.advertiserMid === merchant.mid) return { ok: false, why: 'pengiklan memilih tidak tayang di aplikasi sendiri' };
  return { ok: true };
}

export function requestOpportunity({ deviceId, mid, triggerTxIds }) {
  const now = clock.now();
  const checks = [];
  const fail = (code, label) => {
    checks.push({ ok: false, label });
    narrate('server', 'Kesempatan iklan ditolak', { checks, tone: 'muted' });
    fact('srv.noad', { reason: code });
    return { ad: null, reason: code, label };
  };
  const s = activeSession(deviceId);
  if (!s) return fail('NO_SESSION', 'Sesi merchant aktif');
  if (s.mid !== mid) return fail('MID_MISMATCH', 'MID sesi aktif cocok');
  s.lastSeenAt = now;
  checks.push({ ok: true, label: `Sesi aktif, MID …${mid.slice(-4)}` });
  if (!consentStatus(s.userId).valid) return fail('NO_CONSENT', `Consent S&K v${S.tnc.version}`);
  checks.push({ ok: true, label: `Consent S&K v${S.tnc.version} valid` });
  const txs = triggerTxIds.map((id) => S.transactions.get(id)).filter((t) => t && t.mid === mid && t.status === 'SUKSES');
  if (!txs.length) return fail('INVALID_TRIGGER', 'Transaksi pemicu valid');
  if (txs.some((t) => S.usedTriggers.has(t.txId))) return fail('DUPLICATE_TRIGGER', 'Transaksi pemicu belum pernah memicu iklan');
  checks.push({ ok: true, label: `${txs.length} transaksi pemicu valid & belum dipakai` });
  const da = deviceAd(deviceId);
  if (da.activePlayback && da.activeUntil > now) return fail('AD_RUNNING', 'Tidak ada iklan lain berjalan di perangkat');
  const wait = da.lastEndAt + S.config.intervalSec * 1000 - now;
  if (da.lastEndAt && wait > 0) return fail('INTERVAL', `Interval ${S.config.intervalSec} dtk (sisa ${Math.ceil(wait / 1000)} dtk)`);
  checks.push({ ok: true, label: `Interval ${S.config.intervalSec} dtk terpenuhi` });

  const merchant = merchantOf(mid);
  const all = [...S.campaigns.values()].sort((a, b) => a.queueKey - b.queueKey);
  const evaluated = all.map((c) => ({ c, r: campaignCheck(c, merchant, now) }));
  const eligible = evaluated.filter((x) => x.r.ok).map((x) => x.c);
  const candidateLines = evaluated.map((x) => ({ ok: x.r.ok, label: `#${x.c.queueKey} ${x.c.name}${x.r.ok ? '' : ` — ${x.r.why}`}`, sub: true }));
  if (!eligible.length) { checks.push(...candidateLines); return fail('NO_CANDIDATE', 'Ada campaign yang cocok'); }
  const chosen = eligible.find((c) => c.queueKey > da.cursor) || eligible[0];
  checks.push(...candidateLines);
  checks.push({ ok: true, label: `Dipilih giliran berikutnya: #${chosen.queueKey} ${chosen.name}`, strong: true });

  const media = S.media.get(chosen.mediaId);
  const pb = { id: uid('PLY'), campaignId: chosen.id, campaignName: chosen.name, advertiserName: chosen.advertiserName, recipientMid: mid, deviceId,
    triggerTxIds: txs.map((t) => t.txId), status: 'DIKIRIM', reason: null, reservedAt: now, startedAt: null, endedAt: null, durationMs: media.durationMs };
  S.playbacks.set(pb.id, pb);
  txs.forEach((t) => S.usedTriggers.set(t.txId, pb.id));
  da.cursor = chosen.queueKey; da.activePlayback = pb.id;
  da.activeUntil = now + (S.config.startupTimeoutSec + S.config.stallTimeoutSec + 60) * 1000 + media.durationMs; // pengaman internal
  narrate('server', `Kesempatan iklan disetujui → kirim URL streaming "${chosen.name}" (${fmtDur(media.durationMs)})`, { checks });
  fact('srv.reserved', { campaignId: chosen.id, playbackId: pb.id });
  return { ad: { playbackId: pb.id, campaignId: chosen.id, campaignName: chosen.name, advertiserName: chosen.advertiserName, mediaUrl: media.url, durationMs: media.durationMs } };
}

// Cek ulang tepat sebelum audio mulai (PRD: "Kandidat diperiksa kembali sebelum audio mulai, termasuk perubahan dari backoffice")
export function gate(playbackId, deviceId) {
  const pb = S.playbacks.get(playbackId);
  const now = clock.now();
  const reject = (reason, label) => {
    closePlayback(pb, 'FAILED_TO_START', reason);
    narrate('server', `Cek ulang gagal: ${label} → iklan dibatalkan, dicatat Gagal dimulai.`, { tone: 'warn' });
    fact('srv.gate', { go: false, reason });
    return { go: false, reason };
  };
  const s = activeSession(deviceId);
  if (!s || s.mid !== pb.recipientMid) return reject('SESSION_CHANGED', 'sesi/MID sudah berubah');
  if (!consentStatus(s.userId).valid) return reject('NO_CONSENT', 'consent tidak valid');
  const c = S.campaigns.get(pb.campaignId);
  const r = campaignCheck(c, merchantOf(pb.recipientMid), now);
  if (!r.ok) return reject(c.isPaused ? 'CAMPAIGN_PAUSED' : 'CAMPAIGN_NOT_ELIGIBLE', `campaign ${r.why}`);
  pb.status = 'DIPUTAR'; pb.startedAt = now;
  narrate('server', 'Cek ulang OK (sesi, consent, status campaign) → audio boleh mulai.');
  fact('srv.gate', { go: true });
  return { go: true };
}

export function reportResult(playbackId, deviceId, result, reason, at) {
  const pb = S.playbacks.get(playbackId);
  if (RESULT_LABEL[pb.status]) {
    narrate('server', `Konfirmasi ${RESULT_LABEL[result]} untuk ${playbackId} sudah pernah diterima → tidak dihitung dua kali.`, { tone: 'muted' });
    return { duplicate: true };
  }
  closePlayback(pb, result, reason, at);
  narrate('server', `Hasil pemutaran diterima: ${RESULT_LABEL[result]}${reason ? ` (${REASON_LABEL[reason] || reason})` : ''} → tercatat di Log Pemutaran Iklan.`, { tone: result === 'COMPLETED' ? 'ok' : 'warn' });
  fact('srv.result', { result, reason });
  return { ok: true };
}
function closePlayback(pb, result, reason, at) {
  pb.status = result; pb.reason = reason || null; pb.endedAt = at || clock.now();
  if (!pb.startedAt && result !== 'FAILED_TO_START') pb.startedAt = pb.reservedAt;
  const da = deviceAd(pb.deviceId);
  // PRD: interval dihitung sejak pemutaran selesai atau terinterupsi
  if (result === 'COMPLETED' || result === 'INTERRUPTED') da.lastEndAt = Math.max(da.lastEndAt, pb.endedAt);
  if (da.activePlayback === pb.id) da.activePlayback = null;
}

// ---------------------------------------------------------------- view untuk dashboard
export function campaignView(c) {
  const status = deriveStatus(c);
  const media = S.media.get(c.mediaId);
  const pbs = [...S.playbacks.values()].filter((p) => p.campaignId === c.id);
  const n = (s) => pbs.filter((p) => p.status === s).length;
  const req = c.pendingRequestId && S.requests.get(c.pendingRequestId);
  return { ...c, status, actions: allowedActions(status), media, advertiserMerchant: merchantOf(c.advertiserMid)?.name || null,
    summary: { COMPLETED: n('COMPLETED'), FAILED_TO_START: n('FAILED_TO_START'), INTERRUPTED: n('INTERRUPTED') }, pendingRequest: req || null };
}
export const listCampaigns = () => [...S.campaigns.values()].sort((a, b) => b.submittedAt - a.submittedAt || b.queueKey - a.queueKey).map(campaignView);
export const getCampaign = (id) => campaignView(S.campaigns.get(id));
export const listRequests = () => [...S.requests.values()].sort((a, b) => b.submittedAt - a.submittedAt).map((r) => ({ ...r, campaign: S.campaigns.get(r.campaignId) }));
export const listPlaybackLog = () => [...S.playbacks.values()].filter((p) => RESULT_LABEL[p.status]).sort((a, b) => b.endedAt - a.endedAt);
export const listAudit = () => [...S.audit].reverse();
export const listSessions = () => [...S.sessions.values()];

// ---------------------------------------------------------------- seed
function seed() {
  const now = clock.now();
  const mk = (kind, sec) => makeSampleAd(kind, sec);
  const put = (o, { approve = true, reject = false, pauseReason = null } = {}) => {
    const mediaId = uid('med'); S.media.set(mediaId, o.media);
    const c = { id: uid('cmp'), queueKey: ++S.queueSeq, advertiserMid: null, excludeSelf: false, mccExclusions: [], isPaused: !!pauseReason, pauseReason,
      pendingRequestId: null, inServingCycle: approve, createdBy: 'andi', createdAt: o.submittedAt, ...o, mediaId };
    delete c.media;
    const r = { id: uid('req'), campaignId: c.id, kind: 'TAMBAH', status: approve ? 'DISETUJUI' : reject ? 'DITOLAK' : 'MENUNGGU', makerId: 'andi',
      checkerId: approve || reject ? 'bella' : null, submittedAt: o.submittedAt, decidedAt: approve || reject ? o.submittedAt + HOUR : null, base: null, proposed: editable(c) };
    if (!approve && !reject) c.pendingRequestId = r.id;
    S.campaigns.set(c.id, c); S.requests.set(r.id, r);
    return c;
  };
  put({ name: 'Promo Kopi Senja – Diskon 20%', advertiserName: 'Kedai Kopi Senja', advertiserPhone: '081234500103', advertiserMid: MERCHANTS[2].mid, excludeSelf: true,
    media: mk('a', 6), startAt: now - 2 * DAY, endAt: now + 30 * DAY, submittedAt: now - 3 * DAY });
  put({ name: 'Isi Pulsa Hemat', advertiserName: 'PT Pulsa Hemat Nusantara', advertiserPhone: '081234500201', mccExclusions: ['5912'],
    media: mk('b', 8), startAt: now - 2 * DAY, endAt: now + 30 * DAY, submittedAt: now - 3 * DAY + HOUR });
  put({ name: 'Asuransi Mikro Rp5.000', advertiserName: 'Koperasi Lindung Sejahtera', advertiserPhone: '081234500202',
    media: mk('c', 7), startAt: now - DAY, endAt: now + 20 * DAY, submittedAt: now - 2 * DAY });
  put({ name: 'Diskon Elektronik Jaya (iklan 25 dtk)', advertiserName: 'Toko Elektronik Jaya', advertiserPhone: '081234500203',
    media: mk('d', 25), startAt: now - DAY, endAt: now + 20 * DAY, submittedAt: now - 2 * DAY + HOUR }, { pauseReason: 'Menunggu konfirmasi materi terbaru dari pengiklan' });
  put({ name: 'Promo Akhir Tahun', advertiserName: 'Mall Sentosa', advertiserPhone: '081234500204',
    media: mk('a', 7), startAt: now + DAY, endAt: now + 40 * DAY, submittedAt: now - DAY });
  put({ name: 'Promo Ramadan', advertiserName: 'Toko Kurma Barokah', advertiserPhone: '081234500205',
    media: mk('b', 6), startAt: now - 60 * DAY, endAt: now - 30 * DAY, submittedAt: now - 62 * DAY });
  put({ name: 'Materi Tidak Lolos', advertiserName: 'CV Contoh Ditolak', advertiserPhone: '081234500206',
    media: mk('c', 5), startAt: now - DAY, endAt: now + 10 * DAY, submittedAt: now - 20 * HOUR }, { approve: false, reject: true });
  put({ name: 'Laundry Kilat Bersih', advertiserName: 'Laundry Kilat', advertiserPhone: '081234500207', advertiserMid: MERCHANTS[3].mid,
    media: mk('d', 9), startAt: now - HOUR, endAt: now + 15 * DAY, submittedAt: now - 2 * HOUR }, { approve: false });
}

export function campaignByName(prefix) { return [...S.campaigns.values()].find((c) => c.name.startsWith(prefix)); }

// Bantuan panduan demo (bukan fitur produk): hapus persetujuan akun agar skenario consent bisa diulang
export function revokeConsentForDemo(userId) { S.consents = S.consents.filter((c) => c.userId !== userId); }
