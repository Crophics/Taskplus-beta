const { test } = require('node:test');
const assert = require('node:assert');

global.window = global;
global.localStorage = { setItem: () => {} };
require('../js/today-logic.js');
require('../js/plan-logic.js');
const P = global.TPPlan;

const TODAY = '2026-11-17';
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const it = (over = {}) => ({ id: 'x', title: 'T', course: 'MATH', due: addDays(TODAY, 2), total: 3, done: 0, today: 0, completed: false, archived: false, estimate: { minutes: 150 }, ...over });
const alloc = (item) => P.allocateItem(item, TODAY, daysBetween);
const mins = (item) => P.computeDays({ items: [item], today: TODAY, daysBetween }).days.map((d) => Math.round(d.minutes));

/* ---------- formatting ---------- */

test('fmtMinutes', () => {
  assert.strictEqual(P.fmtMinutes(0), '0m');
  assert.strictEqual(P.fmtMinutes(50), '50m');
  assert.strictEqual(P.fmtMinutes(59.6), '1h');
  assert.strictEqual(P.fmtMinutes(60), '1h');
  assert.strictEqual(P.fmtMinutes(90), '1h 30m');
  assert.strictEqual(P.fmtMinutes(150), '2h 30m');
  assert.strictEqual(P.fmtMinutes(-5), '0m');
  assert.strictEqual(P.fmtMinutes(undefined), '0m');
});

test('roundDisplay goes to the nearest 5 minutes and never shows real work as 0', () => {
  assert.strictEqual(P.roundDisplay(37.5), 40);
  assert.strictEqual(P.roundDisplay(33.3), 35);
  assert.strictEqual(P.roundDisplay(12), 10);
  assert.strictEqual(P.roundDisplay(3), 5);
  assert.strictEqual(P.roundDisplay(0), 0);
});

/* ---------- minutes per unit ---------- */

test('minutes per unit is the estimate divided by the number of parts', () => {
  assert.strictEqual(P.minutesPerUnit(it()), 50);
  assert.strictEqual(P.minutesPerUnit(it({ total: 1 })), 150);
  assert.strictEqual(P.minutesPerUnit(it({ estimate: undefined })), null);
  assert.strictEqual(P.minutesPerUnit(it({ estimate: { minutes: 0 } })), null);
  assert.strictEqual(P.leftMinutes(it({ done: 1 })), 100);
  assert.strictEqual(P.leftMinutes(it({ estimate: null })), null);
});

/* ---------- allocation ---------- */

test('3 parts due in 2 days: 2 today, 1 tomorrow (front-loaded, same as today\'s ceil(left/days))', () => {
  assert.deepStrictEqual(alloc(it()), [{ dayIndex: 0, units: 2 }, { dayIndex: 1, units: 1 }]);
  assert.deepStrictEqual(mins(it()), [100, 50, 0, 0, 0, 0, 0]);
});

test('logging a part today shrinks today but does not re-spread the plan', () => {
  const afterOne = it({ done: 1, today: 1 });
  assert.deepStrictEqual(mins(afterOne), [50, 50, 0, 0, 0, 0, 0]);
  const afterTwo = it({ done: 2, today: 2 });
  assert.deepStrictEqual(mins(afterTwo), [0, 50, 0, 0, 0, 0, 0], 'today\'s share is met; tomorrow still has its part');
});

test('work done on an earlier day is not counted as today\'s', () => {
  // 1 part done yesterday: 2 left over 2 days -> 1 today, 1 tomorrow
  assert.deepStrictEqual(mins(it({ done: 1, today: 0 })), [50, 50, 0, 0, 0, 0, 0]);
});

test('getting ahead pulls later days down', () => {
  // 4 parts due in 4 days (1/day). Did 2 today: nothing more today, 2 left over the next 3 days (days 1 and 2).
  const item = it({ total: 4, estimate: { minutes: 200 }, due: addDays(TODAY, 4), done: 2, today: 2 });
  assert.deepStrictEqual(alloc(item), [{ dayIndex: 1, units: 1 }, { dayIndex: 2, units: 1 }]);
});

test('a single-part item is planned for the day before it is due', () => {
  const single = (days) => alloc(it({ total: 1, estimate: { minutes: 45 }, due: addDays(TODAY, days) }));
  assert.deepStrictEqual(single(1), [{ dayIndex: 0, units: 1 }], 'due tomorrow -> today');
  assert.deepStrictEqual(single(0), [{ dayIndex: 0, units: 1 }], 'due today -> today');
  assert.deepStrictEqual(single(-3), [{ dayIndex: 0, units: 1 }], 'overdue -> today');
  assert.deepStrictEqual(single(3), [{ dayIndex: 2, units: 1 }], 'due in 3 days -> day 2');
  assert.deepStrictEqual(single(30), [], 'beyond the 7-day window');
});

