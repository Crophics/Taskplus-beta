/* item-logic.js — Prerequisite lock/unlock logic */
(function (global) {
  function isLocked(items, it) {
    if (!it.dependsOn) return false;
    const prereq = items.find((x) => x.title === it.dependsOn);
    return prereq ? !prereq.completed : false;
  }

  function unlockedToday(items, it, today) {
    if (!it.dependsOn) return false;
    const prereq = items.find((x) => x.title === it.dependsOn);
    return !!(prereq && prereq.completed && prereq.completedAt === today());
  }

  /**
   * Work the daily plan paces: it has a due date and the user has not chosen to ignore it. Work with no
   * due date (Moodle assignments without one) is listed but never paced; ignored work is overdue work the
   * user wrote off. Both stay out of Today, Week, the plan and the overdue counts.
   * (today-logic, week-logic and plan-logic keep a one-line copy of this, as they load without this file.)
   */
  function isPlanned(it) {
    return !!(it && it.due) && !it.ignored;
  }

  global.TPItemLogic = { isLocked, unlockedToday, isPlanned };
})(typeof window !== 'undefined' ? window : globalThis);