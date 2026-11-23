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
     Claude's read of the description -> 'model'    (src/estimate.mjs; replaces 'heuristic', adds named steps)
     the user's own number         -> 'user'        (always wins; see userEstimate)
*/
(function (global) {
  const PART_MIN = 90;   // one sitting: work up to about this long is one part; longer work gets one part per ~90 minutes (parts are days)
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

  // A short, stable fingerprint of everything an estimate depends on. It is stored on the estimate
  // so a sync can tell "Moodle changed this assignment" (ask again) from "same assignment" (keep).
  function hash32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  function inputsKey(item) {
    const s = (item && item.source) || {};
    return hash32(JSON.stringify([
      item && item.title, s.kind, s.points, s.description, (s.files || []).map((f) => [f.name, f.size, f.modified]),
      s.timeLimitMin, s.wordLimit, s.submissionTypes || [],
    ]));
  }

  /** Estimate for an imported item: title lives on the item, Moodle details on `source`. */
  function estimateForItem(item) {
    const s = (item && item.source) || {};
    const est = estimateRecord({
      kind: s.kind, title: item && item.title, points: s.points, description: s.description, files: s.files,
      timeLimitMin: s.timeLimitMin, wordLimit: s.wordLimit,
    });
    est.key = inputsKey(item);
    return est;
  }

  /**
   * Scales named steps to a new total, keeping the names and the count (so an item's parts
   * stay valid). Returns [] if the steps cannot fit (each needs at least 5 minutes).
   */
  function scaleSteps(steps, minutes) {
    if (!Array.isArray(steps) || !steps.length || steps.length * 5 > minutes) return [];
    const total = steps.reduce((s, x) => s + x.minutes, 0);
    if (!(total > 0)) return [];
    const out = steps.map((x) => ({ name: x.name, minutes: Math.max(5, round5((x.minutes / total) * minutes)) }));
    const diff = minutes - out.reduce((s, x) => s + x.minutes, 0);
    const big = out.reduce((a, b) => (b.minutes > a.minutes ? b : a));
    big.minutes = Math.max(5, big.minutes + diff);
    return out;
  }

  /** The user's own number. No range: they decided. Named steps (if any) are rescaled, not lost. */
  function userEstimate(minutes, steps) {
    const m = clamp(Math.round(Number(minutes) / 5) * 5, MIN_MIN, MAX_MIN);
    return { minutes: m, low: m, high: m, basis: 'user', confidence: 'high', factors: ['set by you'], steps: scaleSteps(steps, m) };
  }

  /**
   * Claude's answer (already validated by the server) as an estimate. A quiz is one sitting,
   * so it keeps the minutes but not the steps.
   */
  function fromModel(result, key, kind, opts) {
    const f = result.files || { read: [], skipped: [], retry: false };
    return {
      minutes: result.minutes, low: result.low, high: result.high, basis: 'model',
      // Which service made it, so the screen can say so ('' for estimates saved before this was recorded).
      provider: result.provider === 'claude' || result.provider === 'gemini' ? result.provider : '',
      usedHistory: Number(result.pastCount) > 0, // the AI was shown your finished work and times
      confidence: result.confidence || 'low', factors: result.rationale ? [result.rationale] : [],
      steps: kind === 'quiz' ? [] : (result.steps || []).map((s) => ({ name: s.name, minutes: s.minutes })), key,
      // Which handouts Claude read (the server's report), which it could not, and whether reading them
      // was attempted for good: a temporary failure ("retry") is not "asked", so it is tried again later.
      filesRead: f.read || [], filesSkipped: f.skipped || [], filesAsked: !!(opts && opts.readFiles) && !f.retry,
    };
  }

  /** Named steps are only trusted while there is exactly one per part. */
  function stepsUsable(item) {
    const st = item && item.estimate && item.estimate.steps;
    return Array.isArray(st) && st.length > 0 && st.length === (item.total || 1);
  }

  function stepName(item, index) {
    return stepsUsable(item) && item.estimate.steps[index] ? item.estimate.steps[index].name : null;
  }

  /**
   * How many parts a piece of work is split into for daily pacing. A quiz is one sitting. When
   * Claude named the steps, each step is a part; otherwise parts are ~50 minutes each.
   */
  function partsFor(minutes, kind, steps) {
    if (kind === 'quiz') return 1;
    if (Array.isArray(steps) && steps.length) return clamp(steps.length, 1, MAX_PARTS);
    return clamp(Math.round(minutes / PART_MIN), 1, MAX_PARTS);
  }

  /** Merges the tail of a step list so there are at most `n` steps (the extra ones are folded into the last kept). */
  function capSteps(steps, n) {
    if (!Array.isArray(steps) || steps.length <= n) return steps;
    const keep = steps.slice(0, n).map((s) => ({ name: s.name, minutes: s.minutes }));
    const tail = steps.slice(n);
    const last = keep[n - 1];
    last.minutes += tail.reduce((s, x) => s + x.minutes, 0);
    last.name = [last.name, ...tail.map((x) => x.name)].join(' + ').slice(0, 60);
    return keep;
  }

  /** Parts are done on separate days, so there can be no more of them than days you can work before it is due. */
  function maxParts(item) {
    const D = global.TPDue;
    if (!D || !item || !item.due) return MAX_PARTS;
    const t = global.TP && global.TP.today ? global.TP.today() : null;
    if (!t) return MAX_PARTS;
    const dueIn = Math.round((new Date(item.due + 'T00:00:00') - new Date(t + 'T00:00:00')) / 86400000);
    return Math.max(1, Math.min(MAX_PARTS, Math.ceil(D.workDays(item, dueIn) - 1e-9)));
  }

  function sameEstimate(a, b) {
    if (!a || !b) return false;
    return a.minutes === b.minutes && a.low === b.low && a.high === b.high && a.basis === b.basis && a.key === b.key;
  }

  /** Work that gets estimates and parts: imported from Moodle, or added by hand with the new Add sheet (source.type 'manual'). */
  function isEstimable(item) {
    const t = item && item.source && item.source.type;
    return t === 'moodle' || t === 'manual';
  }

  /**
   * An unfinished, dated item from before the new Add sheet: no `source`, an amount + unit instead of an estimate.
   * (Production Taskplus also makes items like this, so they can keep arriving.)
   */
  function isLegacyManual(item) {
    return !!(item && !item.source && !item.completed && !item.archived && item.title && item.due);
  }

  /**
   * The same item in the new model, or null when it does not need converting: it gets `source.type 'manual'`, its own
   * minutes if you set them (else a rule-of-thumb estimate from the title), and, when it has no progress yet, parts
   * like any other estimable work (the amount and unit are replaced). With progress the parts count stays, so what you
   * logged still means the same. Notes, subtasks, repeat and dependency stay on the item.
   */
  function convertLegacy(item) {
    if (!isLegacyManual(item)) return null;
    const base = { ...item, source: { type: 'manual', kind: 'assign', description: item.description || '' } };
    delete base.description;
    const cur = item.estimate;
    const est = cur && cur.basis === 'user' ? cur : estimateForItem(base);
    const next = withEstimate(base, est);
    if (next.total !== item.total || next.unit !== item.unit) delete next.dailyTarget; // its per-day target was for the old amount
    return next;
  }

  /**
   * Returns a NEW item carrying `est`. An imported item that has no progress yet is
   * re-split into parts for the new estimate; one with progress keeps its parts
   * (the minutes per part just change), so logged progress is never reinterpreted.
   */
  function withEstimate(item, est) {
    const next = { ...item, estimate: est };
    const imported = isEstimable(item);
    const untouched = !(item.done > 0) && !(item.today > 0) && !item.completed;
    // No due date means no days to spread parts over, so undated work stays one piece.
    if (imported && untouched && item.due) {
      let n = partsFor(est.minutes, item.source.kind, est.steps);
      const cap = maxParts(item);
      if (n > cap) {
        n = cap;
        if (Array.isArray(est.steps) && est.steps.length > cap) next.estimate = { ...est, steps: capSteps(est.steps, cap) };
      }
      next.total = n;
      next.unit = n > 1 ? 'part' : (item.source.kind === 'quiz' ? 'quiz' : 'assignment');
    }
    return next;
  }

  /* ---- Your own plan: you choose the parts, their names and their minutes ---- */
  const round5p = (n) => Math.round(n / 5) * 5;

  /** The rows an editor starts from: the named steps, or the minutes spread evenly over the current parts. */
  function planRows(item) {
    if (stepsUsable(item)) return item.estimate.steps.map((s) => ({ name: s.name, minutes: s.minutes }));
    const n = Math.max((item && item.total) || 1, 1);
    const total = (item && item.estimate && item.estimate.minutes) || PART_MIN * n;
    const each = Math.max(5, round5p(total / n));
    return Array.from({ length: n }, (_, i) => ({ name: `Part ${i + 1}`, minutes: each }));
  }

  /** Cleans edited rows into steps, or says what is wrong: {steps} or {error}. */
  function checkPlan(rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return { error: 'A plan needs at least one part.' };
    if (list.length > MAX_PARTS) return { error: `A plan can have at most ${MAX_PARTS} parts.` };
    const steps = list.map((r, i) => ({
      name: String((r && r.name) || '').replace(/\s+/g, ' ').trim().slice(0, 60) || `Part ${i + 1}`,
      minutes: Math.min(MAX_MIN, Math.max(5, round5p(Number(r && r.minutes) || 0))),
    }));
    const total = steps.reduce((s, x) => s + x.minutes, 0);
    if (total > MAX_MIN) return { error: `The parts add up to more than ${MAX_MIN / 60} hours. Make some shorter.` };
    return { steps };
  }

  /** A NEW item carrying your plan: one part per step, your own estimate (the sum), progress kept. */
  function withPlan(item, steps) {
    const total = steps.reduce((s, x) => s + x.minutes, 0);
    const n = steps.length;
    const next = {
      ...item,
      estimate: { minutes: total, low: total, high: total, basis: 'user', confidence: 'high', factors: ['set by you'], steps: steps.map((s) => ({ name: s.name, minutes: s.minutes })) },
      total: n,
      unit: n > 1 ? 'part' : (item.source && item.source.kind === 'quiz' ? 'quiz' : 'assignment'),
    };
    if (!item.completed && (next.done || 0) >= n) next.done = Math.max(n - 1, 0);
    return next;
  }

  global.TPEstimate = { isLegacyManual, convertLegacy, isEstimable, capSteps, maxParts, planRows, checkPlan, withPlan, PART_MIN, MAX_PARTS, MIN_MIN, MAX_MIN, countWords, estimateRecord, estimateForItem, inputsKey, scaleSteps, userEstimate, fromModel, stepsUsable, stepName, partsFor, sameEstimate, withEstimate };
})(typeof window !== 'undefined' ? window : globalThis);
