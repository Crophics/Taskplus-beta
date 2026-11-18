/* courses.js — Courses collection: {id, name, color}
   Course stays a free-text string on each item (see firebase-sync.js's
   itemKey/contentKey, which key on that string) — this module is a
   parallel collection for color + management, not a foreign key.
*/
(function (global) {
  const PALETTE = ['#1fae8e', '#f0a824', '#e8553c', '#4361ee', '#b83fd1', '#2ea9dd', '#e0538a'];
  const FALLBACK_COLOR = '#595d6c';

  function newCourseId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'tc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function normalize(name) {
    return String(name || '').trim().toLowerCase();
  }

  /**
   * Build the initial courses collection from distinct `course` strings
   * found on existing items, reusing any pre-existing tp-course-colors
   * overrides so a fresh migration doesn't change colors a user already
   * chose under the old free-text scheme.
   */
  function migrateFromItems(items, legacyCourseColors) {
    const seen = new Map(); // normalized -> display name (first-seen casing)
    (items || []).forEach((it) => {
      const raw = (it.course || '').trim();
      if (!raw) return;
      const key = normalize(raw);
      if (!seen.has(key)) seen.set(key, raw);
    });
    const usedColors = new Set();
    const courses = [];
    [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1])).forEach(([key, name]) => {
      let color = (legacyCourseColors || {})[key];
      if (color) usedColors.add(color);
      courses.push({ id: newCourseId(), name, color: color || null });
    });
    courses.forEach((c) => {
      if (c.color) return;
      let assigned = PALETTE.find((p) => !usedColors.has(p));
      if (!assigned) {
        let h = 0;
        for (const ch of c.name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        assigned = PALETTE[h % PALETTE.length];
      }
      c.color = assigned;
      usedColors.add(assigned);
    });
    return courses;
  }

  function nextPaletteColor(courses) {
    const used = new Set((courses || []).map((c) => c.color));
    return PALETTE.find((p) => !used.has(p)) || PALETTE[courses.length % PALETTE.length];
  }

  function byName(courses, name) {
    const key = normalize(name);
    if (!key) return null;
    return (courses || []).find((c) => normalize(c.name) === key) || null;
  }

  /**
   * One entry per course name (case and spacing ignored), the first one winning; a later duplicate only
   * lends its colour if the winner has none. Devices that each create "MATH 2400" from the same imported
   * items give it different random ids, and syncing merges by id, so the same course shows up twice.
   */
  function dedupeByName(courses) {
    const seen = new Map();
    const out = [];
    (courses || []).forEach((c) => {
      const key = normalize(c && c.name);
      if (!key) return; // an entry with no name can never match an item
      const first = seen.get(key);
      if (!first) { seen.set(key, c); out.push(c); return; }
      if (!first.color && c.color) first.color = c.color;
    });
    return out;
  }

  /* ---- Course deletions that stick across devices ----
     Syncing merges course lists by union, so a course deleted here came straight back from any other copy
     of the data (another device or browser). A tombstone {key: normalised name, deletedAt} records the
     deletion; a course is removed by a tombstone unless it was created AFTER the deletion (createdAt),
     so deleting a course and later adding it again on purpose still works. Courses from before this
     existed have no createdAt and count as older than any tombstone. */
  const TOMBSTONE_MAX_AGE_MS = 120 * 24 * 60 * 60 * 1000;

  function recordDeletion(tombstones, name, now) {
    const key = normalize(name);
    const rest = (tombstones || []).filter((t) => t && t.key && t.key !== key);
    return key ? rest.concat([{ key, deletedAt: now }]) : rest;
  }

  function mergeTombstones(a, b, now) {
    const byKey = new Map();
    [...(a || []), ...(b || [])].forEach((t) => {
      if (!t || !t.key) return;
      const prev = byKey.get(t.key);
      if (!prev || (t.deletedAt || 0) > (prev.deletedAt || 0)) byKey.set(t.key, { key: t.key, deletedAt: t.deletedAt || 0 });
    });
    return [...byKey.values()].filter((t) => t.deletedAt >= now - TOMBSTONE_MAX_AGE_MS);
  }

  function applyTombstones(courses, tombstones) {
    const dead = new Map((tombstones || []).map((t) => [t.key, t.deletedAt || 0]));
    return (courses || []).filter((c) => {
      const at = dead.get(normalize(c && c.name));
      return at === undefined || (c.createdAt || 0) > at;
    });
  }

  function byId(courses, id) {
    return (courses || []).find((c) => c.id === id) || null;
  }

  function colorFor(courses, name) {
    const c = byName(courses, name);
    return (c && c.color) || FALLBACK_COLOR;
  }

  /** Case-insensitive duplicate check for the Courses screen's add form. */
  function isDuplicateName(courses, name) {
    return !!byName(courses, name);
  }

  function addCourse(courses, name, color) {
    const trimmed = String(name || '').trim();
    if (!trimmed || isDuplicateName(courses, trimmed)) return null;
    // createdAt lets a course made after a deletion outlive that deletion's tombstone (see applyTombstones).
    const course = { id: newCourseId(), name: trimmed, color: color || nextPaletteColor(courses), createdAt: Date.now() };
    courses.push(course);
    return course;
  }

  /** Renames a course and rewrites every item's `.course` string to match. */
  function renameCourse(items, courses, id, newName) {
    const trimmed = String(newName || '').trim();
    if (!trimmed) return false;
    const course = byId(courses, id);
    if (!course) return false;
    const oldName = course.name;
    if (oldName === trimmed) return false;
    course.name = trimmed;
    const oldKey = normalize(oldName);
    (items || []).forEach((it) => {
      if (normalize(it.course) === oldKey) it.course = trimmed;
    });
    return true;
  }

  function setCourseColor(courses, id, color) {
    const course = byId(courses, id);
    if (!course) return false;
    course.color = color;
    return true;
  }

  /** Deletes a course entry only — items keep their string and fall back to grey. */
  function deleteCourse(courses, id) {
    const idx = (courses || []).findIndex((c) => c.id === id);
    if (idx < 0) return false;
    courses.splice(idx, 1);
    return true;
  }

  function openCountForCourse(items, courseName) {
    const key = normalize(courseName);
    return (items || []).filter((it) => !it.completed && !it.archived && !it.ignored && normalize(it.course) === key).length;
  }

  /** A course's open work (not done, not archived, not ignored), soonest due first; no due date goes last. */
  function openItemsForCourse(items, courseName) {
    const key = normalize(courseName);
    return (items || [])
      .filter((it) => !it.completed && !it.archived && !it.ignored && normalize(it.course) === key)
      .sort((a, b) => (a.due || '9999-99-99').localeCompare(b.due || '9999-99-99') || String(a.title).localeCompare(String(b.title)));
  }

  /** Overdue work the user chose to ignore, for the course detail's "Ignored" section. */
  function ignoredItemsForCourse(items, courseName) {
    const key = normalize(courseName);
    return (items || [])
      .filter((it) => !it.completed && !it.archived && it.ignored && normalize(it.course) === key)
      .sort((a, b) => String(a.title).localeCompare(String(b.title)));
  }

  /** The Courses tab: one row per course with how much is open, how much is overdue, and what is next. */
  function overview(courses, items, today, colorFor) {
    return dedupeByName(courses).map((c) => {
      const open = openItemsForCourse(items, c.name);
      const key = normalize(c.name);
      return {
        name: c.name,
        total: (items || []).filter((it) => !it.archived && normalize(it.course) === key).length,
        color: colorFor ? colorFor(c.name) : c.color,
        open: open.length,
        overdue: open.filter((it) => it.due && it.due < today).length,
        next: open.find((it) => it.due && it.due >= today) || null,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  global.TPCourses = {
    dedupeByName,
    recordDeletion,
    mergeTombstones,
    applyTombstones,
    openItemsForCourse,
    ignoredItemsForCourse,
    overview,
    PALETTE,
    FALLBACK_COLOR,
    newCourseId,
    migrateFromItems,
    nextPaletteColor,
    byName,
    byId,
    colorFor,
    isDuplicateName,
    addCourse,
    renameCourse,
    setCourseColor,
    deleteCourse,
    openCountForCourse,
  };
})(typeof window !== 'undefined' ? window : globalThis);
