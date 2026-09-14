/* sw.js — Unified service worker: offline app-shell cache + Firebase Cloud
   Messaging background handler.

   These two jobs USED to live in separate files (sw.js + firebase-messaging-sw.js),
   registered separately. A browser origin can only have one active service
   worker per scope, and both were being registered at the root scope ("/"),
   so the second registration fought with the first instead of running
   alongside it — background push could get stuck "waiting" and never
   activate. Merging them into one file/one registration removes that
   conflict. See FCM-SETUP.md.
*/

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyB9Xyx3JioVqjvOfWvWvhJUAZV4lCWfjuQ',
  authDomain: 'planner-88ab8.firebaseapp.com',
  projectId: 'planner-88ab8',
  storageBucket: 'planner-88ab8.firebasestorage.app',
  messagingSenderId: '387783207136',
  appId: '1:387783207136:web:c127dfc6250d40a6abc885',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = (payload.data && payload.data.title) || (payload.notification && payload.notification.title) || 'Taskplus';
  const body =
    (payload.data && payload.data.body) ||
    (payload.notification && payload.notification.body) ||
    'You have assignments to review.';
  const options = {
    body,
    icon: (payload.data && payload.data.icon) || './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: payload.data || {},
    tag: (payload.data && payload.data.tag) || 'taskplus-digest',
    renotify: true,
  };
  return self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

/* ---- App shell cache (offline support) ---- */

const CACHE_NAME = 'taskplus-cache-v19'; // bumped: iOS fixes, self-hosted icon font
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './css/tokens.css',
  './css/mobile.css',
  './css/animations.css',
  './js/utils.js',
  './js/item-logic.js',
  './js/courses.js',
  './js/all-logic.js',
  './js/week-logic.js',
  './js/html.js',
  './js/toast.js',
  './js/theme.js',
  './js/notify.js',
  './js/io.js',
  './js/views/today-html.js',
  './js/views/chrome-html.js',
  './js/views/tabbar-html.js',
  './js/views/all-html.js',
  './js/views/week-html.js',
  './js/views/settings-html.js',
  './js/views/courses-html.js',
  './js/views/add-sheet-html.js',
  './js/views/quick-menu-html.js',
  './js/today-logic.js',
  './js/bind-events.js',
  './js/boot.js',
  './js/app.js',
  './firebase-sync.js',
  './js/fcm-config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon.ico',
  './icons/nerd-fonts-subset.woff2'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Cache each URL independently so one missing/broken asset (e.g. a
      // not-yet-added icon file) can't fail the whole install and silently
      // leave the app with zero offline support. cache.addAll() is
      // all-or-nothing; this isn't.
      Promise.all(
        urlsToCache.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[sw] failed to precache', url, err);
          })
        )
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if(req.method !== 'GET') return;
  if(new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      const networkFetch = fetch(req).then((response) => {
        cache.put(req, response.clone());
        return response;
      }).catch(() => null);
      return cached || (await networkFetch) || Response.error();
    })
  );
});