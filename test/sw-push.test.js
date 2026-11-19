// The service worker must show a notification for every data-only alert, even when Firebase's own
// routing would hand the message to a (frozen) page instead.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

function loadSw() {
  const handlers = {};
  const shown = [];
  const self = {
    addEventListener: (type, fn) => { (handlers[type] = handlers[type] || []).push(fn); },
    registration: { showNotification: (title, opts) => { shown.push({ title, opts }); return Promise.resolve(); } },
    clients: {},
  };
  const messaging = { onBackgroundMessage: (fn) => { self.bg = fn; } };
  const ctx = { self, importScripts: () => {}, firebase: { initializeApp: () => {}, messaging: () => messaging }, caches: {}, fetch: () => {}, URL, console, Promise };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + '/../sw.js', 'utf8'), ctx);
  return { handlers, shown, self };
}
const pushEvent = (payload) => {
  const waits = [];
  return { data: { json: () => payload }, waitUntil: (p) => waits.push(p), waits };
};

test('a data-only alert is shown straight from the push event', async () => {
  const { handlers, shown } = loadSw();
  const ev = pushEvent({ data: { title: 'Taskplus alerts are on', body: 'This is a test notification.', tag: 'taskplus-test' }, from: '1' });
  handlers.push.forEach((h) => h(ev));
  await Promise.all(ev.waits);
  assert.strictEqual(shown.length, 1);
  assert.strictEqual(shown[0].title, 'Taskplus alerts are on');
  assert.strictEqual(shown[0].opts.tag, 'taskplus-test');
  assert.strictEqual(shown[0].opts.body, 'This is a test notification.');
});

test('notification-type messages and junk are left to Firebase, and Firebase does not show ours twice', async () => {
  const { handlers, shown, self } = loadSw();
  const a = pushEvent({ notification: { title: 'x' }, data: { title: 'x' } });
  const b = pushEvent(null);
  const c = { data: { json: () => { throw new Error('bad'); } }, waitUntil: () => {} };
  handlers.push.forEach((h) => { h(a); h(b); h(c); });
  await Promise.all([...a.waits, ...b.waits]);
  assert.strictEqual(shown.length, 0);
  await self.bg({ data: { title: 'T', body: 'B' } });
  assert.strictEqual(shown.length, 0, 'the background handler skips data-only alerts the push listener already showed');
  await self.bg({ notification: { title: 'N', body: 'B' } });
  assert.strictEqual(shown.length, 1, 'notification-type messages still go through the background handler');
});
