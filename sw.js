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

/* Show our own (data-only) alerts directly from the push event. Firebase's SDK hands a message to an open
   page instead of calling onBackgroundMessage whenever it thinks a window is visible, and on iPhone a
   suspended Home Screen app still counts as visible: the page is frozen, nothing is shown, and the alert is
   lost. iOS also requires every push to show a notification. This listener is registered first and always
   shows one (same tag as the page's own display, so nothing doubles). */
function tpPushPayload(event) {
  try { return event.data ? event.data.json() : null; } catch (e) { return null; }
}
self.addEventListener('push', (event) => {
  const payload = tpPushPayload(event);
  const d = payload && payload.data;
  if (!d || !d.title || payload.notification) return; // not ours: Firebase handles those
  event.waitUntil(self.registration.showNotification(String(d.title), {
    body: String(d.body || ''),
    icon: d.icon || './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: d,
    tag: d.tag || 'taskplus',
    renotify: true,
  }));
});

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
  if (payload.data && payload.data.title && !payload.notification) return; // already shown by the push listener above
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
          // The alert means the server found changes: tell the open app to import them now.
          client.postMessage({ type: 'tp-notification-click' });
          return client.focus();
        }
      }
      // '#sync' makes a freshly opened app import right away (a hash is never sent to the network, so the cached page still matches).
      if (clients.openWindow) return clients.openWindow(url.includes('#') ? url : url + '#sync');
    })
  );
});

/* ---- App shell cache (offline support) ---- */

const CACHE_NAME = 'taskplus-cache-v97'; // bumped: record how long it took; estimates learn from it
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './css/tokens.css',
  './css/mobile.css',
  './css/animations.css',
  './js/utils.js',
  './js/due-time.js',
  './js/item-logic.js',
  './js/courses.js',
  './js/moodle-client.js',
  './js/estimate-logic.js',
  './js/learning.js',
  './js/plan-logic.js',
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
  './js/views/connect-sheet-html.js',
  './js/views/item-detail-html.js',
  './js/views/changes-html.js',
  './js/views/quick-menu-html.js',
  './js/views/time-sheet-html.js',
  './js/today-logic.js',
  './js/gestures.js',
  './js/bind-events.js',
  './js/boot.js',
  './js/app.js',
  './firebase-sync.js',
  './js/fcm-config.js',
  './manifest.json',
  './js/icons.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon.ico'
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
  // The app's own API (/api/...) always goes to the network. This handler used to cache GETs and answer from
  // the cache first, so /api/moodle/status and the What's new feed could be served stale, or fail outright
  // (Response.error) when there was nothing cached.
  if(new URL(req.url).pathname.startsWith('/api/')) return;

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