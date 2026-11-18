const test = require('node:test');
const assert = require('node:assert');

let C, M;
test.before(async () => {
  C = await import('../src/moodle-client.mjs');
  M = await import('../src/moodle-map.mjs');
});

const NOW = 1_794_000_000;
const DAY = 86400;

// A fake Moodle with one course and the given assignments ({id, name, due, status}).
function fakeMoodle(assigns, calls) {
  return async (url, init) => {
    const body = new URLSearchParams(init.body);
    const f = body.get('wsfunction');
    const out = (o) => new Response(JSON.stringify(o), { status: 200 });
    calls.push(f + (f === 'mod_assign_get_submission_status' ? ':' + body.get('assignid') : ''));
    if (f === 'core_enrol_get_users_courses') return out([{ id: 7, fullname: 'MATH 2400 Linear &amp; Friends' }]);
    if (f === 'mod_assign_get_assignments') return out({ courses: [{ id: 7, assignments: assigns.map((a) => ({ id: a.id, cmid: a.id + 1000, name: a.name, duedate: a.due, configs: [] })) }] });
    if (f === 'mod_quiz_get_quizzes_by_courses') return out({ quizzes: [] });
    if (f === 'mod_assign_get_submission_status') {
      const a = assigns.find((x) => x.id === Number(body.get('assignid')));
      return out({ lastattempt: a.team ? { teamsubmission: { status: a.status } } : { submission: { status: a.status } } });
    }
    throw new Error('unexpected ' + f);
  };
}

test('titles and course names are decoded once, so the app does not show "&amp;"', async () => {
  const calls = [];
  const r = await C.syncCourses('https://m.example.edu', 't', 1, [7], { fetchFn: fakeMoodle([{ id: 1, name: 'Journal &amp; Reflection #1', due: NOW + DAY, status: 'submitted' }], calls), nowSec: NOW });
  assert.strictEqual(r.records[0].title, 'Journal & Reflection #1');
  assert.strictEqual(r.courses[0].fullname, 'MATH 2400 Linear & Friends');
  assert.strictEqual(r.records[0].course, 'MATH 2400');
  assert.strictEqual(M.plainText('Q&amp;A &#8211; &ldquo;intro&rdquo; <b>bold</b>'), 'Q&A – “intro” bold');
  assert.strictEqual(M.plainText('Already & plain'), 'Already & plain');
});

test('work overdue for months is still checked, so a submitted old assignment is marked done', async () => {
  const calls = [];
  const r = await C.syncCourses('https://m.example.edu', 't', 1, [7], { fetchFn: fakeMoodle([{ id: 1, name: 'Old', due: NOW - 90 * DAY, status: 'submitted' }, { id: 2, name: 'Older, missing', due: NOW - 100 * DAY, status: null }], calls), nowSec: NOW });
  assert.strictEqual(r.records.find((x) => x.title === 'Old').state, 'submitted');
  assert.strictEqual(r.records.find((x) => x.title === 'Older, missing').state, 'none');
});

test('a submitted item is final: it is not asked about again, and the budget goes to the rest', async () => {
  const calls = [];
  const assigns = [{ id: 1, name: 'Done', due: NOW + DAY, status: 'submitted' }, { id: 2, name: 'Open', due: NOW + 2 * DAY, status: 'none' }, { id: 3, name: 'New', due: NOW + 3 * DAY, status: 'draft' }];
  const r = await C.syncCourses('https://m.example.edu', 't', 1, [7], { fetchFn: fakeMoodle(assigns, calls), nowSec: NOW, known: { 'moodle:1001': 'submitted', 'moodle:1002': 'none' } });
  assert.ok(!calls.includes('mod_assign_get_submission_status:1'), 'finished work is skipped');
  assert.strictEqual(r.records.find((x) => x.title === 'Done').state, 'submitted', 'but still reported as submitted');
  assert.strictEqual(r.records.find((x) => x.title === 'New').state, 'draft');
  // With only one call to spare, the never-checked item beats the one already known to be unsubmitted.
  const calls2 = [];
  await C.syncCourses('https://m.example.edu', 't', 1, [7], { fetchFn: fakeMoodle(assigns, calls2), nowSec: NOW, budget: 4, known: { 'moodle:1002': 'none' } });
  assert.ok(calls2.includes('mod_assign_get_submission_status:1') || calls2.includes('mod_assign_get_submission_status:3'));
  assert.ok(!calls2.includes('mod_assign_get_submission_status:2'));
});

test('a group assignment submitted by the team counts as submitted', () => {
  assert.strictEqual(M.submissionState('assign', { lastattempt: { teamsubmission: { status: 'submitted' } } }), 'submitted');
  assert.strictEqual(M.submissionState('assign', { lastattempt: { submission: { status: 'new' }, teamsubmission: { status: 'draft' } } }), 'draft');
  assert.strictEqual(M.submissionState('assign', {}), 'none');
});

test('an assignment the teacher already graded counts as done even with no submission on file', () => {
  const graded = { lastattempt: { submission: { status: 'new' }, gradingstatus: 'graded' } };
  assert.strictEqual(M.submissionState('assign', graded), 'submitted');
  assert.strictEqual(M.submissionState('assign', { lastattempt: { submission: { status: 'new' }, gradingstatus: 'notgraded' } }), 'none');
  assert.strictEqual(M.submissionState('assign', { lastattempt: { submission: { status: 'draft' }, gradingstatus: 'notgraded' } }), 'draft');
});

test('assignments with no due date are synced, and still get their submission checked', async () => {
  const calls = [];
  const r = await C.syncCourses('https://m.example.edu', 't', 1, [7], { fetchFn: fakeMoodle([{ id: 1, name: 'No date', due: 0, status: 'submitted' }, { id: 2, name: 'Dated', due: NOW + DAY, status: 'none' }], calls), nowSec: NOW });
  const undated = r.records.find((x) => x.title === 'No date');
  assert.strictEqual(undated.dueTs, null);
  assert.strictEqual(undated.state, 'submitted');
  assert.ok(!r.warnings.some((w) => w.startsWith('skipped_no_due_date')));
});
