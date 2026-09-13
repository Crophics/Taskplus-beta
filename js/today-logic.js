/* today-logic.js — Today's Targets domain logic

   Pacing model: each item carries a `today` counter (units logged during
   the current calendar day, reset by resetTodayCounters() at load — see
   app.js). dayTarget()/met() below are the mobile design's pacing formulas;
   the bucketing (requiredTight/requiredPace/optionalBuckets/pickBuckets)
   below them is this app's own richer logic for *which* items are on the
   critical path today, kept as-is because it already handles cases (N-of-M
   pick buckets, due-tomorrow catches, no-slack pacing) the simple formulas
   don't address on their own.
*/
(function (global) {
  /** left/target-day-target formulas from the design spec, usable per item. */
  function dayTarget(it) {
    const left = Math.max((it.total || 0) - (it.done || 0), 0);
    if (!(it.total > 1)) return left ? 1 : 0; // no daily target: binary single-part item
    const amt = it.dailyTarget && it.dailyTarget.amt != null ? it.dailyTarget.amt : 0;
    return Math.min(left + (it.today || 0), amt);
  }

  function met(it) {
    return (it.today || 0) >= dayTarget(it);
  }

  /**
   * Resets every item's `today` counter to 0 the first time the app loads
   * on a new calendar day. Returns true if anything changed (caller should
   * persist). Matches the design README's stated assumption verbatim.
   */
  function resetTodayCounters(items, storedDate, currentDate) {
    if (storedDate === currentDate) return false;
    (items || []).forEach((it) => {
      if (it.today) it.today = 0;
    });
    return true;
  }

  function computeTodayPanel(ctx) {
    const { items, storageKey: KEY, isLocked, unlockedToday, today, daysBetween } = ctx;
  const active = items.filter(x=>!x.completed && !x.archived && !isLocked(x) && !unlockedToday(x));
  const multi = active.filter(it=>it.total>1);
  const singles = active.filter(it=>it.total<=1 && it.done<it.total);

  let dailyTargetsChanged = false;
  multi.forEach(it=>{
    const t = today();
    const dt = it.dailyTarget;
    if(!dt || dt.date!==t || dt.total!==it.total || dt.due!==it.due){
      const left = Math.max(it.total-it.done,0);
      const daysLeft = Math.max(daysBetween(t, it.due),1);
      it.dailyTarget = {
        date: t, total: it.total, due: it.due,
        amt: left>0? Math.ceil(left/daysLeft) : 0
      };
      dailyTargetsChanged = true;
    }
  });
  if(dailyTargetsChanged) localStorage.setItem(KEY, JSON.stringify(items));

  const multiTargetsAll = multi.map(it=>{
    const left = Math.max(it.total-it.done,0);
    const daysLeft = Math.max(daysBetween(today(), it.due),1);
    const progressToday = it.today || 0;
    const remainingToday = Math.max(it.dailyTarget.amt - progressToday, 0);
    return {
      it, title:it.title, unit:it.unit||'units',
      amt: remainingToday,
      today: progressToday,
      met: met(it),
      tight: it.due<=today(),
      overdue: it.due<today(),
      dueToday: it.due===today(),
      noSlack: left>=daysLeft
    };
  });
  const multiTargets = multiTargetsAll.filter(t=>t.amt>0);
  // Required items whose daily target is already met today, but the
  // assignment itself isn't complete yet - these power the mobile design's
  // "Get ahead" done-for-today rows rather than disappearing. Uses the
  // *cached* dailyTarget.amt (fixed for the whole day) rather than live
  // `noSlack`, which can flip false the instant today's progress is logged
  // (less remaining now looks like slack again) even though the item was
  // very much required a moment ago.
  const metRequiredToday = multiTargetsAll.filter(t=>t.it.dailyTarget.amt>0 && t.amt<=0);

  let requiredTight = multiTargets.filter(t=>t.noSlack && t.tight)
    .concat(singles.filter(it=>daysBetween(today(), it.due)<=1) // FIX: Changes <=0 to <=1 to natively catch tomorrow's tasks!
      .map(it=>({
        it,
        title:it.title,
        unit:it.unit||'reading',
        amt:1,
        today: it.today||0,
        met: met(it),
        tight:true,
        overdue: daysBetween(today(), it.due)<0,
        dueToday: it.due===today()
      })))
    .sort((a,b)=> a.it.due.localeCompare(b.it.due));
  const requiredPace = multiTargets.filter(t=>t.noSlack && !t.tight)
    .sort((a,b)=> a.it.due.localeCompare(b.it.due));

  const requiredItemsSet = new Set([...requiredTight.map(t=>t.it), ...requiredPace.map(t=>t.it)]);
  const optionalByDue = new Map();
  function addOptional(due, entry){
    if(!optionalByDue.has(due)) optionalByDue.set(due, []);
    optionalByDue.get(due).push(entry);
  }
  multiTargets.filter(t=>!t.noSlack).forEach(t=>{
    addOptional(t.it.due, {kind:'multi', it:t.it, title:t.title, unit:t.unit, amt:t.amt, today:t.today, met:t.met});
  });
  singles.forEach(it=>{
    if(!requiredItemsSet.has(it)){
      const d = daysBetween(today(), it.due);
      if(d>=0) addOptional(it.due, {kind:'single', it, title:it.title, unit:it.unit||'reading', today: it.today||0, met: met(it)});
    }
  });
  const optionalBuckets = [...optionalByDue.entries()]
    .sort((a,b)=> a[0].localeCompare(b[0]))
    .map(([due, entries])=>{
      const singleCount = entries.filter(e=>e.kind==='single').length;
      const daysAvailable = Math.max(daysBetween(today(), due), 1);
      const pickCount = (singleCount>1 && singleCount===entries.length && singleCount>=daysAvailable)
        ? Math.ceil(singleCount/daysAvailable) : null;
      return {due, entries, pickCount};
    });

  // A bucket where you must pick ALL of its entries (pickCount === entries.length)
  // isn't really an "optional pick" anymore - it's required, so it belongs in
  // the top required section instead of the "do X of these" pick-bucket list.
  // Revert back to the stable design, but add a proper structural check
  // to mark tomorrow's singles as highly urgent inside their layout bucket
  optionalBuckets.filter(b=>b.pickCount && b.pickCount===b.entries.length).forEach(b=>{
    b.entries.forEach(e=>{
      const isOverdue = daysBetween(today(), e.it.due) < 0;
      const isDueToday = e.it.due === today();
      const isDueTomorrow = daysBetween(today(), e.it.due) === 1;

      requiredTight.push({
        it: e.it,
        title: e.title,
        unit: e.unit || 'reading',
        amt: 1,
        today: e.today,
        met: e.met,
        tight: isOverdue || isDueToday || isDueTomorrow, // Forces priority highlight for tomorrow!
        overdue: isOverdue,
        dueToday: isDueToday
      });
    });
  });
  const optionalBucketsFinal = optionalBuckets.filter(b=>!(b.pickCount && b.pickCount===b.entries.length));
  requiredTight = requiredTight.sort((a,b)=> a.it.due.localeCompare(b.it.due));

  const hasRequired = requiredTight.length > 0 || requiredPace.length > 0;
  const pickBuckets = optionalBucketsFinal.filter(b=>b.pickCount);
  const hasPriorAssignmentWork = items.some(it => !it.archived && (
  (!it.completed && (it.createdAt ? it.createdAt < today() : it.due < today())) ||
  (it.completed && it.completedAt === today())
  ));
  // Matches the "You're all set for today" state shown in the Today panel:
  // nothing required, no must-pick optional buckets, and there was actually
  // something to do today in the first place (so an empty planner doesn't
  // read as "day complete").
  const allDoneToday = !hasRequired && pickBuckets.length===0 && hasPriorAssignmentWork;

  return {active, multi, singles, multiTargets, requiredTight, requiredPace, optionalBuckets: optionalBucketsFinal, hasRequired, pickBuckets, hasPriorAssignmentWork, allDoneToday, metRequiredToday};
  }

  function hasTodayWorkRemaining(ctx) {
    const { hasRequired, pickBuckets } = computeTodayPanel(ctx);
    return hasRequired || pickBuckets.length > 0;
  }

  /**
   * Re-buckets computeTodayPanel()'s output into the mobile design's two
   * sections: "Today's Targets" (open, required, not yet met) and "Get
   * ahead" (required-but-already-met items, in their done-for-today state,
   * followed by non-required/non-blocked items).
   */
  function computeTodayScreen(panel) {
    const targets = [...panel.requiredTight, ...panel.requiredPace];
    const optional = [];
    panel.pickBuckets.forEach(b => b.entries.forEach(e => optional.push(e)));
    panel.optionalBuckets.forEach(b => {
      if (b.pickCount) return; // already included via pickBuckets above
      b.entries.forEach(e => optional.push(e));
    });
    return { targets, getAhead: [...panel.metRequiredToday, ...optional] };
  }

  global.TPTodayLogic = { computeTodayPanel, hasTodayWorkRemaining, computeTodayScreen, dayTarget, met, resetTodayCounters };
})(typeof window !== 'undefined' ? window : globalThis);
