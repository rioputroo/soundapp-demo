// Daftar skenario panduan. Setiap skenario: aturan PRD (bahasa sederhana), langkah manual,
// "yang harus terjadi" (dicentang otomatis dari kejadian nyata), dan langkah otomatis.
import * as srv from './server.js';
import { makeSampleAd } from './audio.js';

const F = (type, cond = {}) => (f) => f.type === type && Object.entries(cond).every(([k, v]) => (typeof v === 'function' ? v(f[k]) : f[k] === v));
// f._n = urutan kemunculan jenis kejadian ini sejak skenario mulai (dihitung oleh runner)
const nth = (type, n, cond = {}) => { const m = F(type, cond); return (f) => m(f) && f._n === n; };
const after = (trigger, m) => { let armed = false; return (f) => { if (trigger(f)) armed = true; return armed && m(f); }; };
const MIN = 60e3;

export const GROUPS = ['Alur utama', 'Pembayaran bertemu iklan', 'Gangguan di HP', 'Dashboard & kelayakan iklan', 'Akun, persetujuan & izin'];

export const SCENARIOS = [
  // ------------------------------------------------------------------ Alur utama
  {
    id: 'alur', group: 0, title: 'Pembayaran sukses, lalu iklan diputar',
    rule: 'Setelah semua suara pembayaran selesai, antrean kosong, dan tidak ada pembayaran baru selama 0,5 detik, sistem mengevaluasi satu kesempatan iklan. Kandidat diperiksa ulang tepat sebelum audio mulai. Konfirmasi dikirim setelah audio selesai diputar.',
    steps: ['Klik <b>Kirim 1 pembayaran</b> di bawah HP.', 'Dengarkan suara pembayaran, lalu ada jeda singkat.', 'Iklan berbunyi sampai habis. Cek hasilnya di Dashboard Admin → Log → Pemutaran Iklan.'],
    expect: () => [
      ['Suara pembayaran dibacakan', F('pay.spoken')],
      ['Jeda tenang 0,5 detik terpenuhi', F('quiet.done')],
      ['HP meminta 1 kesempatan iklan', F('ad.request')],
      ['Server memeriksa syarat dan memilih campaign', F('srv.reserved')],
      ['Cek ulang ke server tepat sebelum audio mulai', F('srv.gate', { go: true })],
      ['Iklan berbunyi', F('ad.start')],
      ['Iklan selesai sampai habis', F('ad.result', { result: 'COMPLETED' })],
      ['Konfirmasi diterima server dan tercatat di Log', F('report.sent', { result: 'COMPLETED' })],
    ],
    async run(c) { c.pay(); await c.wait(F('report.sent'), 45000); },
  },
  {
    id: 'tiga', group: 0, title: 'Tiga pembayaran masuk berdekatan',
    rule: 'Setiap transaksi sukses unik menghasilkan satu suara, dibacakan berurutan. Satu kelompok antrean menghasilkan paling banyak satu kesempatan iklan, bukan satu iklan per pembayaran.',
    steps: ['Klik <b>3 sekaligus</b>.', 'Tiga nominal dibacakan satu per satu.', 'Setelah jeda 0,5 detik, hanya ada satu iklan.'],
    expect: () => [
      ['Pembayaran ke-1 dibacakan', nth('pay.spoken', 1)], ['Pembayaran ke-2 dibacakan', nth('pay.spoken', 2)], ['Pembayaran ke-3 dibacakan', nth('pay.spoken', 3)],
      ['Satu permintaan iklan untuk ketiga pembayaran', F('ad.request', { n: 3 })], ['Iklan berbunyi sekali', F('ad.start')],
    ],
    forbid: () => [['Permintaan iklan kedua untuk kelompok yang sama', nth('ad.request', 2)]],
    async run(c) { c.pay(15000); await c.sleep(150); c.pay(16000); await c.sleep(150); c.pay(17000); await c.wait(F('ad.result'), 45000); await c.sleep(800); },
  },
  {
    id: 'dobel', group: 0, title: 'Event dobel untuk satu transaksi',
    rule: 'Identitas transaksi dipakai untuk membedakan duplikat. Event duplikat tidak menambah suara dan tidak menambah kesempatan iklan.',
    steps: ['Klik <b>Event dobel</b> (satu transaksi, event dikirim 3 kali).', 'Hanya terdengar satu suara pembayaran.'],
    expect: () => [['Suara pembayaran dibacakan sekali', F('pay.spoken')], ['Event berikutnya diabaikan', F('pay.dup')], ['Satu iklan berbunyi', F('ad.start')]],
    forbid: () => [['Suara kedua untuk transaksi yang sama', nth('pay.spoken', 2)]],
    async run(c) { c.pay(50000, { duplicates: 3 }); await c.wait(F('ad.result'), 45000); await c.sleep(600); },
  },
  {
    id: 'pending', group: 0, title: 'Transaksi pending dan gagal',
    rule: 'Transaksi gagal, pending, atau event yang tidak diterima tidak dibacakan dan tidak memicu iklan. Suara baru muncul saat transaksi sudah final sukses.',
    steps: ['Klik <b>Gagal</b>: tidak ada suara.', 'Klik <b>Pending → sukses</b>: diam dulu, lalu dibacakan setelah statusnya sukses.'],
    expect: () => { let spoken = false; return [
      ['Transaksi gagal tidak dibacakan', F('pay.ignored', { status: 'GAGAL' })],
      ['Transaksi pending tidak dibacakan', F('pay.ignored', { status: 'PENDING' })],
      ['Setelah berubah sukses, baru dibacakan', (f) => F('pay.spoken')(f) && (spoken = true)],
      ['Iklan hanya dipicu transaksi sukses', (f) => F('ad.request')(f) && spoken],
    ]; },
    async run(c) {
      c.pay(20000, { status: 'GAGAL' }); await c.sleep(1200);
      const tx = c.pay(45000, { status: 'PENDING' }); await c.sleep(1800);
      c.pay(45000, { status: 'SUKSES', txId: tx.txId }); await c.wait(F('ad.result'), 45000);
    },
  },
  {
    id: 'interval', group: 0, title: 'Jeda 1 menit antar iklan',
    rule: 'Interval antar iklan 1 menit sejak pemutaran selesai atau terinterupsi, berlaku per perangkat. Interval yang habis tidak memicu iklan tanpa transaksi sukses baru.',
    steps: ['Kirim 1 pembayaran sampai iklan selesai.', 'Kirim pembayaran lagi: hanya suara pembayaran, tanpa iklan.', 'Klik <b>+1 mnt</b> di bagian atas halaman, lalu kirim pembayaran lagi: iklan berbunyi.'],
    expect: () => [
      ['Iklan pertama selesai', F('ad.result', { result: 'COMPLETED' })],
      ['Pembayaran berikutnya: server menolak karena belum 1 menit', F('srv.noad', { reason: 'INTERVAL' })],
      ['Setelah 1 menit + transaksi baru, iklan berbunyi lagi', nth('ad.start', 2)],
    ],
    async run(c) {
      c.pay(); await c.wait(F('ad.result'), 45000); await c.sleep(900);
      c.pay(30000); await c.wait(F('srv.noad'), 15000); await c.sleep(1200);
      c.note('Majukan waktu 1 menit (sama seperti tombol +1 mnt).'); c.advance(MIN); await c.sleep(700);
      c.pay(40000); await c.wait(F('ad.result'), 45000);
    },
  },
  {
    id: 'rotasi', group: 0, title: 'Iklan bergiliran',
    rule: 'Urutan antrean berdasarkan waktu submit Tambah Iklan, paling awal lebih dulu. Campaign yang tidak memenuhi syarat dilewati. Selesai satu putaran, kembali ke awal.',
    steps: ['Kirim pembayaran sampai iklan selesai.', 'Klik <b>+1 mnt</b>, kirim pembayaran lagi.', 'Iklan kedua adalah campaign berikutnya dalam antrean.'],
    expect: () => { let first = null; return [
      ['Iklan pertama berbunyi', (f) => F('ad.start')(f) && (first = f.campaignId, true)],
      ['Iklan kedua campaign yang berbeda (giliran berikutnya)', (f) => F('ad.start')(f) && f.campaignId !== first],
    ]; },
    async run(c) { c.pay(); await c.wait(F('ad.result'), 45000); await c.sleep(800); c.advance(MIN); await c.sleep(600); c.pay(60000); await c.wait(F('ad.result'), 45000); },
  },
  // ------------------------------------------------------------------ Pembayaran bertemu iklan
  {
    id: 'bayar-saat-iklan', group: 1, title: 'Pembayaran masuk saat iklan berbunyi',
    rule: 'Pembayaran baru tidak memotong iklan yang sudah mulai. Iklan diselesaikan dulu, lalu semua suara pembayaran yang mengantre dibacakan. Tidak ada suara yang tumpang tindih.',
    steps: ['Kirim 1 pembayaran.', 'Saat iklan sedang berbunyi, kirim 1 pembayaran lagi.', 'Iklan tetap selesai, baru pembayaran kedua dibacakan.'],
    expect: () => [
      ['Iklan berbunyi', F('ad.start')], ['Pembayaran baru masuk antrean dan menunggu', F('pay.waits')],
      ['Iklan tetap selesai sampai habis', F('ad.result', { result: 'COMPLETED' })], ['Lalu pembayaran Rp77.000 dibacakan', F('pay.spoken', { amount: 77000 })],
    ],
    async run(c) { c.pay(); await c.wait(F('ad.start'), 30000); await c.sleep(1500); c.pay(77000); await c.wait(F('pay.spoken', { amount: 77000 }), 30000); await c.sleep(1500); },
  },
  {
    id: 'bayar-saat-muat', group: 1, title: 'Pembayaran masuk saat iklan masih dimuat',
    rule: 'Pembayaran ketika buffering didahulukan. Iklan tidak mulai sebelum antrean bersih dan jeda 0,5 detik terpenuhi kembali. Setelah audio benar-benar mulai, pembayaran baru menunggu iklan selesai.',
    setup: { load: 'slow' },
    steps: ['Pilih Streaming audio iklan: <b>Lambat (±3 dtk)</b>.', 'Kirim 1 pembayaran, lalu kirim lagi selagi iklan dimuat.', 'Pembayaran kedua dibacakan dulu, baru iklan berbunyi.'],
    expect: () => [
      ['Iklan mulai dimuat', F('ad.loading')], ['Pembayaran baru masuk → iklan ditahan', F('ad.held')],
      ['Pembayaran Rp88.000 dibacakan lebih dulu', F('pay.spoken', { amount: 88000 })], ['Jeda 0,5 detik terpenuhi lagi', F('quiet.done')],
      ['Baru kemudian iklan berbunyi', F('ad.start')],
    ],
    async run(c) { c.pay(); await c.wait(F('ad.loading'), 20000); await c.sleep(600); c.pay(88000); await c.wait(F('ad.result'), 50000); },
  },
  // ------------------------------------------------------------------ Gangguan
  {
    id: 'telepon', group: 2, title: 'Telepon masuk saat iklan berbunyi',
    rule: 'Iklan yang terputus oleh telepon dihentikan, tidak dilanjutkan atau diulang otomatis, dan tidak dihitung selesai. Transaksi sukses selama telepon aktif tidak dibacakan dan tidak diantrekan; transaksinya tetap sah.',
    steps: ['Kirim 1 pembayaran, tunggu iklan berbunyi.', 'Nyalakan <b>Sedang telepon</b>: iklan berhenti.', 'Kirim pembayaran selama telepon: tidak dibacakan.', 'Matikan telepon: iklan tidak diulang.'],
    expect: () => [
      ['Iklan berbunyi', F('ad.start')], ['Telepon → iklan berhenti, dicatat Terputus', F('ad.result', { result: 'INTERRUPTED', reason: 'CALL' })],
      ['Pembayaran selama telepon tidak dibacakan', F('pay.ignored', { why: 'call' })], ['Telepon selesai', F('call.end')],
    ],
    forbid: () => [['Iklan diulang setelah telepon', after(F('ad.result', { reason: 'CALL' }), F('ad.start'))]],
    async run(c) {
      c.pay(); await c.wait(F('ad.start'), 30000); await c.sleep(1800);
      c.app.setCall(true); await c.wait(F('ad.result'), 5000); await c.sleep(900);
      c.pay(30000); await c.wait(F('pay.ignored'), 5000); await c.sleep(1200);
      c.app.setCall(false); await c.sleep(2500);
    },
  },
  {
    id: 'internet', group: 2, title: 'Internet putus saat iklan berbunyi',
    rule: 'Jika koneksi terputus di tengah pemutaran, iklan terinterupsi dan tidak diulang. Jika konfirmasi gagal dikirim, aplikasi mencoba lagi; selama belum diterima server, pemutaran belum tercatat di Log.',
    steps: ['Kirim 1 pembayaran, tunggu iklan berbunyi.', 'Matikan <b>Internet tersambung</b>.', 'Nyalakan lagi: konfirmasi Terputus terkirim.'],
    expect: () => [
      ['Iklan berbunyi', F('ad.start')], ['Koneksi putus → iklan Terputus', F('ad.result', { result: 'INTERRUPTED', reason: 'NETWORK_LOST' })],
      ['Konfirmasi gagal terkirim, disimpan untuk dicoba lagi', F('report.retry')], ['Internet tersambung lagi', F('net.on')],
      ['Konfirmasi terkirim dan tercatat di Log', F('report.sent', { result: 'INTERRUPTED' })],
    ],
    async run(c) { c.pay(); await c.wait(F('ad.start'), 30000); await c.sleep(1800); c.app.setOnline(false); await c.wait(F('report.retry'), 8000); await c.sleep(2500); c.app.setOnline(true); await c.wait(F('report.sent'), 10000); },
  },
  {
    id: 'startup', group: 2, title: 'Audio iklan tidak mulai dalam 30 detik',
    rule: 'Timeout startup 30 detik berlaku sejak permintaan streaming sampai audio mulai. Setelah 30 detik, kesempatan iklan dibatalkan dan dicatat Gagal dimulai.',
    setup: { load: 'never' },
    steps: ['Pilih Streaming audio iklan: <b>Tidak bisa dimuat</b>.', 'Kirim 1 pembayaran.', 'Tunggu 30 detik, atau klik <b>+30 dtk</b> di atas.'],
    expect: () => [['Iklan mulai dimuat', F('ad.loading')], ['Setelah 30 detik: Gagal dimulai', F('ad.result', { result: 'FAILED_TO_START', reason: 'STARTUP_TIMEOUT' })], ['Hasil tercatat di Log', F('report.sent')]],
    forbid: () => [['Iklan berbunyi', F('ad.start')]],
    async run(c) { c.pay(); await c.wait(F('ad.loading'), 20000); await c.sleep(2000); c.note('Majukan waktu 30 detik (sama seperti tombol +30 dtk).'); c.advance(30e3); await c.wait(F('report.sent'), 10000); },
  },
  {
    id: 'macet', group: 2, title: 'Streaming macet saat iklan berbunyi',
    rule: 'Jika audio berhenti karena buffering tanpa kemajuan selama 30 detik berturut-turut, pemutaran dihentikan dan dicatat Terputus, tanpa replay. Jika audio maju lagi sebelum 30 detik, hitungan di-reset.',
    setup: { load: 'stall' },
    steps: ['Pilih Streaming audio iklan: <b>Macet di tengah</b>.', 'Kirim 1 pembayaran. Iklan berbunyi 2 detik lalu macet.', 'Tunggu 30 detik atau klik <b>+30 dtk</b>.'],
    expect: () => [['Iklan berbunyi', F('ad.start')], ['Macet 30 detik → Terputus', F('ad.result', { result: 'INTERRUPTED', reason: 'STALL_TIMEOUT' })], ['Hasil tercatat di Log', F('report.sent')]],
    async run(c) { c.pay(); await c.wait(F('ad.start'), 30000); await c.sleep(3200); c.note('Majukan waktu 30 detik.'); c.advance(30e3); await c.wait(F('report.sent'), 10000); },
  },
  {
    id: 'ios', group: 2, title: 'iOS: aplikasi di background',
    rule: 'iOS memakai baseline foreground; di background atau saat aplikasi ditutup, iklan tidak dijanjikan. Iklan tidak dihitung tayang dan tidak diputar belakangan tanpa pemicu baru.',
    setup: { platform: 'ios' },
    steps: ['Pilih Platform <b>iOS</b>, matikan <b>Aplikasi di layar depan</b>.', 'Kirim 1 pembayaran: suara pembayaran tetap, iklan tidak diminta.', 'Kembalikan ke layar depan: iklan tidak diputar belakangan.'],
    expect: () => [['Suara pembayaran tetap dibacakan', F('pay.spoken')], ['Iklan tidak diminta karena aplikasi di background', F('ad.skip')]],
    forbid: () => [['Iklan diminta atau diputar belakangan', F('ad.request')]],
    async run(c) { c.app.setForeground(false); await c.sleep(500); c.pay(); await c.wait(F('ad.skip'), 15000); await c.sleep(1200); c.app.setForeground(true); await c.sleep(2500); },
  },
  {
    id: 'ditutup', group: 2, title: 'Aplikasi ditutup, lalu dibuka lagi',
    rule: 'Setiap transaksi sukses unik menghasilkan satu suara pembayaran. Satu kelompok antrean menghasilkan paling banyak satu kesempatan iklan.',
    steps: ['Klik <b>Tutup paksa aplikasi</b>.', 'Kirim 2 pembayaran (tertahan di Firebase).', 'Klik <b>Buka aplikasi</b>: keduanya dibacakan, lalu maksimal satu iklan.'],
    expect: () => [['Aplikasi ditutup', F('app.killed')], ['Aplikasi dibuka lagi', F('app.opened')], ['Pembayaran ke-1 dibacakan', nth('pay.spoken', 1)], ['Pembayaran ke-2 dibacakan', nth('pay.spoken', 2)], ['Satu kesempatan iklan', F('ad.request')]],
    forbid: () => [['Kesempatan iklan kedua', nth('ad.request', 2)]],
    async run(c) { c.app.kill(); await c.sleep(900); c.pay(20000); await c.sleep(400); c.pay(35000); await c.sleep(1800); await c.app.revive(); await c.wait(F('ad.result'), 45000); await c.sleep(600); },
  },
  // ------------------------------------------------------------------ Dashboard & kelayakan
  {
    id: 'pause-muat', group: 3, title: 'Admin pause saat iklan sedang dimuat',
    rule: 'Kandidat yang sudah dipilih tetapi belum mulai wajib memeriksa status kembali. Jika Pause terjadi sebelum audio mulai, audio tidak dimulai.',
    setup: { load: 'slow' },
    steps: ['Pilih Streaming audio iklan: <b>Lambat (±3 dtk)</b>. Kirim 1 pembayaran.', 'Selagi iklan dimuat, buka Dashboard Admin → detail campaign tersebut → Pause.', 'Cek ulang menolak; iklan tidak berbunyi.'],
    expect: () => [['Server memilih campaign', F('srv.reserved')], ['Admin mem-pause campaign itu', F('admin.pause')], ['Cek ulang sebelum audio mulai menolak', F('srv.gate', { go: false })], ['Dicatat Gagal dimulai (campaign di-pause)', F('ad.result', { result: 'FAILED_TO_START', reason: 'CAMPAIGN_PAUSED' })]],
    forbid: () => [['Iklan tetap berbunyi', F('ad.start')]],
    async run(c) { c.pay(); const r = await c.wait(F('srv.reserved'), 20000); await c.sleep(700); c.admin.pause(r.campaignId, 'Uji: pause sebelum audio mulai'); await c.wait(F('ad.result'), 20000); c.cleanup.push(() => c.admin.resume(r.campaignId)); },
  },
  {
    id: 'pause-bunyi', group: 3, title: 'Admin pause saat iklan berbunyi',
    rule: 'Pemutaran yang sudah mulai dibiarkan selesai. Setelah Pause berlaku, campaign tidak dipilih untuk pemutaran baru.',
    steps: ['Kirim 1 pembayaran, tunggu iklan berbunyi.', 'Pause campaign itu dari Dashboard Admin.', 'Iklan tetap selesai. Klik <b>+1 mnt</b>, kirim pembayaran: campaign lain yang berbunyi.'],
    expect: () => { let paused = null; return [
      ['Iklan berbunyi', (f) => F('ad.start')(f) && (paused = f.campaignId, true)], ['Admin mem-pause campaign itu', F('admin.pause')],
      ['Iklan yang sedang berbunyi tetap selesai', F('ad.result', { result: 'COMPLETED' })], ['Pemutaran berikutnya campaign lain', (f) => F('ad.start')(f) && f.campaignId !== paused],
    ]; },
    async run(c) {
      c.pay(); const s = await c.wait(F('ad.start'), 30000); await c.sleep(1500);
      c.admin.pause(s.campaignId, 'Uji: pause saat iklan berbunyi'); c.cleanup.push(() => c.admin.resume(s.campaignId));
      await c.wait(F('ad.result'), 30000); await c.sleep(800); c.advance(MIN); await c.sleep(600); c.pay(42000); await c.wait(F('ad.result'), 45000);
    },
  },
  {
    id: 'mcc', group: 3, title: 'Filter MCC',
    rule: 'Merchant dengan kategori usaha (MCC) yang masuk filter campaign tidak memutar iklan tersebut. Contoh: "Isi Pulsa Hemat" mengecualikan MCC 5912 (Apotek).',
    setup: { account: 'budi' },
    steps: ['Login sebagai <b>Apotek Sehat Selalu</b> (Pengaturan → Keluar → pilih akun).', 'Kirim pembayaran beberapa kali (klik <b>+1 mnt</b> di antaranya).', 'Di panel Alur, server menandai "MCC 5912 dikecualikan" untuk Isi Pulsa Hemat.'],
    expect: () => [['Iklan pertama berbunyi', nth('ad.result', 1, { result: 'COMPLETED' })], ['Iklan kedua berbunyi', nth('ad.result', 2, { result: 'COMPLETED' })]],
    forbid: () => [['"Isi Pulsa Hemat" diputar di Apotek', F('ad.start', { name: (n) => n.startsWith('Isi Pulsa') })]],
    async run(c) { for (let i = 0; i < 2; i++) { c.pay(25000 + i * 1000); await c.wait(F('ad.result'), 45000); await c.sleep(700); c.advance(MIN); await c.sleep(500); } },
  },
  {
    id: 'self', group: 3, title: 'Pengecualian iklan sendiri',
    rule: 'Jika MID pengiklan diisi dan "Tidak mau iklan tampil di aplikasi sendiri" dicentang, merchant milik pengiklan tidak memutar iklannya sendiri. Contoh: Kedai Kopi Senja.',
    setup: { account: 'dion' },
    steps: ['Login sebagai <b>Kedai Kopi Senja</b>.', 'Kirim pembayaran beberapa kali (klik <b>+1 mnt</b> di antaranya).', '"Promo Kopi Senja" tidak pernah berbunyi di HP ini.'],
    expect: () => [['Iklan pertama berbunyi', nth('ad.result', 1, { result: 'COMPLETED' })], ['Iklan kedua berbunyi', nth('ad.result', 2, { result: 'COMPLETED' })]],
    forbid: () => [['"Promo Kopi Senja" diputar di aplikasi pengiklannya sendiri', F('ad.start', { name: (n) => n.startsWith('Promo Kopi') })]],
    async run(c) { for (let i = 0; i < 2; i++) { c.pay(25000 + i * 1000); await c.wait(F('ad.result'), 45000); await c.sleep(700); c.advance(MIN); await c.sleep(500); } },
  },
  {
    id: 'tambah', group: 3, title: 'Tambah iklan perlu persetujuan orang lain',
    rule: 'Simpan Tambah Iklan membentuk request approval; campaign berstatus Menunggu Persetujuan dan tidak diputar. Pembuat request tidak dapat menyetujui request miliknya sendiri. Setelah disetujui, campaign masuk giliran sesuai jadwal WIB.',
    steps: ['Dashboard Admin, masuk sebagai <b>Andi</b> → Tambah Iklan → isi dan Simpan (boleh pakai audio contoh).', 'Buka Approval sebagai Andi: tombol Setujui tidak tersedia.', 'Ganti ke <b>Bella</b> → Setujui.', 'Kirim pembayaran (klik <b>+1 mnt</b> di antaranya) sampai iklan baru berbunyi.'],
    expect: () => [['Iklan baru tersimpan, Menunggu Persetujuan', F('admin.add')], ['Andi tidak bisa menyetujui request sendiri', F('admin.selfBlocked')], ['Bella menyetujui → masuk siklus penayangan', F('admin.decide', { decision: 'approve' })], ['Iklan baru berbunyi di HP', F('ad.start', { name: (n) => n.startsWith('Bengkel Motor') })]],
    async run(c) {
      const camp = c.admin.add({ name: 'Bengkel Motor Jaya – Servis Hemat', advertiserName: 'Bengkel Motor Jaya', advertiserPhone: '081377712345', media: makeSampleAd('a', 5), startAt: c.now() - 60e3, endAt: c.now() + 14 * 864e5, mccExclusions: [] });
      c.showAdmin('approval'); await c.sleep(1500);
      const req = camp.pendingRequestId;
      try { srv.decide(req, 'andi', 'approve'); } catch (e) { c.note(`Andi mencoba menyetujui: "${e.message}"`); }
      await c.sleep(1500); srv.decide(req, 'bella', 'approve'); c.showAdmin('list'); await c.sleep(1000);
      for (let i = 0; i < 5; i++) {
        c.pay(21000 + i * 1000); const s = await c.wait(F('ad.start'), 30000); await c.wait(F('ad.result'), 45000);
        if (s.name.startsWith('Bengkel Motor')) break;
        await c.sleep(600); c.advance(MIN); await c.sleep(500);
      }
    },
  },
  {
    id: 'edit', group: 3, title: 'Edit iklan: pause dulu, lalu persetujuan',
    rule: 'Campaign Sedang Tayang harus di-Pause sebelum diedit. Perubahan tersimpan sebagai usulan; data aktif belum berubah dan statusnya Menunggu Persetujuan. Setelah disetujui, status Paused dipertahankan dan perubahan berlaku pada pemutaran berikutnya.',
    steps: ['Buka detail "Asuransi Mikro Rp5.000": Edit belum tersedia.', 'Pause (isi alasan), lalu Edit nama campaign → Ajukan perubahan.', 'Ganti ke <b>Bella</b> → Approval → Setujui. Status tetap Paused.', 'Resume campaign.'],
    expect: () => [['Edit ditolak selama Sedang Tayang', F('admin.editBlocked')], ['Campaign di-pause', F('admin.pause')], ['Perubahan diajukan → Menunggu Persetujuan', F('admin.edit')], ['Disetujui, status tetap Paused', F('admin.decide', { status: 'PAUSED' })], ['Campaign di-resume', F('admin.resume')]],
    async run(c) {
      const camp = srv.campaignByName('Asuransi Mikro');
      c.showAdmin('detail', camp.id); await c.sleep(1000);
      try { srv.editCampaign(camp.id, { name: camp.name }, 'andi'); } catch (e) { c.note(`Edit saat Sedang Tayang: "${e.message}"`); }
      await c.sleep(1200); c.admin.pause(camp.id, 'Perbaikan nama campaign'); await c.sleep(1200);
      const nm = camp.name.includes('(revisi)') ? camp.name.replace(' (revisi)', '') : `${camp.name} (revisi)`;
      srv.editCampaign(camp.id, { name: nm, startAt: camp.startAt, endAt: camp.endAt, advertiserMid: camp.advertiserMid, excludeSelf: camp.excludeSelf, mccExclusions: camp.mccExclusions, excludeSelfConfirmed: true }, 'andi');
      c.showAdmin('detail', camp.id); await c.sleep(1500);
      srv.decide(camp.pendingRequestId, 'bella', 'approve'); await c.sleep(1500);
      c.admin.resume(camp.id); c.showAdmin('detail', camp.id); await c.sleep(800);
    },
  },
  // ------------------------------------------------------------------ Akun & persetujuan
  {
    id: 'consent', group: 4, title: 'Aktifkan suara: persetujuan S&K',
    rule: 'Halaman persetujuan tampil penuh (bukan popup) saat merchant mengaktifkan suara. Centang hanya bisa setelah S&K di-scroll sampai bawah; tombol Setuju aktif selama dicentang. Persetujuan disimpan setelah menekan Setuju, per akun beserta waktu dan versi naskah.',
    setup: { consent: 'none', sound: false },
    steps: ['Di HP buka <b>Pengaturan</b>, nyalakan <b>Notifikasi suara</b>.', 'Scroll S&K sampai bawah, centang, tekan <b>Setuju</b>.'],
    expect: () => [['Halaman persetujuan tampil penuh', F('consent.shown')], ['Persetujuan tersimpan di server', F('consent.saved')], ['Notifikasi suara ON', F('sound.on')]],
    async run(c) { c.app.goPage('pengaturan'); await c.sleep(900); c.app.setSound(true); await c.sleep(1200); await c.ui.scrollAndCheck(); await c.sleep(800); c.app.agreeConsent(); await c.wait(F('sound.on'), 8000); },
  },
  {
    id: 'consent-tolak', group: 4, title: 'Menolak persetujuan',
    rule: 'Tolak, tombol kembali, atau Back perangkat menutup halaman persetujuan, membatalkan aktivasi, dan suara tetap OFF. Merchant tetap bisa memakai fungsi lain aplikasi.',
    setup: { consent: 'none', sound: false },
    steps: ['Pengaturan → nyalakan Notifikasi suara.', 'Tekan <b>Tolak</b> atau panah kembali.'],
    expect: () => [['Halaman persetujuan tampil', F('consent.shown')], ['Ditolak → suara OFF', F('consent.rejected')]],
    forbid: () => [['Persetujuan tersimpan', F('consent.saved')], ['Suara menyala', F('sound.on')]],
    async run(c) { c.app.goPage('pengaturan'); await c.sleep(900); c.app.setSound(true); await c.sleep(2200); c.app.rejectConsent(); await c.sleep(1500); },
  },
  {
    id: 'consent-gagal', group: 4, title: 'Persetujuan gagal tersimpan',
    rule: 'Jika penyimpanan gagal, suara tetap OFF dan tampil "Persetujuan belum tersimpan. Silakan coba lagi." Data yang gagal tersimpan tidak dianggap persetujuan.',
    setup: { consent: 'none', sound: false, consentSave: 'failOnce' },
    steps: ['Pilih Simpan persetujuan: <b>Gagal sekali, lalu berhasil</b>.', 'Aktifkan suara, scroll, centang, Setuju: muncul pesan gagal.', 'Tekan Setuju lagi: berhasil.'],
    expect: () => [['Halaman persetujuan tampil', F('consent.shown')], ['Gagal simpan → pesan coba lagi, suara tetap OFF', F('consent.failed')], ['Coba lagi berhasil', F('consent.saved')], ['Notifikasi suara ON', F('sound.on')]],
    async run(c) { c.app.goPage('pengaturan'); await c.sleep(800); c.app.setSound(true); await c.sleep(1000); await c.ui.scrollAndCheck(); await c.sleep(600); c.app.agreeConsent(); await c.wait(F('consent.failed'), 6000); await c.sleep(2000); c.app.agreeConsent(); await c.wait(F('sound.on'), 6000); },
  },
  {
    id: 'sk-baru', group: 4, title: 'Naskah S&K diperbarui',
    rule: 'Setiap perubahan naskah memerlukan persetujuan ulang. Sistem yang menemukan suara ON tanpa persetujuan berlaku membuka halaman persetujuan.',
    steps: ['Buka tab <b>Parameter</b> → <b>Terbitkan naskah S&K baru</b>.', 'HP menampilkan halaman persetujuan (tunggu sebentar atau klik +10 dtk).', 'Scroll, centang, Setuju.'],
    expect: () => [['Naskah versi baru terbit', F('admin.tnc')], ['HP meminta persetujuan ulang', F('consent.shown')], ['Persetujuan versi baru tersimpan', F('consent.saved')]],
    async run(c) { srv.publishTnc('andi'); c.refreshParams(); await c.sleep(800); await c.app.sendHeartbeat(); await c.wait(F('consent.shown'), 8000); await c.sleep(1200); await c.ui.scrollAndCheck(); await c.sleep(700); c.app.agreeConsent(); await c.wait(F('consent.saved'), 6000); },
  },
  {
    id: 'akun', group: 4, title: 'Ganti akun di HP yang sama',
    rule: 'Persetujuan dicatat per akun. Saat berganti akun, sesi akun lama dinonaktifkan sebelum sesi akun baru dicatat, dan engine tidak memilih iklan untuk MID sebelumnya.',
    steps: ['Pengaturan → Keluar → login sebagai <b>Toko Kelontong Makmur</b>.', 'Lihat panel Alur: sesi lama diakhiri, sesi baru tercatat.', 'Aktifkan suara: akun ini tetap diminta persetujuan sendiri.'],
    expect: () => [['Login akun kedua, sesi baru tercatat', F('login', { userId: 'lina' })], ['Akun kedua diminta persetujuan sendiri', F('consent.shown')]],
    forbid: () => [['Pembayaran akun lama masih dibacakan di HP', after(F('login', { userId: 'lina' }), F('pay.queued'))]],
    async run(c) {
      srv.revokeConsentForDemo('lina');
      await c.app.login('lina'); await c.sleep(1200);
      c.note('Backend mengirim transaksi untuk Mini Clo (akun lama).');
      srv.simulateTransaction(srv.accountOf('sari').mid, 50000); await c.sleep(1800);
      c.app.goPage('pengaturan'); await c.sleep(600); c.app.setSound(true); await c.wait(F('consent.shown'), 5000); await c.sleep(1500); c.app.rejectConsent(); await c.sleep(800);
    },
  },
  {
    id: 'lokasi', group: 4, title: 'Izin lokasi ditolak',
    rule: 'Penolakan lokasi tidak membatalkan persetujuan dan tidak menonaktifkan suara pembayaran maupun iklan. Izin diminta ulang saat merchant mengaktifkan notifikasi suara, paling cepat 3 hari setelah permintaan terakhir.',
    setup: { location: 'belum' },
    steps: ['Buka Dasbor: popup izin lokasi muncul → <b>Jangan izinkan</b>.', 'Kirim pembayaran: suara dan iklan tetap berjalan.', 'Klik <b>+1 hari</b> tiga kali, lalu matikan dan nyalakan lagi Notifikasi suara: popup lokasi muncul lagi.'],
    expect: () => [['Popup izin lokasi muncul di Dasbor', F('location.prompt')], ['Izin ditolak', F('location.denied')], ['Pembayaran tetap dibacakan', F('pay.spoken')], ['Iklan tetap berbunyi', F('ad.start')], ['Setelah 3 hari, saat suara diaktifkan: diminta ulang', nth('location.prompt', 2)]],
    async run(c) {
      c.app.goPage('dasbor'); await c.wait(F('location.prompt'), 5000); await c.sleep(1500); c.app.answerLocation('denied'); await c.sleep(800);
      c.pay(); await c.wait(F('ad.result'), 45000); await c.sleep(800);
      c.note('Majukan waktu 3 hari.'); c.advance(3 * 864e5); await c.sleep(800);
      c.app.goPage('pengaturan'); c.app.setSound(false); await c.sleep(800); c.app.setSound(true); await c.wait(F('location.prompt'), 5000); await c.sleep(1500); c.app.answerLocation('while'); await c.sleep(500);
    },
  },
];
