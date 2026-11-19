/* learning.js - uses how long you REALLY took to adjust estimates for SIMILAR work (pure; tested in test/learning.test.js).

   When you finish an assignment you can say how long it took. That time is kept with the estimate the item
   had (item.actual = {minutes, est, at}). A new assignment is "similar" to a finished one when it is in the
   same course, the same kind (assignment or quiz) and has the same title once numbers are removed: "Journal &
   Reflection #1..#3" are similar to "#4"; an essay in the same course is not. If at least MIN_SIMILAR similar
   ones are finished, the new one's estimate is scaled by the median of (actual / estimate) over them. Nothing
   else is scaled: an estimate you set yourself, a quiz's time limit, and work with no similar finished work
   keep their own number. The original number is kept (estimate.raw) so the adjustment can be undone when
   the data changes, and the screen can say where the number came from (estimate.learned). */
(function (global) {
  const MIN_SIMILAR = 2;
  const F_MIN = 0.3;
  const F_MAX = 3;
  const IGNORE_NEAR_ONE = 0.1; // a factor within 10% of 1 is not worth showing as "adjusted"

  const round5 = (n) => Math.round(n / 5) * 5;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  /** "Journal & Reflection #4" -> "journal & reflection"; "Assignment 11" -> "assignment". */
  function stem(title) {
    return String(title == null ? '' : title)
      .toLowerCase()
      .replace(/&amp;/g, '&')
      .replace(/#\s*\d+/g, ' ')
      .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\s+([:,;.])/g, '$1')
      .replace(/[\s:\u2013\u2014-]+$/g, '')
      .trim();
  }

  /** The same stem for display ("Journal & Reflection"). */
  function label(title) {
    return String(title == null ? '' : title).replace(/&amp;/g, '&').replace(/#\s*\d+/g, ' ').replace(/\b\d+(?:\.\d+)?\b/g, ' ').replace(/\s+/g, ' ').replace(/\s+([:,;.])/g, '$1').replace(/[\s:\u2013\u2014-]+$/g, '').trim();
  }

  /** What "similar" means: '' when the title is too short to compare. */
  function keyOf(it) {
    if (!it) return '';
    const s = stem(it.title);
    if (s.length < 3) return '';
    return (it.course || '').trim().toLowerCase() + '|' + ((it.source && it.source.kind) || 'assign') + '|' + s;
  }

  // Moodle work and work added by hand with the new Add sheet both learn from what you took.
  const isImported = (it) => !!(it && it.source && (it.source.type === 'moodle' || it.source.type === 'manual'));

  /** The estimate before any adjustment from your own times. */
  function rawEstimate(it) {
    const e = it && it.estimate;
    if (!e) return null;
    return e.raw ? e.raw : { minutes: e.minutes, low: e.low, high: e.high, steps: e.steps };
  }

  /** Is it worth asking how long this took? Only when it had an estimate to compare with. */
  function canAsk(it) {
    const r = rawEstimate(it);
    return !!(r && r.minutes > 0);
  }

  /** Records how long an item took, along with the estimate it had. Returns the actual record. */
  function recordActual(it, minutes, now) {
    const r = rawEstimate(it);
    const m = Math.round(Number(minutes));
    if (!(m > 0) || !r) return null;
    it.actual = { minutes: Math.min(m, 24 * 60), est: r.minutes, at: now || Date.now() };
    return it.actual;
  }

  function median(xs) {
    const s = xs.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /** Finished work with your own times, as {title, minutes, sameCourse}: what the AI is shown (nothing else). */
  function pastWork(item, items, max) {
    const course = ((item && item.course) || '').trim().toLowerCase();
    return (items || [])
      .filter((o) => o && o !== item && o.id !== (item && item.id) && o.actual && o.actual.minutes > 0 && o.title)
      .map((o) => ({ title: String(o.title), minutes: Math.round(o.actual.minutes), at: o.actual.at || 0, sameCourse: ((o.course || '').trim().toLowerCase()) === course }))
      .sort((a, b) => (b.sameCourse - a.sameCourse) || (b.at - a.at))
      .slice(0, max || 12)
      .map(({ title, minutes, sameCourse }) => ({ title, minutes, sameCourse }));
  }

  /** {factor, n, label} for an item from finished similar work, or null. */
  function learnedFactor(item, items) {
    const key = keyOf(item);
    if (!key) return null;
    const ratios = [];
    (items || []).forEach((o) => {
      if (!o || o === item || o.id === item.id || !o.actual || !(o.actual.minutes > 0) || !(o.actual.est > 0)) return;
      if (keyOf(o) !== key) return;
      ratios.push(o.actual.minutes / o.actual.est);
    });
    if (ratios.length < MIN_SIMILAR) return null;
    const factor = clamp(median(ratios), F_MIN, F_MAX);
    return { factor: Math.round(factor * 100) / 100, n: ratios.length, label: label(item.title) };
  }

  /**
   * Brings every open imported item's estimate in line with the finished similar work. Idempotent. Mutates the
   * items; returns true if anything changed.
   */
  function applyLearning(items) {
    const E = global.TPEstimate;
    if (!E) return false;
    let changed = false;
    (items || []).forEach((it) => {
      if (!isImported(it) || it.completed || it.archived || !it.estimate) return;
      const est = it.estimate;
      if (est.basis !== 'heuristic' && est.basis !== 'model') return; // your own number and quiz limits stand
      if (est.basis === 'model' && est.usedHistory) return; // the AI already weighed your finished work
      const raw = rawEstimate(it);
      if (!raw || !(raw.minutes > 0)) return;
      const f = learnedFactor(it, items);
      const useIt = f && Math.abs(f.factor - 1) >= IGNORE_NEAR_ONE;
      if (useIt) {
        const minutes = clamp(round5(raw.minutes * f.factor), E.MIN_MIN, E.MAX_MIN);
        if (est.learned && est.minutes === minutes && est.learned.n === f.n && est.learned.factor === f.factor) return;
        const scale = (v) => clamp(round5((v || raw.minutes) * f.factor), E.MIN_MIN, E.MAX_MIN);
        const next = { ...est, minutes, low: Math.min(scale(raw.low), minutes), high: Math.max(scale(raw.high), minutes),
          steps: E.scaleSteps(raw.steps, minutes), raw, learned: f };
        Object.assign(it, E.withEstimate(it, next));
        changed = true;
      } else if (est.learned) {
        const next = { ...est, minutes: raw.minutes, low: raw.low, high: raw.high, steps: raw.steps || [] };
        delete next.raw;
        delete next.learned;
        Object.assign(it, E.withEstimate(it, next));
        changed = true;
      }
    });
    return changed;
  }

  /**
   * Re-fits untouched, not-your-own plans to the days left: never more parts than days you can work. Idempotent.
   * (A plan you edited yourself, or any item with progress, is never touched.)
   */
  function refitParts(items) {
    const E = global.TPEstimate;
    let changed = false;
    (items || []).forEach((it) => {
      if (!isImported(it) || it.completed || it.archived || !it.due || !it.estimate || it.estimate.basis === 'user') return;
      if (it.done > 0 || it.today > 0 || !(it.total > E.maxParts(it))) return;
      Object.assign(it, E.withEstimate(it, it.estimate));
      if (!(it.total > 1)) delete it.dailyTarget; // its old per-day target was for more parts
      changed = true;
    });
    return changed;
  }

  global.TPLearn = { refitParts, MIN_SIMILAR, stem, label, keyOf, rawEstimate, canAsk, recordActual, pastWork, learnedFactor, applyLearning };
})(typeof window !== 'undefined' ? window : globalThis);
