/* due-time.js - what a due TIME means for planning (pure; tested in test/due-time.test.js).

   Moodle sends a due date AND time. The planners used to look at the date only: the due day itself
   was never a work day, so everything was planned to finish the day before. That is too strict for
   work due late in the day and too loose for work due early. The rule (the user's, 2026-11-18):

     - Due BEFORE 12:00 on the due day: you will not do it that morning. The last work day is the day
       before, exactly as before.
     - Due AT OR AFTER 12:00 on the due day: the morning of the due day is a (short) work day. A
       multi-part item can be split between the day before and that morning; a single-part item may
       be finished that morning, so it is not required the day before.

   The morning counts as DUE_DAY_SHARE of a day (a guess; one number to change if it feels off).
   Items with no due time (manual items, or old imports) keep the old behaviour. */
(function (global) {
  const NOON = 12 * 60;
  const DUE_DAY_SHARE = 0.5;

  const pad = (n) => String(n).padStart(2, '0');

  /** Local 'HH:MM' of a unix timestamp in seconds. */
  function timeOf(ts) {
    const d = new Date(ts * 1000);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function minutesOf(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  /** True when the item is due at or after 12:00, so the due day's morning can be used. */
  function morningUsable(it) {
    const m = minutesOf(it && it.dueTime);
    return m !== null && m >= NOON;
  }

  /**
   * Work days available to a multi-part item that is `dueIn` days away (the old rule: max(dueIn, 1)),
   * plus the due-day morning when it can be used. Due today or overdue is one day: all of it today.
   */
  function workDays(it, dueIn) {
    if (!(dueIn >= 1)) return 1;
    return dueIn + (morningUsable(it) ? DUE_DAY_SHARE : 0);
  }

  /**
   * The last day (days from today) a single-part item should be done by: the day before it is due,
   * or the due day itself when it is due at or after 12:00. Never earlier than today.
   */
  function singleLastDay(it, dueIn) {
    return Math.max(morningUsable(it) && dueIn >= 1 ? dueIn : dueIn - 1, 0);
  }

  /** '09:00' -> '9:00 AM', '23:59' -> '11:59 PM', '00:00' -> '12:00 AM'. '' when unknown. */
  function fmtTime(hhmm) {
    const m = minutesOf(hhmm);
    if (m === null) return '';
    const h = Math.floor(m / 60);
    return ((h % 12) || 12) + ':' + pad(m % 60) + ' ' + (h < 12 ? 'AM' : 'PM');
  }

  /** "Tomorrow" -> "Tomorrow · 9:00 AM" when the item has a due time. */
  function label(it, relativeDueLabel) {
    const day = relativeDueLabel(it.due);
    const t = it.dueTime ? fmtTime(it.dueTime) : '';
    return day && t ? day + ' · ' + t : day;
  }

  global.TPDue = { NOON, DUE_DAY_SHARE, timeOf, minutesOf, morningUsable, workDays, singleLastDay, fmtTime, label };
})(typeof window !== 'undefined' ? window : globalThis);
