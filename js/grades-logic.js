/* grades-logic.js — Weighted grades, targets and GPA. Pure functions (no DOM,
   no network); tested in test/grades-logic.test.js.

   Data model (all device-local, see docs/PLAN-moodle-import.md):
   - grade store  `tp-moodle-grades`: what Moodle's gradebook reported, per
     course code, replaced on each sync.
   - settings     `tp-grade-settings`: what the USER owns:
       { weights: { '<entry id>': percent of the course grade },
         courses: { '<course code>': { target, credits, scale } } }
     Entry ids match the import records: 'moodle:<cmid>' for activities and
     'gi:<id>' for manual gradebook items.

   Core idea: the current grade is the average of the graded, WEIGHTED work so
   far (sum of weight x score / sum of weight). What is still to come is
   whatever part of the 100% has no graded weight yet.
*/
(function (global) {
  const LETTERS = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-'];
  const DEFAULT_CUTOFFS = [93, 90, 87, 83, 80, 77, 73, 70, 67, 63, 60];
  const GPA_POINTS = { A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, 'D-': 0.7, F: 0 };
  const DEFAULTS = { target: 90, credits: 3 };

  const normalize = (s) => String(s || '').trim().toLowerCase();
  const round2 = (n) => Math.round(n * 100) / 100;
  const round1 = (n) => Math.round(n * 10) / 10;

  /** Eleven descending cutoffs (A through D-; anything lower is F) -> [{min, letter}]. */
  function scaleFromCutoffs(cutoffs) {
    const c = isValidCutoffs(cutoffs) ? cutoffs : DEFAULT_CUTOFFS;
    return LETTERS.map((letter, i) => ({ min: c[i], letter })).concat([{ min: -Infinity, letter: 'F' }]);
  }

  function isValidCutoffs(c) {
    if (!Array.isArray(c) || c.length !== LETTERS.length) return false;
    for (let i = 0; i < c.length; i++) {
      if (typeof c[i] !== 'number' || !Number.isFinite(c[i]) || c[i] < 0 || c[i] > 100) return false;
      if (i > 0 && c[i] >= c[i - 1]) return false;
    }
    return true;
  }

  function letterFor(pct, cutoffs) {
    if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
    const scale = scaleFromCutoffs(cutoffs);
    const p = round2(pct);
    return scale.find((s) => p >= s.min).letter;
  }

  function gpaPoints(letter) {
    return letter in GPA_POINTS ? GPA_POINTS[letter] : null;
  }

  /* ---------------- settings (user-owned) ---------------- */

  function emptySettings() {
    return { weights: {}, courses: {} };
  }

  function courseSettings(settings, courseName) {
    const stored = (settings && settings.courses && settings.courses[courseName]) || {};
    return {
      target: Number.isFinite(stored.target) ? stored.target : DEFAULTS.target,
      credits: Number.isFinite(stored.credits) && stored.credits > 0 ? stored.credits : DEFAULTS.credits,
      scale: isValidCutoffs(stored.scale) ? stored.scale : null, // null = default scale
    };
  }

  /** value null/''/NaN clears the weight. Weights are percentages of the course, 0-100. */
  function setWeight(settings, id, value) {
    const weights = { ...(settings.weights || {}) };
    const n = value === null || value === '' || value === undefined ? NaN : Number(value);
    if (!Number.isFinite(n) || n < 0) delete weights[id];
    else weights[id] = round2(Math.min(100, n));
    return { ...settings, weights };
  }

  function setCourseSetting(settings, courseName, patch) {
    const prev = (settings.courses && settings.courses[courseName]) || {};
    const next = { ...prev };
    if (patch.target !== undefined) next.target = Math.min(100, Math.max(0, Math.round(Number(patch.target) * 10) / 10));
    if (patch.credits !== undefined) next.credits = Math.min(30, Math.max(0.5, Math.round(Number(patch.credits) * 2) / 2));
    if (patch.scale !== undefined) {
      if (patch.scale === null) delete next.scale;
      else if (isValidCutoffs(patch.scale)) next.scale = patch.scale.slice();
    }
    return { ...settings, courses: { ...(settings.courses || {}), [courseName]: next } };
  }

  /** Validates and merges a settings file (e.g. from tools/import-vault-grades.mjs). */
  function importSettings(settings, parsed) {
    let next = { weights: { ...(settings.weights || {}) }, courses: { ...(settings.courses || {}) } };
    const stats = { weights: 0, courses: 0, ignored: 0 };
    if (!parsed || typeof parsed !== 'object') return { settings: next, stats: { ...stats, ignored: 1 } };
    Object.entries(parsed.weights || {}).forEach(([id, v]) => {
      if (/^(moodle|gi):\d+$/.test(id) && typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100) {
        next = setWeight(next, id, v);
        stats.weights++;
      } else stats.ignored++;
    });
    Object.entries(parsed.courses || {}).forEach(([name, c]) => {
      if (!name || !c || typeof c !== 'object') { stats.ignored++; return; }
      const patch = {};
      if (typeof c.target === 'number' && c.target >= 0 && c.target <= 100) patch.target = c.target;
      if (typeof c.credits === 'number' && c.credits > 0 && c.credits <= 30) patch.credits = c.credits;
      if (isValidCutoffs(c.scale)) patch.scale = c.scale;
      if (!Object.keys(patch).length) { stats.ignored++; return; }
      next = setCourseSetting(next, name, patch);
      stats.courses++;
    });
    return { settings: next, stats };
  }

  /* ---------------- the grade store (Moodle-owned) ---------------- */

  /** Replaces the sync's courses in the store, keeps others (e.g. a course deselected since). */
  function mergeGrades(store, incoming, nowMs) {
    const courses = { ...((store && store.courses) || {}) };
    (incoming || []).forEach((g) => {
      courses[g.course] = { courseId: g.courseId, total: g.total === undefined ? null : g.total, items: g.items || [], syncedAt: nowMs };
    });
    return { syncedAt: nowMs, courses };
  }

  /* ---------------- entries and the grade math ---------------- */

  /**
   * One course's rows: everything Moodle's gradebook lists, plus imported items
   * the gradebook does not list (no due date, hidden, or the grade report was
   * unavailable). Graded = has a score. Coming up = no score yet.
   */
  function buildEntries(courseName, items, gradesCourse) {
    const key = normalize(courseName);
    const own = (items || []).filter((it) => it && it.source && it.source.type === 'moodle' && !it.archived && normalize(it.course) === key);
    const byId = new Map(own.map((it) => [it.id, it]));
    const entries = [];
    const seen = new Set();
    ((gradesCourse && gradesCourse.items) || []).forEach((g) => {
      const it = byId.get(g.id);
      entries.push({
        id: g.id, name: g.name || (it && it.title) || 'Grade item', kind: g.kind || (it && it.source.kind) || 'other',
        pct: g.pct === undefined ? null : g.pct, max: g.max || null, feedback: g.feedback || '', gradedTs: g.gradedTs || null,
        weightSuggested: g.weightSuggested || null, due: it ? it.due : null, submitted: it ? !!it.completed : false,
      });
      seen.add(g.id);
    });
    own.forEach((it) => {
      if (seen.has(it.id)) return;
      entries.push({
        id: it.id, name: it.title, kind: it.source.kind || 'other', pct: null, max: null, feedback: '', gradedTs: null,
        weightSuggested: null, due: it.due, submitted: !!it.completed,
      });
    });
    const byDue = (a, b) => (a.due || '9999-99-99').localeCompare(b.due || '9999-99-99') || a.name.localeCompare(b.name);
    return {
      coming: entries.filter((e) => e.pct === null).sort(byDue),
      graded: entries.filter((e) => e.pct !== null).sort((a, b) => (b.gradedTs || 0) - (a.gradedTs || 0) || a.name.localeCompare(b.name)),
    };
  }

  /**
   * Current grade and what the rest of the course has to look like to hit the target.
   *   gradedWeight    sum of weights of graded work
   *   earned          course-grade points already banked (out of 100)
   *   remainingWeight 100 - gradedWeight: the part of the course not yet graded
   *   needed          average % required on the remaining weight to reach the target
   *   outlook         'secured' | 'reachable' | 'out-of-reach' | 'complete' | 'unknown'
   * If no graded item has a weight yet, falls back to Moodle's own course total.
   */
  function computeCourse(entries, weights, opts) {
    const { target, moodleTotal = null } = opts;
    let gradedW = 0;
    let earned = 0;
    let totalW = 0;
    let unweightedGraded = 0;
    entries.forEach((e) => {
      const w = Number((weights || {})[e.id]);
      const hasW = Number.isFinite(w) && w > 0;
      if (hasW) totalW += w;
      if (e.pct !== null && e.pct !== undefined) {
        if (hasW) { gradedW += w; earned += (w * e.pct) / 100; } else unweightedGraded++;
      }
    });
    const remaining = Math.max(0, 100 - gradedW);
    let currentPct = null;
    let source = 'none';
    if (gradedW > 0) { currentPct = round2((earned / gradedW) * 100); source = 'weights'; }
    else if (moodleTotal !== null && moodleTotal !== undefined) { currentPct = round2(moodleTotal); source = 'moodle'; }

    let needed = null;
    let maxPossible = null;
    let outlook = 'unknown';
    if (source === 'weights') {
      if (remaining < 0.0001) outlook = 'complete';
      else {
        needed = round1(((target - earned) * 100) / remaining);
        maxPossible = round1(earned + remaining);
        outlook = needed <= 0 ? 'secured' : needed > 100 ? 'out-of-reach' : 'reachable';
      }
    }
    return {
      currentPct, source, gradedWeight: round2(gradedW), earned: round2(earned), remainingWeight: round2(remaining),
      totalWeight: round2(totalW), needed, maxPossible, outlook, unweightedGraded, overweight: totalW > 100.5,
    };
  }

  /** Credit-weighted GPA over courses that have a current grade. rows: [{pct, credits, scale}] */
  function gpa(rows) {
    let pts = 0;
    let credits = 0;
    rows.forEach((r) => {
      const letter = letterFor(r.pct, r.scale);
      const p = letter ? gpaPoints(letter) : null;
      if (p === null || !(r.credits > 0)) return;
      pts += p * r.credits;
      credits += r.credits;
    });
    return credits > 0 ? { gpa: Math.round((pts / credits) * 100) / 100, courses: rows.filter((r) => r.pct !== null).length, credits } : { gpa: null, courses: 0, credits: 0 };
  }

  /**
   * The Courses tab: one row per course that has Moodle data (imported items or
   * grade report), plus the credit-weighted GPA over their current grades.
   * `next` is the soonest unsubmitted item that is not overdue.
   */
  function overview(ctx) {
    const { courses, items, store, settings, colorFor, today } = ctx;
    const rows = [];
    (courses || []).forEach((c) => {
      const gradesCourse = store && store.courses ? store.courses[c.name] : null;
      const entries = buildEntries(c.name, items, gradesCourse);
      if (!gradesCourse && !entries.coming.length) return;
      const cs = courseSettings(settings, c.name);
      const calc = computeCourse(entries.graded.concat(entries.coming), (settings && settings.weights) || {}, {
        target: cs.target, moodleTotal: gradesCourse && gradesCourse.total !== undefined ? gradesCourse.total : null,
      });
      rows.push({
        name: c.name, color: colorFor ? colorFor(c.name) : null, pct: calc.currentPct,
        letter: letterFor(calc.currentPct, cs.scale), target: cs.target, credits: cs.credits, scale: cs.scale,
        source: calc.source, outlook: calc.outlook,
        next: entries.coming.find((e) => e.due && e.due >= today && !e.submitted) || null,
      });
    });
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return { rows, gpa: gpa(rows.map((r) => ({ pct: r.pct, credits: r.credits, scale: r.scale }))) };
  }

  global.TPGrades = {
    DEFAULTS, DEFAULT_CUTOFFS, LETTERS, normalize,
    letterFor, gpaPoints, scaleFromCutoffs, isValidCutoffs,
    emptySettings, courseSettings, setWeight, setCourseSetting, importSettings,
    mergeGrades, buildEntries, computeCourse, gpa, overview,
  };
})(typeof window !== 'undefined' ? window : globalThis);
