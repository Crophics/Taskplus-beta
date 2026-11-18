const { test } = require('node:test');
const assert = require('node:assert');
global.window = global;
require('../js/gestures.js');
const G = global.TPGestures;
const g = (o) => ({ dx: 0, dy: 0, dt: 200, startX: 200, startScrollTop: 0, ...o });

test('a clear left or right swipe moves between tabs', () => {
  assert.strictEqual(G.classifySwipe(g({ dx: -120, dy: 10 })), 'next');
  assert.strictEqual(G.classifySwipe(g({ dx: 120, dy: -10 })), 'prev');
});

test('a swipe right that starts at the left edge is back', () => {
  assert.strictEqual(G.classifySwipe(g({ dx: 100, dy: 5, startX: 8 })), 'back');
});

test('short, slow or mostly vertical movements are not swipes (so scrolling is safe)', () => {
  assert.strictEqual(G.classifySwipe(g({ dx: -40 })), null);
  assert.strictEqual(G.classifySwipe(g({ dx: -150, dt: 1200 })), null);
  assert.strictEqual(G.classifySwipe(g({ dx: -100, dy: 90 })), null);
});

test('pulling down from the top syncs; pulling down mid-page does not', () => {
  assert.strictEqual(G.classifySwipe(g({ dy: 110, dx: 10 })), 'pull');
  assert.strictEqual(G.classifySwipe(g({ dy: 110, dx: 10, startScrollTop: 300 })), null);
  assert.strictEqual(G.classifySwipe(g({ dy: 50 })), null);
});

test('neighbourTab walks Today, Week, All and stops at the ends', () => {
  assert.strictEqual(G.neighbourTab('today', 'next'), 'week');
  assert.strictEqual(G.neighbourTab('week', 'next'), 'all');
  assert.strictEqual(G.neighbourTab('all', 'next'), null);
  assert.strictEqual(G.neighbourTab('today', 'prev'), null);
  assert.strictEqual(G.neighbourTab('settings', 'next'), null);
});
