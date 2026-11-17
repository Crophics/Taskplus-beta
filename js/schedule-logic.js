/* schedule-logic.js — class meeting times (Moodle does not provide them).
   A course's schedule is one line of text, like the vault's "Meets:" lines:
     "MWF 10:00-10:50 Room 101"      "TR 1:30-2:45pm"      "MW 9-9:50; F 13:00-14:30 Lab"
   Day letters: M T W R(Thursday) F S U(Sunday). Pure; tested in test/schedule-logic.test.js. */
(function (global) {
  const LETTER_DAY = { M: 1, T: 2, W: 3, R: 4, F: 5, S: 6, U: 0 };
  const NAME_DAY = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };

  function parseTime(h, m, ap) {
    let hh = Number(h);
    const mm = m === undefined || m === '' ? 0 : Number(m);
    if (!Number.isFinite(hh) || mm > 59) return null;
    if (ap) { ap = ap.toLowerCase(); if (hh < 1 || hh > 12) return null; if (ap === 'pm' && hh < 12) hh += 12; if (ap === 'am' && hh === 12) hh = 0; }
    if (hh > 23) return null;
    return hh * 60 + mm;
  }

  /** One segment: days, then a start-end range, then an optional place. Returns null if it does not parse. */
  function parseSegment(seg) {
    const m = /^\s*([A-Za-z,\s/]+?)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(.*)$/i.exec(seg);
    if (!m) return null;
    const dayText = m[1].trim();
    let days = [];
    if (/^[MTWRFSU]+$/i.test(dayText.replace(/[\s,/]/g, '')) && !/[a-z]{3,}/i.test(dayText.replace(/[\s,/]/g, '').toLowerCase().replace(/^[mtwrfsu]+$/, ''))) {
      days = dayText.replace(/[\s,/]/g, '').toUpperCase().split('').map((c) => LETTER_DAY[c]);
    } else {
      days = dayText.split(/[\s,/]+/).map((w) => NAME_DAY[w.toLowerCase()]);
    }
    if (!days.length || days.some((d) => d === undefined)) return null;
    // "1:30-2:45pm": the am/pm on the end applies to a start that has none, unless that makes start >= end.
    const endAp = m[7] || null;
    let start = parseTime(m[2], m[3], m[4] || null);
    const end = parseTime(m[5], m[6], endAp);
    if (start === null || end === null) return null;
    if (!m[4] && endAp) {
      const withEnd = parseTime(m[2], m[3], endAp);
      if (withEnd !== null && withEnd < end) start = withEnd;
    }
    if (end <= start) return null;
    return { days: Array.from(new Set(days)).sort((a, b) => a - b), start, end, where: (m[8] || '').trim().slice(0, 40) };
  }

  /** {meetings, ok}: ok is false when some non-empty segment could not be read (nothing is guessed). */
  function parseMeets(text) {
    const segs = String(text || '').split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
    const meetings = [];
    let ok = true;
    segs.forEach((s) => { const p = parseSegment(s); if (p) meetings.push(p); else ok = false; });
    return { meetings, ok };
  }

  function fmtTime(min) {
    const h = Math.floor(min / 60), m = min % 60;
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + (m ? ':' + String(m).padStart(2, '0') : '') + ' ' + ap;
  }

  /** Classes on one date. schedule: {courseName: text}. Sorted by start time. */
  function classesOn(date, schedule) {
    const dow = date.getDay();
    const out = [];
    Object.keys(schedule || {}).forEach((course) => {
      parseMeets(schedule[course]).meetings.forEach((mt) => {
        if (mt.days.includes(dow)) out.push({ course, start: mt.start, end: mt.end, where: mt.where });
      });
    });
    return out.sort((a, b) => a.start - b.start || a.course.localeCompare(b.course));
  }

  global.TPSchedule = { parseMeets, classesOn, fmtTime };
})(typeof window !== 'undefined' ? window : globalThis);
