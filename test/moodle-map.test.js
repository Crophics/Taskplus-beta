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

test('mapAssignments maps fields and keeps items with no due date as undated', () => {
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
  const { records } = M.mapAssignments(course, resp, BASE);
  assert.strictEqual(records.length, 2);
  assert.strictEqual(records[1].id, 'moodle:5002');
  assert.strictEqual(records[1].dueTs, null, 'no due date stays null, not 0');
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
  assert.deepStrictEqual(r.files, [{ name: 'Assignment 6.pdf', size: 210000, url: null, mime: null, modified: null }, { name: 'data.csv', size: 5, url: null, mime: null, modified: null }]);
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
  const { records } = M.mapQuizzes(course, resp, BASE);
  assert.strictEqual(records.length, 3);
  assert.strictEqual(records[2].dueTs, null, 'a quiz with no close date is kept, undated');
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

test('submissionInfo reads enabled submission types and an enabled word limit', () => {
  const cfg = [
    { plugin: 'file', subtype: 'assignsubmission', name: 'enabled', value: '1' },
    { plugin: 'file', subtype: 'assignsubmission', name: 'maxfilesubmissions', value: '1' },
    { plugin: 'onlinetext', subtype: 'assignsubmission', name: 'enabled', value: '1' },
    { plugin: 'onlinetext', subtype: 'assignsubmission', name: 'wordlimitenabled', value: '1' },
    { plugin: 'onlinetext', subtype: 'assignsubmission', name: 'wordlimit', value: '1500' },
    { plugin: 'comments', subtype: 'assignsubmission', name: 'enabled', value: '0' },
    { plugin: 'comments', subtype: 'assignfeedback', name: 'enabled', value: '1' },
  ];
  assert.deepStrictEqual(M.submissionInfo(cfg), { submissionTypes: ['file', 'onlinetext'], wordLimit: 1500 });
});

test('submissionInfo ignores a word limit that is switched off, and bad input', () => {
  const cfg = [
    { plugin: 'onlinetext', subtype: 'assignsubmission', name: 'enabled', value: '1' },
    { plugin: 'onlinetext', subtype: 'assignsubmission', name: 'wordlimitenabled', value: '0' },
    { plugin: 'onlinetext', subtype: 'assignsubmission', name: 'wordlimit', value: '500' },
  ];
  assert.deepStrictEqual(M.submissionInfo(cfg), { submissionTypes: ['onlinetext'], wordLimit: null });
  assert.deepStrictEqual(M.submissionInfo(undefined), { submissionTypes: [], wordLimit: null });
  assert.deepStrictEqual(M.submissionInfo([null, 5, {}]), { submissionTypes: [], wordLimit: null });
});

test('mapAssignments carries submission types and word limit onto the record', () => {
  const resp = { courses: [{ id: 7, assignments: [{ id: 1, cmid: 5001, name: 'Essay', duedate: 1_795_000_000, grade: 50, intro: '', configs: [
    { plugin: 'onlinetext', subtype: 'assignsubmission', name: 'enabled', value: '1' },
    { plugin: 'onlinetext', subtype: 'assignsubmission', name: 'wordlimitenabled', value: '1' },
    { plugin: 'onlinetext', subtype: 'assignsubmission', name: 'wordlimit', value: '800' }] }] }] };
  const r = M.mapAssignments(course, resp, BASE).records[0];
  assert.deepStrictEqual(r.submissionTypes, ['onlinetext']);
  assert.strictEqual(r.wordLimit, 800);
  assert.deepStrictEqual(M.mapQuizzes(course, { quizzes: [{ id: 5, coursemodule: 9, name: 'Q', timeclose: 1_795_000_000 }] }, BASE).records[0].submissionTypes, []);
});

test('file records keep the download URL, type and modified time, and never keep a token', () => {
  const resp = { courses: [{ id: 7, assignments: [{ id: 1, cmid: 5001, name: 'HW', duedate: 1_795_000_000, grade: 10, intro: '',
    introattachments: [
      { filename: 'sheet.pdf', filesize: 1000, mimetype: 'application/pdf', timemodified: 1_790_000_000, fileurl: BASE + '/webservice/pluginfile.php/55/mod_assign/introattachment/0/sheet.pdf?token=SECRET123&forcedownload=1#frag' },
      { filename: 'broken.pdf', filesize: 5, fileurl: 'not a url' },
    ] }] }] };
  const files = M.mapAssignments(course, resp, BASE).records[0].files;
  assert.strictEqual(files[0].url, BASE + '/webservice/pluginfile.php/55/mod_assign/introattachment/0/sheet.pdf?forcedownload=1');
  assert.ok(!JSON.stringify(files).includes('SECRET123'), 'the token is stripped');
  assert.strictEqual(files[0].mime, 'application/pdf');
  assert.strictEqual(files[0].modified, 1_790_000_000);
  assert.strictEqual(files[1].url, null, 'an unparseable URL is dropped, not kept');
  assert.strictEqual(M.safeFileUrl('https://x.example/a?token=abc'), 'https://x.example/a');
  assert.strictEqual(M.safeFileUrl(undefined), null);
});