test('overdue or due-today multi-part work is all on today', () => {
  assert.deepStrictEqual(alloc(it({ due: addDays(TODAY, -2), done: 1 })), [{ dayIndex: 0, units: 2 }]);
  assert.deepStrictEqual(alloc(it({ due: TODAY })), [{ dayIndex: 0, units: 3 }]);
});

test('work due far out spreads thinly and only the first 7 days are shown', () => {
  const far = it({ total: 8, estimate: { minutes: 400 }, due: addDays(TODAY, 20) });
  const a = alloc(far);
  assert.deepStrictEqual(a.map((x) => x.dayIndex), [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(a.every((x) => x.units === 1));
});

test('completed, archived and fully-done items allocate nothing', () => {
  assert.deepStrictEqual(alloc(it({ completed: true })), []);
  assert.deepStrictEqual(alloc(it({ archived: true })), []);
  assert.deepStrictEqual(alloc(it({ done: 3 })), []);
});

test('total minutes planned equals minutes left (nothing lost or invented)', () => {
  const cases = [it(), it({ done: 1 }), it({ total: 5, estimate: { minutes: 250 }, due: addDays(TODAY, 3) }), it({ total: 1, estimate: { minutes: 45 }, due: addDays(TODAY, 4) })];
  cases.forEach((c) => {
    const planned = mins(c).reduce((a, b) => a + b, 0);
    assert.strictEqual(planned, Math.round(P.leftMinutes(c)), JSON.stringify(c));
  });
});

test('an item with a missing or invalid due date places nothing and does not throw', () => {
  assert.deepStrictEqual(alloc(it({ due: undefined })), []);
  assert.deepStrictEqual(alloc(it({ due: 'not a date' })), []);
  assert.deepStrictEqual(alloc(it({ due: undefined, total: 1 })), []);
});

/* ---------- computeDays ---------- */

test('computeDays adds up across items, by course, and counts what has no estimate', () => {
  const items = [
    it({ id: 'a', course: 'MATH' }),
    it({ id: 'b', course: 'PHIL', total: 1, estimate: { minutes: 35 }, due: addDays(TODAY, 1) }),
    it({ id: 'c', course: 'MATH', estimate: undefined }),
    it({ id: 'd', course: 'MATH', completed: true }),
    it({ id: 'e', course: 'BIBL', total: 1, estimate: { minutes: 20 }, due: addDays(TODAY, 1) }),
  ];
  const out = P.computeDays({ items, today: TODAY, daysBetween, isLocked: (x) => x.id === 'e' });
  assert.strictEqual(out.unestimated, 1);
  assert.strictEqual(out.days[0].minutes, 135); // 100 (a) + 35 (b); e is locked
  assert.deepStrictEqual(out.days[0].byCourse, { MATH: 100, PHIL: 35 });
  assert.strictEqual(out.days[0].entries.length, 2);
  assert.strictEqual(out.days[1].minutes, 50);
  assert.strictEqual(out.days.length, 7);
});

/* ---------- today's header ---------- */

test('todaySummary sums what is left on the targets and what was logged today', () => {
  const a = it({ id: 'a' });                                   // 50 min/part
  const b = it({ id: 'b', total: 1, estimate: { minutes: 35 } });
  const c = it({ id: 'c', estimate: undefined });
  const logged = it({ id: 'd', done: 1, today: 1 });          // 1 part logged = 50 min
  const targets = [{ it: a, amt: 2 }, { it: b, amt: 1 }, { it: c, amt: 1 }];
  const ahead = [
    { kind: 'multi', it: it({ id: 'e', total: 2, estimate: { minutes: 80 } }), amt: 1, met: false },  // 40 min planned today
    { kind: 'multi', it: it({ id: 'f' }), amt: 1, met: true },                                         // already met: not counted
    { kind: 'single', it: it({ id: 'g', total: 1, estimate: { minutes: 90 } }), met: false },          // planned for a later day
  ];
  const s = P.todaySummary(targets, [a, b, c, logged], ahead);
  assert.strictEqual(s.aheadMin, 40);
  assert.strictEqual(s.leftMin, 135);
  assert.strictEqual(s.doneMin, 50);
  assert.strictEqual(s.plannedMin, 185);
  assert.ok(Math.abs(s.pct - 50 / 185) < 1e-9);
  assert.strictEqual(s.tasks, 3);
  assert.strictEqual(s.unestimated, 1);
});

test('todaySummary with nothing planned has a zero percent, not NaN', () => {
  const s = P.todaySummary([], []);
  assert.deepStrictEqual(s, { leftMin: 0, doneMin: 0, aheadMin: 0, plannedMin: 0, pct: 0, tasks: 0, unestimated: 0 });
});

/* ---------- heavy day ---------- */

const days = (arr) => arr.map((minutes, dayIndex) => ({ dayIndex, minutes }));

test('heavyDay flags the one day well above the rest of the week', () => {
  assert.deepStrictEqual(P.heavyDay(days([170, 185, 260, 105, 60, 50, 0])), { dayIndex: 2, minutes: 260 });
});

test('heavyDay stays quiet for an even week, a light week, or no work', () => {
  assert.strictEqual(P.heavyDay(days([100, 100, 100, 100, 100, 100, 100])), null);
  assert.strictEqual(P.heavyDay(days([60, 30, 10, 0, 0, 0, 0])), null, 'a big day but under 90 minutes');
  assert.strictEqual(P.heavyDay(days([0, 0, 0, 0, 0, 0, 0])), null);
  assert.strictEqual(P.heavyDay(days([120, 110, 130, 120, 110, 120, 100])), null, 'high but not out of line');
});

test('heavyDay breaks ties toward the earliest day and honours custom thresholds', () => {
  assert.strictEqual(P.heavyDay(days([0, 300, 300, 0, 0, 0, 0])).dayIndex, 1);
  assert.strictEqual(P.heavyDay(days([30, 10, 10, 10, 10, 10, 10]), { minMinutes: 20, ratio: 1.5 }).dayIndex, 0);
});

/* ---------- spread ---------- */

test('spread front-loads the remainder', () => {
  assert.deepStrictEqual(P.spread(3, 2), [2, 1]);
  assert.deepStrictEqual(P.spread(8, 20).slice(0, 9), [1, 1, 1, 1, 1, 1, 1, 1, 0]);
  assert.deepStrictEqual(P.spread(0, 3), [0, 0, 0]);
  assert.deepStrictEqual(P.spread(6, 3), [2, 2, 2]);
});

/* ---------- agreement with js/today-logic.js ---------- */

// The planner claims to follow Today's pacing. Prove it: for many multi-part
// scenarios, the planner's units for today must equal what Today's own logic says
// is left to do today (whether it files the item under required or get-ahead).
test('planner day-0 units match what today-logic computes, across many scenarios', () => {
  let checked = 0;
  for (let total = 2; total <= 8; total++) {
    for (let dueIn = 0; dueIn <= 10; dueIn++) {
      for (let done = 0; done < total; done++) {
        for (let loggedToday = 0; loggedToday <= Math.min(done, 3); loggedToday++) {
          // The app caches each day's target (it.dailyTarget) the first time it renders that day,
          // BEFORE anything is logged. Reproduce that order: compute at the start of the day,
          // then apply today's progress, then compute again.
          const item = { id: 'a', title: 'T', course: 'C', total, done: done - loggedToday, today: 0, due: addDays(TODAY, dueIn), completed: false, archived: false, estimate: { minutes: total * 50 } };
          const ctxFor = (x) => ({ items: [x], storageKey: 'k', isLocked: () => false, unlockedToday: () => false, today: () => TODAY, daysBetween });
          global.TPTodayLogic.computeTodayPanel(ctxFor(item));
          item.done = done;
          item.today = loggedToday;
          const panel = global.TPTodayLogic.computeTodayPanel(ctxFor(item));
          const expectedUnits = panel.multiTargets.length ? panel.multiTargets[0].amt : 0; // remaining today (after what is logged)
          const mine = alloc(item).find((x) => x.dayIndex === 0);
          assert.strictEqual(mine ? mine.units : 0, expectedUnits, `total=${total} dueIn=${dueIn} done=${done} today=${loggedToday}`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 500);
});

test('planner agrees with today-logic on single-part items: required exactly when planned for today', () => {
  for (let dueIn = -2; dueIn <= 6; dueIn++) {
    const item = { id: 'a', title: 'T', course: 'C', total: 1, done: 0, today: 0, due: addDays(TODAY, dueIn), completed: false, archived: false, estimate: { minutes: 45 } };
    const panel = global.TPTodayLogic.computeTodayPanel({
      items: [{ ...item }], storageKey: 'k', isLocked: () => false, unlockedToday: () => false, today: () => TODAY, daysBetween,
    });
    const required = panel.requiredTight.length > 0;
    const plannedToday = alloc(item).some((x) => x.dayIndex === 0);
    assert.strictEqual(plannedToday, required, 'dueIn=' + dueIn);
  }
});

test('Today\'s required + get-ahead minutes add up to the planner\'s minutes for today (what Week shows)', () => {
  const todayCtx = (items) => ({ items, storageKey: 'k', isLocked: () => false, unlockedToday: () => false, today: () => TODAY, daysBetween });
  const items = [
    it({ id: 'a', total: 2, estimate: { minutes: 100 }, due: addDays(TODAY, 2) }),        // required pace: 1 part today
    it({ id: 'b', total: 1, estimate: { minutes: 35 }, due: addDays(TODAY, 1) }),         // single due tomorrow: required today
    it({ id: 'c', total: 2, estimate: { minutes: 80 }, due: addDays(TODAY, 5) }),         // slack: get ahead, 1 part today
    it({ id: 'd', total: 1, estimate: { minutes: 90 }, due: addDays(TODAY, 4) }),         // single, later: not today
  ];
  const panel = global.TPTodayLogic.computeTodayPanel(todayCtx(items));
  const screen = global.TPTodayLogic.computeTodayScreen(panel);
  const s = P.todaySummary(screen.targets, items, screen.getAhead);
  const week = P.computeDays({ items, today: TODAY, daysBetween }).days[0].minutes;
  assert.strictEqual(Math.round(s.leftMin + s.aheadMin), Math.round(week));
  assert.strictEqual(Math.round(week), 50 + 35 + 40);
});

/* ---------- named steps with their own minutes ---------- */

const stepped = (over = {}) => it({ total: 3, estimate: { minutes: 150, steps: [{ name: 'Read', minutes: 25 }, { name: 'Solve', minutes: 100 }, { name: 'Write up', minutes: 25 }] }, ...over });

test('with named steps, a day gets the NEXT steps\' minutes, not an average', () => {
  // 3 steps over 2 days -> 2 steps today (25 + 100), 1 tomorrow (25)
  assert.deepStrictEqual(mins(stepped()), [125, 25, 0, 0, 0, 0, 0]);
  // after the first step is done today, today's remaining share is 1 step: the 100-minute one
  assert.deepStrictEqual(mins(stepped({ done: 1, today: 1 })), [100, 25, 0, 0, 0, 0, 0]);
  assert.deepStrictEqual(mins(stepped({ done: 2, today: 2 })), [0, 25, 0, 0, 0, 0, 0]);
});

test('with named steps, minutes left and a day\'s entry minutes follow the steps', () => {
  assert.strictEqual(P.leftMinutes(stepped()), 150);
  assert.strictEqual(P.leftMinutes(stepped({ done: 1 })), 125);
  assert.strictEqual(P.entryMinutes({ it: stepped(), amt: 2 }), 125);
  assert.strictEqual(P.entryMinutes({ it: stepped({ done: 1, today: 1 }), amt: 1 }), 100);
  assert.strictEqual(P.unitMinutes(stepped(), 1, 5), 125, 'asking for more than exist stops at the end');
});

test('with named steps, done-today minutes are the steps actually finished today', () => {
  const targets = [];
  const s = P.todaySummary(targets, [stepped({ done: 2, today: 2 })]);
  assert.strictEqual(s.doneMin, 125);
  assert.strictEqual(P.todaySummary([], [stepped({ done: 2, today: 1 })]).doneMin, 100, 'step 2 (index 1) was today\'s; step 1 was yesterday\'s');
});

test('steps that do not match the parts are ignored and the average is used', () => {
  const mismatched = stepped({ total: 4, estimate: { minutes: 200, steps: [{ name: 'a', minutes: 150 }, { name: 'b', minutes: 50 }] } });
  assert.strictEqual(P.stepsUsable(mismatched), false);
  assert.strictEqual(P.leftMinutes(mismatched), 200);
  assert.strictEqual(P.unitMinutes(mismatched, 0, 2), 100);
});

test('named-step minutes planned across the week still add up to minutes left', () => {
  [stepped(), stepped({ done: 1 }), stepped({ due: addDays(TODAY, 3) }), stepped({ due: addDays(TODAY, 20) })].forEach((c) => {
    const planned = mins(c).reduce((a, b) => a + b, 0);
    const horizonLimited = c.due === addDays(TODAY, 20);
    if (!horizonLimited) assert.strictEqual(planned, Math.round(P.leftMinutes(c)), JSON.stringify(c.estimate.steps) + ' done=' + c.done);
  });
});
