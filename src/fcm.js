// =============================================================================
// FCM Web: HP simulasi mendaftar sebagai klien FCM, backend mengirim data message ke token ini.
// Hanya memakai nilai publik (web config + VAPID key). Jangan taruh service account di sini.
// =============================================================================
import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyB4JcaEA6sih5m830_pQ8hMRdkBFDTEhCk',
  authDomain: 'paydia-merchant-7e98a.firebaseapp.com',
  databaseURL: 'https://paydia-merchant-7e98a-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'paydia-merchant-7e98a',
  storageBucket: 'paydia-merchant-7e98a.firebasestorage.app',
  messagingSenderId: '1065569343891',
  appId: '1:1065569343891:web:643f28751086e60cb83066',
};

export const VAPID_KEY = 'BM02iuKzt3sBYEXkjAV2_LtB1Bw7AiNK42TlKCOUJEy1Q-An5oXrIKFyf-YMngYZyosLqs2XptvktP2sQqKZzio'; // kunci publik
export const fcm = { status: 'off', token: '', error: '', vapid: VAPID_KEY, log: [] };
try { fcm.vapid = localStorage.getItem('fcm.vapid') || VAPID_KEY; } catch { /* */ }
const listeners = new Set();
export const onFcmChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const set = (patch) => { Object.assign(fcm, patch); listeners.forEach((f) => f()); };

// Data message FCM selalu bertipe string → ubah ke bentuk event yang dipakai aplikasi.
// Format backend: { topic: 'transaction', refid, title, body, amount }. refid = ID transaksi; pesan
// topic 'transaction' berarti pembayaran sudah diterima, jadi status default SUKSES.
export function toEvent(d = {}) {
  if (d.topic && d.topic !== 'transaction') return null;
  const txId = d.txId || d.refid;
  return { eventId: txId, txId, mid: d.mid, amount: Number(d.amount), status: String(d.status || 'SUKSES').toUpperCase(), txTime: Date.now() };
}

let started = false;
// Log pesan FCM yang masuk (terbaru di atas, maks 50).
export function addFcmLog(entry) { fcm.log.unshift({ at: Date.now(), ...entry }); fcm.log.length = Math.min(fcm.log.length, 50); set({}); }
export function clearFcmLog() { fcm.log = []; set({}); }

export async function enableFcm(vapidKey, deliver) {
  if (!vapidKey) return set({ status: 'error', error: 'VAPID key belum diisi.' });
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return set({ status: 'error', error: 'Browser ini tidak mendukung web push. Buka lewat https (bukan file://).' });
  set({ status: 'connecting', error: '', vapid: vapidKey });
  try { localStorage.setItem('fcm.vapid', vapidKey); } catch { /* */ }
  try {
    if ((await Notification.requestPermission()) !== 'granted') return set({ status: 'error', error: 'Izin notifikasi ditolak. Izinkan di pengaturan situs lalu coba lagi.' });
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    await navigator.serviceWorker.ready;
    const messaging = getMessaging(initializeApp(FIREBASE_CONFIG));
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: reg });
    if (!token) return set({ status: 'error', error: 'Token tidak diterima dari FCM.' });
    if (!started) {
      started = true;
      onMessage(messaging, (p) => deliver(toEvent(p.data), p.data, 'tab aktif')); // tab sedang aktif
      navigator.serviceWorker.addEventListener('message', (m) => { if (m.data?.type === 'fcm-data') deliver(toEvent(m.data.data), m.data.data, 'latar belakang'); }); // tab di latar
    }
    set({ status: 'on', token });
  } catch (e) { set({ status: 'error', error: e.message || String(e) }); }
}
