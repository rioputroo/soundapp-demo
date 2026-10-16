// Service worker FCM: meneruskan data message ke tab demo yang terbuka.
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey: 'AIzaSyB4JcaEA6sih5m830_pQ8hMRdkBFDTEhCk',
  projectId: 'paydia-merchant-7e98a',
  messagingSenderId: '1065569343891',
  appId: '1:1065569343891:web:643f28751086e60cb83066',
});
firebase.messaging().onBackgroundMessage(async (payload) => {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  list.forEach((c) => c.postMessage({ type: 'fcm-data', data: payload.data }));
});
