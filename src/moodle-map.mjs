// moodle-map.mjs — pure mapping from Moodle web-service JSON to import records.
// No network, no storage, no globals: everything here is unit-tested with
// fixtures shaped like real Moodle responses (see test/moodle-map.test.js).

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  copy: '©', reg: '®', trade: '™', times: '×', divide: '÷', bull: '•', middot: '·', laquo: '«', raquo: '»', deg: '°', plusmn: '±', frac12: '½', eacute: 'é', egrave: 'è', aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü', ouml: 'ö', auml: 'ä', ccedil: 'ç' };

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

/**
 * A short Moodle name (assignment, quiz or course title) as plain one-line text. Moodle sends these
 * HTML-escaped ("Journal &amp; Reflection"), and the app escapes text again when it draws it, so
 * decode here once or the screen shows "&amp;".
 */
export function plainText(s, max = 300) {
  return htmlToText(s, max).replace(/\s+/g, ' ').trim();
}

/** "MATH 2400 Calculus III - Fall 2026" -> "MATH 2400" (same rule the vault script used). */
export function courseCode(fullname) {
  return plainText(fullname).split(/\s+/).slice(0, 2).join(' ');
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

/**
 * A Moodle file URL, minus any access token. Moodle can put the web-service token in the query
 * string; the records produced here are sent to the browser, so a token must never survive.
 */
export function safeFileUrl(u) {
  try {
    const x = new URL(String(u));
    x.searchParams.delete('token');
    x.hash = '';
    return x.toString();
  } catch (e) {
    return null;
  }
}

function fileList(...lists) {
  const seen = new Set();
  const out = [];
  lists.forEach((l) => (l || []).forEach((f) => {
    const name = f && (f.filename || f.name);
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push({
      name,
      size: Number(f.filesize) || 0,
      url: f.fileurl ? safeFileUrl(f.fileurl) : null,
      mime: f.mimetype ? String(f.mimetype) : null,
      modified: Number(f.timemodified) > 0 ? Number(f.timemodified) : null,
    });
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
 * An assignment with no due date is kept with `dueTs: null`: the app lists it but never paces it.
 */
export function mapAssignments(course, resp, base) {
  const records = [];
  ((resp && resp.courses) || []).forEach((co) => {
    (co.assignments || []).forEach((a) => {
      const dueTs = positiveTs(a.duedate);
      const cmid = a.cmid != null ? a.cmid : a.coursemodule;
      const sub = submissionInfo(a.configs);
      records.push({
        id: 'moodle:' + cmid,
        cmid: Number(cmid),
        instanceId: Number(a.id),
        courseId: Number(course.id),
        course: courseCode(course.fullname),
        kind: 'assign',
        title: plainText(a.name),
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
  return { records };
}

/** mod_quiz_get_quizzes_by_courses response -> records. A quiz with no close date is kept with `dueTs: null`. */
export function mapQuizzes(course, resp, base) {
  const records = [];
  ((resp && resp.quizzes) || []).forEach((q) => {
    const dueTs = positiveTs(q.timeclose);
    const cmid = q.coursemodule != null ? q.coursemodule : q.cmid;
    const limit = Number(q.timelimit);
    records.push({
      id: 'moodle:' + cmid,
      cmid: Number(cmid),
      instanceId: Number(q.id),
      courseId: Number(course.id),
      course: courseCode(course.fullname),
      kind: 'quiz',
      title: plainText(q.name),
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
  return { records };
}

/** Normalises mod_assign_get_submission_status / mod_quiz_get_user_attempts to 'submitted'|'draft'|'none'. */
export function submissionState(kind, resp) {
  if (kind === 'assign') {
    const la = resp && resp.lastattempt;
    // A group assignment is submitted by the team, not by you: that shows up as teamsubmission.
    const sts = [la && la.submission && la.submission.status, la && la.teamsubmission && la.teamsubmission.status];
    if (sts.includes('submitted')) return 'submitted';
    // Graded by the teacher with nothing submitted here (handed in on paper, in class, or marked by hand):
    // Moodle has handled it, so there is nothing left to do. (This school's Moodle does not expose
    // activity completion to the mobile app, so the grading status is the signal there is.)
    if (la && la.gradingstatus === 'graded') return 'submitted';
    if (sts.includes('draft')) return 'draft';
    return 'none';
  }
  const states = ((resp && resp.attempts) || []).map((a) => a.state);
  if (states.includes('finished')) return 'submitted';
  if (states.some((s) => s === 'inprogress' || s === 'overdue')) return 'draft';
  return 'none';
}

/** "12.50 %" -> 12.5; anything without a percent sign -> null. */
