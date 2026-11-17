const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ZONES = ['Pacific/Auckland', 'America/Chicago', 'UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];
const UTILS = path.join(__dirname, '..', 'js', 'utils.js');

// Runs in a child process so TZ is set before any Date is created.
const SCRIPT = `
global.window = global;
global.localStorage = { getItem: () => null };
require(${JSON.stringify(UTILS)});
const TP = global.TP;
const p = n => String(n).padStart(2, '0');
const local = d => d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
const now = new Date();
const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
const t = TP.today();
console.log(JSON.stringify({
  today: t, expToday: local(now),
  next: TP.addDays(t, 1), expNext: local(tomorrow),
  prev: TP.addDays(t, -1),
  month: TP.addMonths('2026-01-31', 1),
  roundTrip: TP.addDays('2026-03-08', 1) + '|' + TP.addDays('2026-11-01', 1),
}));
`;

for (const tz of ZONES) {
  test('local calendar dates in TZ=' + tz, () => {
    const r = spawnSync(process.execPath, ['-e', SCRIPT], {
      env: { ...process.env, TZ: tz }, encoding: 'utf8',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout);
    assert.strictEqual(o.today, o.expToday);
    assert.strictEqual(o.next, o.expNext);
    assert.strictEqual(o.month, '2026-03-03'); // JS month-overflow semantics preserved
    assert.strictEqual(o.roundTrip, '2026-03-09|2026-11-02');
  });
}
