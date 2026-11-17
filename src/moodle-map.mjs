// moodle-map.mjs — pure mapping from Moodle web-service JSON to import records.
// No network, no storage, no globals: everything here is unit-tested with
// fixtures shaped like real Moodle responses (see test/moodle-map.test.js).

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };

/** Moodle intro HTML -> plain text (no DOM available in a Worker). */
export function htmlToText(html, max = 4000) {
  let s = String(html == null ? '' : html);
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '• ');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    const v = ENTITIES[e.toLowerCase()];
    return v === undefined ? m : v;
  });
  s = s.replace(/[ \t\f\v ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (s.length > max) s = s.slice(0, max - 1).trimEnd() + '…';
  return s;
}

/** "MATH 2400 Calculus III - Fall 2026" -> "MATH 2400" (same rule the vault script used). */
export function courseCode(fullname) {
  return String(fullname || '').trim().split(/\s+/).slice(0, 2).join(' ');
}

/**
 * Which enrolled courses to pre-select on the Connect screen: ones that have
 * started, haven't ended, and aren't hidden. The user can change the choice.
 */
export function pickDefaultCourses(courses, nowSec) {
  return (courses || [])
    .filter((c) => {
      if (c.visible === 0 || c.visible === false) return false;
      const start = Number(c.startdate) || 0;
      const end = Number(c.enddate) || 0;
      if (start && start > nowSec + 14 * 86400) return false;
      if (end && end < nowSec) return false;
      return true;
    })
    .map((c) => c.id);
}

function positiveTs(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function fileList(...lists) {
  const seen = new Set();
  const out = [];
  lists.forEach((l) => (l || []).forEach((f) => {
    const name = f && (f.filename || f.name);
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push({ name, size: Number(f.filesize) || 0 });
  }));
  return out;
}

/**
 * mod_assign_get_assignments `configs` -> how the work is handed in.
 * Returns {submissionTypes: ['file','onlinetext',...], wordLimit}. Both are
 * inputs to the time estimate (a 1,500-word online essay vs. a PDF problem set).
 */
export function submissionInfo(configs) {
  const types = [];
  let wordLimit = null;
  const wordLimitOn = {};
  (Array.isArray(configs) ? configs : []).forEach((c) => {
    if (!c || c.subtype !== 'assignsubmission') return;
    if (c.name === 'enabled' && String(c.value) === '1' && c.plugin && !types.includes(c.plugin)) types.push(c.plugin);
    if (c.plugin === 'onlinetext' && c.name === 'wordlimitenabled') wordLimitOn.v = String(c.value) === '1';
    if (c.plugin === 'onlinetext' && c.name === 'wordlimit' && Number(c.value) > 0) wordLimit = Number(c.value);
  });
  if (wordLimitOn.v === false) wordLimit = null;
  return { submissionTypes: types, wordLimit };
}

/**
 * mod_assign_get_assignments response -> records. `course` is {id, fullname}.
 * Items with no due date are skipped (the app can't place them) and counted.
 */
export function mapAssignments(course, resp, base) {
  const records = [];
  let skippedNoDue = 0;
  ((resp && resp.courses) || []).forEach((co) => {
    (co.assignments || []).forEach((a) => {
      const dueTs = positiveTs(a.duedate);
      if (!dueTs) { skippedNoDue++; return; }
      const cmid = a.cmid != null ? a.cmid : a.coursemodule;
      const sub = submissionInfo(a.configs);
      records.push({
        id: 'moodle:' + cmid,
        cmid: Number(cmid),
        instanceId: Number(a.id),
        courseId: Number(course.id),
        course: courseCode(course.fullname),
        kind: 'assign',
        title: String(a.name || '').trim(),
        dueTs,
        opensTs: positiveTs(a.allowsubmissionsfromdate),
        cutoffTs: positiveTs(a.cutoffdate),
        points: Number(a.grade) > 0 ? Number(a.grade) : null,
        description: htmlToText(a.intro),
        files: fileList(a.introattachments, a.introfiles),
        submissionTypes: sub.submissionTypes,
        wordLimit: sub.wordLimit,
        timeLimitMin: null,
        link: base + '/mod/assign/view.php?id=' + cmid,
        state: null,
      });
    });
  });
  return { records, skippedNoDue };
}

/** mod_quiz_get_quizzes_by_courses response -> records. */
export function mapQuizzes(course, resp, base) {
  const records = [];
  let skippedNoDue = 0;
  ((resp && resp.quizzes) || []).forEach((q) => {
    const dueTs = positiveTs(q.timeclose);
    if (!dueTs) { skippedNoDue++; return; }
    const cmid = q.coursemodule != null ? q.coursemodule : q.cmid;
    const limit = Number(q.timelimit);
    records.push({
      id: 'moodle:' + cmid,
      cmid: Number(cmid),
      instanceId: Number(q.id),
      courseId: Number(course.id),
      course: courseCode(course.fullname),
      kind: 'quiz',
      title: String(q.name || '').trim(),
      dueTs,
      opensTs: positiveTs(q.timeopen),
      cutoffTs: null,
      points: Number(q.grade) > 0 ? Number(q.grade) : null,
      description: htmlToText(q.intro),
      files: fileList(q.introfiles),
      submissionTypes: [],
      wordLimit: null,
      timeLimitMin: limit > 0 ? Math.round(limit / 60) : null,
      link: base + '/mod/quiz/view.php?id=' + cmid,
      state: null,
    });
  });
  return { records, skippedNoDue };
}

/** Normalises mod_assign_get_submission_status / mod_quiz_get_user_attempts to 'submitted'|'draft'|'none'. */
export function submissionState(kind, resp) {
  if (kind === 'assign') {
    const st = resp && resp.lastattempt && resp.lastattempt.submission && resp.lastattempt.submission.status;
    if (st === 'submitted') return 'submitted';
    if (st === 'draft') return 'draft';
    return 'none';
  }
  const states = ((resp && resp.attempts) || []).map((a) => a.state);
  if (states.includes('finished')) return 'submitted';
  if (states.some((s) => s === 'inprogress' || s === 'overdue')) return 'draft';
  return 'none';
}

/** "12.50 %" -> 12.5; anything without a percent sign -> null. */
export function parsePercent(str) {
  const m = /(-?\d+(?:\.\d+)?)\s*%/.exec(String(str == null ? '' : str));
  return m ? Number(m[1]) : null;
}

function percentOf(g) {
  if (g.gradeishidden) return null;
  if (g.graderaw === null || g.graderaw === undefined) return null;
  const raw = Number(g.graderaw);
  const max = Number(g.grademax);
  if (!Number.isFinite(raw) || !(max > 0)) return null;
  return Math.round((raw / max) * 10000) / 100;
}

/**
 * gradereport_user_get_grade_items response -> one course's grade entries.
 * `id` matches the import records ('moodle:<cmid>') for activities, and is
 * 'gi:<gradeitem id>' for manual items (attendance, MyLab totals...) that have
 * no activity. `weightSuggested` is Moodle's own weight, offered only for flat
 * gradebooks: with nested categories a weight is relative to its category, so
 * it would be wrong as a share of the whole course.
 */
export function mapGradeItems(course, resp) {
  const ug = resp && Array.isArray(resp.usergrades) ? resp.usergrades[0] : null;
  const rows = (ug && ug.gradeitems) || [];
  const flat = !(ug && Number(ug.maxdepth) > 2);
  let total = null;
  const items = [];
  rows.forEach((g) => {
    if (g.itemtype === 'course') { total = percentOf(g); return; }
    if (g.itemtype === 'category') return;
    const cmid = g.cmid !== null && g.cmid !== undefined && Number(g.cmid) > 0 ? Number(g.cmid) : null;
    const suggested = flat ? parsePercent(g.weightformatted) : null;
    items.push({
      id: cmid ? 'moodle:' + cmid : 'gi:' + g.id,
      cmid,
      name: String(g.itemname || '').trim() || 'Grade item',
      kind: g.itemmodule || g.itemtype || 'other',
      pct: percentOf(g),
      max: Number(g.grademax) > 0 ? Number(g.grademax) : null,
      feedback: htmlToText(g.feedback, 1000),
      gradedTs: positiveTs(g.gradedategraded),
      weightSuggested: suggested !== null && suggested > 0 ? suggested : null,
    });
  });
  return { courseId: Number(course.id), course: courseCode(course.fullname), total, items };
}
