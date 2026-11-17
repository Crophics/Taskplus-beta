const test = require('node:test');
const assert = require('node:assert');

let M;
test.before(async () => { M = await import('../src/moodle-map.mjs'); });

const BASE = 'https://moodle.example.edu/moodle';
const course = { id: 7, fullname: 'MATH 2400 Linear Algebra - 2026 FALL' };

test('htmlToText strips tags, keeps structure, decodes entities', () => {
  const html = '<p>Complete problems 4&ndash;10.</p><ul><li>Show <b>all</b> work</li><li>One PDF</li></ul><script>alert(1)</script>&amp; done&nbsp;now';
  const out = M.htmlToText(html);
  assert.ok(out.includes('Complete problems 4–10.'));
  assert.ok(out.includes('• Show all work'));
  assert.ok(out.includes('• One PDF'));
  assert.ok(out.includes('& done now'));
  assert.ok(!out.includes('alert'));
  assert.ok(!out.includes('<'));
});

test('htmlToText handles null, numeric entities and truncation', () => {
  assert.strictEqual(M.htmlToText(null), '');
  assert.strictEqual(M.htmlToText('a&#65;&#x42;'), 'aAB');
  assert.strictEqual(M.htmlToText('x&bogus;y'), 'x&bogus;y');
  const long = M.htmlToText('a'.repeat(50), 10);
  assert.strictEqual(long.length, 10);
  assert.ok(long.endsWith('…'));
});

test('courseCode takes the first two words like the vault script', () => {
  assert.strictEqual(M.courseCode('MATH 2400 Linear Algebra - 2026 FALL'), 'MATH 2400');
  assert.strictEqual(M.courseCode('  FYSE   1000 '), 'FYSE 1000');
  assert.strictEqual(M.courseCode(''), '');
});

test('pickDefaultCourses keeps current, visible courses only', () => {
  const now = 1_800_000_000;
  const courses = [
    { id: 1, startdate: now - 86400 * 60, enddate: now + 86400 * 60, visible: 1 },
    { id: 2, startdate: now - 86400 * 400, enddate: now - 86400 * 300, visible: 1 }, // ended
    { id: 3, startdate: now - 86400 * 60, enddate: 0, visible: 1 },                  // no end date
    { id: 4, startdate: now - 86400 * 60, enddate: now + 86400 * 60, visible: 0 },   // hidden
    { id: 5, startdate: now + 86400 * 120, enddate: 0, visible: 1 },                 // not started
  ];
  assert.deepStrictEqual(M.pickDefaultCourses(courses, now), [1, 3]);
});

test('mapAssignments maps fields and skips items with no due date', () => {
  const resp = {
    courses: [{
      id: 7,
      assignments: [
        {
          id: 101, cmid: 5001, name: ' Assignment 6 ', duedate: 1_795_000_000, allowsubmissionsfromdate: 1_790_000_000,
          cutoffdate: 0, grade: 100, intro: '<p>Do problems 4-10.</p>',
          introattachments: [{ filename: 'Assignment 6.pdf', filesize: 210000 }],
          introfiles: [{ filename: 'Assignment 6.pdf', filesize: 210000 }, { filename: 'data.csv', filesize: 5 }],
        },
        { id: 102, cmid: 5002, name: 'Open-ended', duedate: 0, grade: 10, intro: '' },
      ],
    }],
  };
  const { records, skippedNoDue } = M.mapAssignments(course, resp, BASE);
  assert.strictEqual(skippedNoDue, 1);
  assert.strictEqual(records.length, 1);
  const r = records[0];
  assert.strictEqual(r.id, 'moodle:5001');
  assert.strictEqual(r.cmid, 5001);
  assert.strictEqual(r.instanceId, 101);
  assert.strictEqual(r.courseId, 7);
  assert.strictEqual(r.course, 'MATH 2400');
  assert.strictEqual(r.kind, 'assign');
  assert.strictEqual(r.title, 'Assignment 6');
  assert.strictEqual(r.dueTs, 1_795_000_000);
  assert.strictEqual(r.opensTs, 1_790_000_000);
  assert.strictEqual(r.cutoffTs, null);
  assert.strictEqual(r.points, 100);
  assert.strictEqual(r.description, 'Do problems 4-10.');
  assert.deepStrictEqual(r.files, [{ name: 'Assignment 6.pdf', size: 210000 }, { name: 'data.csv', size: 5 }]);
  assert.strictEqual(r.link, BASE + '/mod/assign/view.php?id=5001');
});

test('mapQuizzes derives time limit in minutes and uses timeclose as due', () => {
  const resp = {
    quizzes: [
      { id: 55, coursemodule: 6001, course: 7, name: 'Quiz 4', intro: '<p>Chapter 5</p>', timeopen: 1_794_000_000, timeclose: 1_794_100_000, timelimit: 1200, grade: 10 },
      { id: 56, coursemodule: 6002, course: 7, name: 'Untimed', timeclose: 1_794_100_000, timelimit: 0, grade: 0 },
      { id: 57, coursemodule: 6003, course: 7, name: 'No close', timeclose: 0, timelimit: 0 },
    ],
  };
  const { records, skippedNoDue } = M.mapQuizzes(course, resp, BASE);
  assert.strictEqual(skippedNoDue, 1);
  assert.strictEqual(records.length, 2);
  assert.strictEqual(records[0].id, 'moodle:6001');
  assert.strictEqual(records[0].kind, 'quiz');
  assert.strictEqual(records[0].timeLimitMin, 20);
  assert.strictEqual(records[0].dueTs, 1_794_100_000);
  assert.strictEqual(records[0].link, BASE + '/mod/quiz/view.php?id=6001');
  assert.strictEqual(records[1].timeLimitMin, null);
  assert.strictEqual(records[1].points, null);
});

test('submissionState for assignments', () => {
  const mk = (status) => ({ lastattempt: { submission: { status } } });
  assert.strictEqual(M.submissionState('assign', mk('submitted')), 'submitted');
  assert.strictEqual(M.submissionState('assign', mk('draft')), 'draft');
  assert.strictEqual(M.submissionState('assign', mk('new')), 'none');
  assert.strictEqual(M.submissionState('assign', {}), 'none');
  assert.strictEqual(M.submissionState('assign', null), 'none');
});

test('submissionState for quizzes', () => {
  assert.strictEqual(M.submissionState('quiz', { attempts: [{ state: 'finished' }] }), 'submitted');
  assert.strictEqual(M.submissionState('quiz', { attempts: [{ state: 'inprogress' }] }), 'draft');
  assert.strictEqual(M.submissionState('quiz', { attempts: [{ state: 'abandoned' }] }), 'none');
  assert.strictEqual(M.submissionState('quiz', { attempts: [] }), 'none');
  assert.strictEqual(M.submissionState('quiz', undefined), 'none');
});
