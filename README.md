# SoundApps Iklan — Web Demo (Fase 1)

Web demo untuk alur **suara pembayaran → jeda 0,5 detik → iklan** sesuai PRD SoundApps Iklan Fase 1. Isinya **hanya aturan yang tertulis di PRD**.

- Semua berjalan di browser: backend dan Firebase disimulasikan, tanpa server.
- Tampilan mengikuti design system Paydia Linkage (warna brand, font Sora).

## Cara membuka

- **Langsung**: buka `dist/standalone.html` di Chrome/Edge. Nyalakan suara perangkat.
- **Ubah kode lalu build ulang**:
  ```bash
  npm install
  npm run build      # menghasilkan dist/index.html dan dist/standalone.html
  ```

## Cara memakai

1. Klik **Mulai demo**.
2. **Panduan** (kiri): pilih skenario. Klik **Jalankan otomatis** untuk melihat demonya, atau **Coba sendiri** lalu ikuti langkahnya. Checklist *Yang harus terjadi* tercentang sendiri saat kejadiannya terjadi.
3. **HP merchant** (tengah): Dasbor, QR Statis, Pengaturan, halaman persetujuan S&K, dan popup izin lokasi. Di bawahnya ada **Panel simulasi** (kirim transaksi, telepon, internet, platform, streaming lambat/macet, tutup aplikasi) dan **Di dalam aplikasi** (antrean, jeda, timer).
4. **Alur** (kanan): cerita langkah demi langkah antara HP, Firebase, dan Server, termasuk daftar pemeriksaan yang dilakukan server sebelum memilih iklan.
5. **Dashboard Admin**: Manajemen Iklan (tambah, edit, pause, resume, detail), Approval (Tambah/Ubah Iklan, maker ≠ checker), Log (Pemutaran Iklan & Setting Iklan), serta hak akses per akun admin.
6. **Majukan waktu** (+10 dtk, +30 dtk, +1 mnt, +1 hari) supaya tidak perlu menunggu interval 1 menit atau timeout 30 detik. Nilai parameter PRD tidak diubah.

## Aturan PRD yang diterapkan

| Area | Aturan |
|---|---|
| Antrean | Tiap transaksi sukses unik → satu suara, serial. Event duplikat diabaikan. Pending/gagal tidak dibacakan. |
| Pemicu iklan | Antrean kosong + 0,5 dtk tanpa pembayaran baru. Satu kelompok antrean → maksimal satu kesempatan iklan. |
| Kelayakan (server) | Sesi aktif & MID cocok, consent versi terbaru, transaksi pemicu valid & belum dipakai, interval 1 menit per perangkat, campaign Sedang Tayang (disetujui, dalam jadwal WIB, tidak paused, tanpa request berjalan), filter MCC, pengecualian sendiri. |
| Kelayakan (HP) | Suara ON, koneksi, tidak sedang telepon, iOS harus foreground. |
| Rotasi | Urut waktu submit Tambah Iklan; yang tidak eligible dilewati; kembali ke awal. |
| Cek ulang | Tepat sebelum audio mulai: sesi, consent, status campaign (Pause langsung berlaku). |
| Pembayaran vs iklan | Saat iklan dimuat → pembayaran didahulukan, iklan menunggu antrean bersih + 0,5 dtk lagi. Saat iklan berbunyi → pembayaran menunggu iklan selesai. |
| Gangguan | Telepon / koneksi putus / macet 30 dtk → Terputus, tidak diulang. Startup > 30 dtk → Gagal dimulai. Penundaan karena pembayaran tidak dihitung sebagai startup. |
| Konfirmasi | Dikirim setelah audio selesai; retry saat gagal; idempoten per ID pemutaran; baru tercatat di Log setelah diterima server. |
| Dashboard | Status dihitung dari jadwal WIB; Selesai mengalahkan Paused; Edit butuh Pause saat Sedang Tayang; request Tambah/Ubah butuh approver lain; alasan pause wajib (≤255); audit log tidak dapat diedit. |
| Consent & lokasi | Halaman penuh, centang setelah scroll, per akun + versi naskah, pesan gagal simpan, persetujuan ulang saat naskah berubah. Penolakan lokasi tidak mengganggu suara/iklan; diminta ulang saat aktivasi suara, minimal 3 hari. |

## Perilaku yang belum diatur PRD (asumsi demo)

Asumsi berikut dipakai demo. Untuk suara yang dimatikan saat iklan berbunyi, panel Alur juga menandainya "(Belum diatur PRD)".

- Suara dimatikan atau ganti akun **saat iklan sedang berbunyi** → demo menghentikan iklan (Terputus).
- **Gagal dimulai** tidak memulai hitungan interval (PRD hanya menyebut "selesai atau terinterupsi").
- Ada dua pernyataan PRD yang bertentangan soal edit campaign **Selesai**. Demo mengikuti bagian *Edit campaign* (Selesai boleh diedit untuk perpanjangan).
- Batas sesi tidak aktif: 15 menit. PRD menyebut batas ini tetapi belum menetapkan nilainya.

## Menghubungkan ke backend rekan

Semua panggilan HP ke backend ada di `src/device.js` lewat fungsi `api(...)`, yang memanggil `src/server.js`. Untuk integrasi, ganti `server.js` dengan adapter HTTP + listener Firebase sungguhan.

| Fungsi demo | Peran | Perlu dari backend rekan |
|---|---|---|
| `login / logout / heartbeat` | Sesi merchant aktif per perangkat | endpoint sesi |
| `consentStatus / saveConsent / getTnc` | Persetujuan S&K per akun & versi | endpoint consent + naskah |
| `registerDevice` + `onFirebaseEvent` | Menerima event pembayaran | path/topic Firebase + format payload |
| `requestOpportunity` | Minta 1 kesempatan iklan | endpoint pilih iklan (atau model push) |
| `gate` | Cek ulang sebelum audio mulai | endpoint cek ulang |
| `reportResult` | Kirim hasil Selesai/Gagal dimulai/Terputus | endpoint konfirmasi |
| `reportLocation` | Kirim lokasi sesuai izin | endpoint lokasi |

Payload event pembayaran di demo: `{ eventId, txId, mid, amount, status: 'SUKSES'|'PENDING'|'GAGAL', txTime }`.

## Struktur

```
src/core.js       jam demo, bus narasi & kejadian, format
src/server.js     backend tiruan: engine, admin, consent, sesi, Firebase sim
src/device.js     aplikasi merchant: antrean suara, iklan, consent, lokasi, gangguan
src/phone-ui.js   tampilan HP + panel simulasi
src/admin-ui.js   Dashboard Admin
src/flow-ui.js    panel Alur
src/scenarios.js  26 skenario panduan
src/guide.js      runner skenario + checklist
test/             uji otomatis (Playwright): run-scenarios.mjs, ui-manual.mjs
```
