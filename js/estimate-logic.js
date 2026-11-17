/* estimate-logic.js — how long will this take? (Phase 3 heuristic estimator)

   Pure functions (no DOM, no network), tested in test/estimate-logic.test.js.

   HONEST STATUS: this is a rule-of-thumb prior, not a measurement. The numbers
   below are educated guesses, chosen to be sensible and easy to change. It exists
   so every imported assignment has *some* estimate on day one; the plan replaces
   the guesswork with an LLM read of the description (Phase 4) and, later, with
   your own logged times. The range is deliberately wide to say so: a tight
   range with no evidence behind it would be false precision.

   Layers (docs/PLAN-moodle-import.md, section 5):
     quiz with a Moodle time limit -> 'quiz-limit'  (limit is known; study time is a guess)
     everything else               -> 'heuristic'
     the user's own number         -> 'user'        (always wins; see userEstimate)
*/
(function (global) {
  const PART_MIN = 50;   // target length of one "part" an assignment is split into
  const MAX_PARTS = 8;
  const MIN_MIN = 15;
  const MAX_MIN = 600;

  const round5 = (n) => Math.round(n / 5) * 5;
  const clampMin = (n) => Math.min(MAX_MIN, Math.max(MIN_MIN, round5(n)));
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  const EXAM = /\b(exam|midterm|final|test)\b/i;
  const HEAVY = /\b(project|paper|essay|report|presentation|portfolio|research|thesis|proposal|write-?up)\b/i;
  const LIGHT = /\b(reading|response|reflection|discussion|journal|check-?in|survey|attendance|participation|forum|syllabus|introduction)\b/i;

  function countWords(text) {
    const t = String(text || '').trim();
    return t ? t.split(/\s+/).length : 0;
  }

  /**
   * rec: { kind: 'assign'|'quiz', title, points, description, files[], timeLimitMin, wordLimit }
   * -> { minutes, low, high, basis, confidence, factors[] }   (minutes rounded to 5)
   */
  function estimateRecord(rec) {
    const title = String((rec && rec.title) || '');
    const factors = [];

    if (rec && rec.kind === 'quiz') {
      const limit = rec.timeLimitMin > 0 ? rec.timeLimitMin : null;
      const take = limit || 30;
      const exam = EXAM.test(title);
      const prep = exam ? clamp(take * 2, 60, 240) : clamp(take, 15, 60);
      factors.push(limit ? `${limit} min time limit` : 'no time limit given, assumed 30 min');
      factors.push(`${prep} min of studying`);
      return {
        minutes: clampMin(take + prep),
        low: clampMin(take + prep * 0.25),
        high: clampMin(take + prep * 2),
        basis: limit ? 'quiz-limit' : 'heuristic',
        confidence: limit ? 'medium' : 'low',
        factors,
      };
    }

    const points = rec && rec.points > 0 ? rec.points : null;
    let base = points === null ? 60 : points <= 10 ? 30 : points <= 25 ? 45 : points <= 50 ? 75 : points <= 100 ? 120 : 180;
    factors.push(points === null ? 'no point value' : `${points} points`);

    if (EXAM.test(title)) { base = Math.max(base, 240); factors.push('an exam or big test'); }
    else if (HEAVY.test(title)) { base = Math.max(base, 150); factors.push('writing or project work'); }
    else if (LIGHT.test(title)) { base *= 0.6; factors.push('a lighter task (reading or a short response)'); }

    const words = countWords(rec && rec.description);
    const lengthFactor = words < 30 ? 0.85 : words < 120 ? 1 : words < 300 ? 1.2 : 1.4;
    factors.push(words < 30 ? 'a short description' : words < 120 ? 'a normal-length description' : words < 300 ? 'a detailed description' : 'a long, detailed description');
    let minutes = base * lengthFactor;

    if (rec && rec.files && rec.files.length) { minutes += 15; factors.push('has a handout to read'); }
    if (rec && rec.wordLimit > 0) {
      const writing = Math.round(rec.wordLimit / 10) + 20; // ~10 words a minute including thinking
      if (writing > minutes) minutes = writing;
      factors.push(`${rec.wordLimit}-word limit`);
    }
    minutes = clampMin(minutes);
    return { minutes, low: clampMin(minutes * 0.7), high: clampMin(minutes * 1.5), basis: 'heuristic', confidence: 'low', factors };
  }

  /** Estimate for an imported item: title lives on the item, Moodle details on `source`. */
  function estimateForItem(item) {
    const s = (item && item.source) || {};
    return estimateRecord({
      kind: s.kind, title: item && item.title, points: s.points, description: s.description, files: s.files,
      timeLimitMin: s.timeLimitMin, wordLimit: s.wordLimit,
    });
  }

  /** The user's own number. No range: they decided. */
  function userEstimate(minutes) {
    const m = clamp(Math.round(Number(minutes) / 5) * 5, MIN_MIN, MAX_MIN);
    return { minutes: m, low: m, high: m, basis: 'user', confidence: 'high', factors: ['set by you'] };
  }

  /** How many parts a piece of work is split into for daily pacing. A quiz is one sitting. */
  function partsFor(minutes, kind) {
    if (kind === 'quiz') return 1;
    return clamp(Math.round(minutes / PART_MIN), 1, MAX_PARTS);
  }

  function sameEstimate(a, b) {
    if (!a || !b) return false;
    return a.minutes === b.minutes && a.low === b.low && a.high === b.high && a.basis === b.basis;
  }

  /**
   * Returns a NEW item carrying `est`. An imported item that has no progress yet is
   * re-split into parts for the new estimate; one with progress keeps its parts
   * (the minutes per part just change), so logged progress is never reinterpreted.
   */
  function withEstimate(item, est) {
    const next = { ...item, estimate: est };
    const imported = item.source && item.source.type === 'moodle';
    const untouched = !(item.done > 0) && !(item.today > 0) && !item.completed;
    if (imported && untouched) {
      const n = partsFor(est.minutes, item.source.kind);
      next.total = n;
      next.unit = n > 1 ? 'part' : (item.source.kind === 'quiz' ? 'quiz' : 'assignment');
    }
    return next;
  }

  global.TPEstimate = { PART_MIN, MAX_PARTS, MIN_MIN, MAX_MIN, countWords, estimateRecord, estimateForItem, userEstimate, partsFor, sameEstimate, withEstimate };
})(typeof window !== 'undefined' ? window : globalThis);
