const { test } = require('node:test');
const assert = require('node:assert');
global.window = global;
require('../js/schedule-logic.js');
const S = global.TPSchedule;

test('parses day letters, 24h and am/pm ranges, places', () => {
  let r = S.parseMeets('MWF 10:00-10:50 Room 101');
  assert.deepStrictEqual(r.meetings, [{ days: [1, 3, 5], start: 600, end: 650, where: 'Room 101' }]);
  r = S.parseMeets('TR 1:30-2:45pm');
  assert.deepStrictEqual(r.meetings[0], { days: [2, 4], start: 13 * 60 + 30, end: 14 * 60 + 45, where: '' });
  r = S.parseMeets('MW 9-9:50; F 13:00-14:30 Lab');
  assert.strictEqual(r.meetings.length, 2);
  assert.strictEqual(r.meetings[1].where, 'Lab');
  assert.strictEqual(S.parseMeets('Mon, Wed 11am-12:15pm').meetings[0].start, 660);
  assert.strictEqual(S.parseMeets('11:30am-12:20pm U').ok, false);
});
test('morning range ending in pm keeps a sensible start', () => {
  const m = S.parseMeets('MWF 11-12pm').meetings[0];
  assert.deepStrictEqual([m.start, m.end], [660, 720]);
  const n = S.parseMeets('TR 10:30am-12pm').meetings[0];
  assert.deepStrictEqual([n.start, n.end], [630, 720]);
});
test('unreadable text is reported, never guessed', () => {
  for (const t of ['', 'whenever', 'MWF 10:50-10:00', 'X 10-11', 'MWF 25:00-26:00']) {
    assert.strictEqual(S.parseMeets(t).meetings.length, 0, t);
  }
  assert.strictEqual(S.parseMeets('').ok, true);
  assert.strictEqual(S.parseMeets('whenever').ok, false);
  const mixed = S.parseMeets('MWF 10-10:50; nonsense');
  assert.strictEqual(mixed.meetings.length, 1);
  assert.strictEqual(mixed.ok, false);
});
test('classesOn picks the day and sorts by time', () => {
  const sched = { 'CSCI 2010': 'MWF 13:00-13:50', 'MATH 2400': 'MWF 9:00-9:50', 'PHIL 2202': 'TR 10-11:15' };
  const mon = S.classesOn(new Date(2026, 10, 16), sched); // Monday
  assert.deepStrictEqual(mon.map((c) => c.course), ['MATH 2400', 'CSCI 2010']);
  assert.deepStrictEqual(S.classesOn(new Date(2026, 10, 17), sched).map((c) => c.course), ['PHIL 2202']);
  assert.strictEqual(S.classesOn(new Date(2026, 10, 15), sched).length, 0); // Sunday
});
test('fmtTime', () => {
  assert.strictEqual(S.fmtTime(0), '12 AM');
  assert.strictEqual(S.fmtTime(13 * 60 + 5), '1:05 PM');
  assert.strictEqual(S.fmtTime(720), '12 PM');
});
