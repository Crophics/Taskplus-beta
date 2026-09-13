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
    const course = { id: newCourseId(), name: trimmed, color: color || nextPaletteColor(courses) };
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
    return (items || []).filter((it) => !it.completed && !it.archived && normalize(it.course) === key).length;
  }

  global.TPCourses = {
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
