/* utils.js — Pure helpers (dates, labels, colors, confetti)
   Attaches to window.TP so the main app can call them without modules.
*/
(function (global) {
  const DAY_OFFSET_KEY = 'tp-day-offset';

  function asDate(dateStr) {
    return new Date(dateStr + 'T00:00:00');
  }

  function today() {
    const d = new Date();
    const offset = Number(localStorage.getItem(DAY_OFFSET_KEY) || 0);
    if (Number.isFinite(offset)) d.setDate(d.getDate() + offset);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }

  function daysBetween(a, b) {
    return Math.round((asDate(b) - asDate(a)) / 86400000);
  }

  function addDays(dateStr, n) {
    const d = asDate(dateStr);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function addMonths(dateStr, n) {
    const d = asDate(dateStr);
    d.setMonth(d.getMonth() + n);
    return d.toISOString().slice(0, 10);
  }

  function nextDueDate(due, recurring) {
    if (recurring === 'weekly') return addDays(due, 7);
    if (recurring === 'monthly') return addMonths(due, 1);
    return due;
  }

  function relativeDueLabel(dateStr) {
    const d = daysBetween(today(), dateStr);
    if (d === 0) return 'Today';
    if (d === 1) return 'Tomorrow';
    if (d === -1) return 'Yesterday';
    if (d >= 2 && d <= 6) return asDate(dateStr).toLocaleDateString(undefined, { weekday: 'long' });
    if (d <= -2 && d >= -6) return Math.abs(d) + 'd ago';
    return asDate(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function fullDateLabel(dateStr) {
    return asDate(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function urgencyClass(daysLeft, completed) {
    if (completed) return '';
    if (daysLeft < 0) return 'tp-overdue';
    if (daysLeft <= 2) return 'tp-urgent';
    if (daysLeft <= 5) return 'tp-soon';
    return 'tp-ok';
  }

  function fmt(n) {
    return Number.isInteger(n) ? n : Math.round(n * 10) / 10;
  }

  /** Singularize a plural unit when count is exactly 1 (chapters → chapter). */
  function unitLabel(amt, unit) {
    if (amt === 1 && unit && unit.endsWith('s')) return unit.slice(0, -1);
    return unit;
  }

  /** Capitalize a unit label when shown alone. */
  function capUnit(unit) {
    return unit ? unit.charAt(0).toUpperCase() + unit.slice(1) : unit;
  }

  function contrastTextColor(hex) {
    const c = (hex || '#888888').replace('#', '');
    const r = parseInt(c.substring(0, 2), 16),
      g = parseInt(c.substring(2, 4), 16),
      b = parseInt(c.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.62 ? '#1a1a1a' : '#fff';
  }

  function burstConfetti(x, y, opts) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const big = !!(opts && opts.big);
    const colors = ['#4f8b74', '#f0a824', '#e8553c', '#4361ee', '#b83fd1', '#2ea9dd', '#e0538a', '#ffd23f'];
    const count = big ? 70 : 30;
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      const isCircle = Math.random() < 0.45;
      const size = (big ? 6 : 5) + Math.random() * (big ? 10 : 7);
      el.style.position = 'fixed';
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.width = size + 'px';
      el.style.height = (isCircle ? size : size * 0.4) + 'px';
      el.style.background = colors[Math.floor(Math.random() * colors.length)];
      el.style.borderRadius = isCircle ? '50%' : '2px';
      el.style.pointerEvents = 'none';
      el.style.zIndex = '3000';
      el.style.willChange = 'transform, opacity';
      document.body.appendChild(el);
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * (big ? 1.9 : 1.7);
      const power = (big ? 140 : 90) + Math.random() * (big ? 220 : 130);
      const dx = Math.cos(angle) * power;
      const dyBurst = Math.sin(angle) * power;
      const wobble = (Math.random() - 0.5) * (big ? 70 : 50);
      const rotateStart = Math.random() * 360;
      const rotateEnd = rotateStart + (Math.random() * 900 - 450);
      const duration = (big ? 1900 : 1500) + Math.random() * (big ? 900 : 700);
      const anim = el.animate(
        [
          { transform: `translate(0,0) rotate(${rotateStart}deg) scale(0.3)`, opacity: 1, offset: 0 },
          {
            transform: `translate(${dx}px, ${dyBurst}px) rotate(${rotateStart + rotateEnd * 0.3}deg) scale(1)`,
            opacity: 1,
            offset: 0.3,
          },
          {
            transform: `translate(${dx + wobble}px, ${dyBurst + 150}px) rotate(${rotateEnd}deg) scale(0.9)`,
            opacity: 0.9,
            offset: 0.75,
          },
          {
            transform: `translate(${dx + wobble * 1.4}px, ${dyBurst + (big ? 320 : 280)}px) rotate(${rotateEnd + 130}deg) scale(0.8)`,
            opacity: 0,
            offset: 1,
          },
        ],
        { duration, easing: 'cubic-bezier(.17,.89,.32,1.25)', fill: 'forwards' }
      );
      anim.onfinish = () => el.remove();
    }
  }

  function scrollToAndHighlight(id, align) {
    const el = document.getElementById(id);
    if (!el) return false;
    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      let targetY;
      if (align === 'top') {
        targetY = window.scrollY + rect.top - 80;
      } else {
        const margin = 100;
        targetY = window.scrollY + rect.bottom - window.innerHeight + margin;
      }
      window.scrollTo({ top: Math.max(targetY, 0), behavior: 'smooth' });
    });
    el.classList.add('tp-card-highlight');
    setTimeout(() => el.classList.remove('tp-card-highlight'), 1600);
    return true;
  }

  global.TP = {
    DAY_OFFSET_KEY,
    asDate,
    today,
    daysBetween,
    addDays,
    addMonths,
    nextDueDate,
    relativeDueLabel,
    fullDateLabel,
    urgencyClass,
    fmt,
    unitLabel,
    capUnit,
    contrastTextColor,
    burstConfetti,
    scrollToAndHighlight,
  };
})(typeof window !== 'undefined' ? window : globalThis);
