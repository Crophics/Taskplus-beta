/* views/card-html.js — Single assignment card HTML */
(function (global) {
function cardHtml(ctx) {
  const { it, i, pos, listLen, sortMode, requiredItemSet, isLocked, daysBetween, today, addDays, urgencyClass, relativeDueLabel, fmt, unitLabel, capUnit, courseColor, contrastTextColor, linkifyNotes } = ctx;
  const escapeHtml = window.TPHtml.escapeHtml;
  const locked = isLocked(it);
  const left = Math.max(it.total-it.done,0);
  const daysLeft = daysBetween(today(), it.due);
  const overdue = !it.completed && !locked && daysLeft<0;
  const effDays = Math.max(daysLeft,1);
  const dt = it.dailyTarget;
  const progressToday = it.today || 0;
  const remainingToday = dt ? Math.max(dt.amt - progressToday, 0) : 0;
  const metToday = !!(dt && dt.amt>0 && remainingToday<=0);
  const tomorrowDaysLeft = Math.max(daysBetween(addDays(today(),1), it.due), 1);
  const tomorrowTarget = left>0 ? Math.ceil(left/tomorrowDaysLeft) : 0;
  const pct = Math.min(100, Math.round((it.done/it.total)*100));
  const unit = it.unit || 'units';
  const cardCourseColor = it.course ? courseColor(it.course) : null;
  const cls = locked ? 'tp-locked' : urgencyClass(daysLeft, it.completed);
  const statusText = it.completed ? 'Completed'
    : locked ? `<span class="tp-waiting">Waiting on: ${escapeHtml(it.dependsOn)}</span>`
    : overdue ? `<span class="tp-overdue-text">Overdue by ${Math.abs(daysLeft)} day${Math.abs(daysLeft)===1?'':'s'}</span>`
    : requiredItemSet.has(it)
      ? (it.total<=1 ? `Due ${relativeDueLabel(it.due)}` : (metToday ? tomorrowTarget+' '+unitLabel(tomorrowTarget,unit)+' tomorrow' : remainingToday+' '+unitLabel(remainingToday,unit)+'/day'))
      : (it.total<=1)
        ? (left<=0 ? 'Done' : 'Available')
        : (left<=0 ? 'Done'
           : metToday ? tomorrowTarget+' '+unitLabel(tomorrowTarget,unit)+' tomorrow'
           : remainingToday+' '+unitLabel(remainingToday,unit)+'/day');
  return `<div class="tp-card ${it.completed?'tp-done':''} ${cls}" id="tp-card-${i}" data-i="${i}">
    <div class="tp-card-head">
      ${sortMode==='custom'? `<span class="tp-drag-handle" draggable="true" data-i="${i}" title="Drag to reorder" aria-hidden="true">\u2837</span>` : ''}
      <div style="flex:1;">
        ${it.course? `<span class="tp-tag" style="background:${cardCourseColor};color:${contrastTextColor(cardCourseColor)}">${escapeHtml(it.course)}</span>` : ''}
        ${it.archived? `<span class="tp-tag" style="background:#555;">Archived</span>` : ''}
        <div><b>${escapeHtml(it.title)}</b>${it.recurring? `<span class="tp-recurring-tag">\u21bb ${it.recurring}</span>` : ''}</div>
        ${it.notes? `<div class="tp-notes">${linkifyNotes(it.notes)}</div>` : ''}
        ${it.subtasks && it.subtasks.length? `<div class="tp-subtasks">${it.subtasks.map((s,si)=>`<label class="tp-subtask-row"><input type="checkbox" class="tp-subtask-toggle" data-i="${i}" data-si="${si}" ${s.done?'checked':''}><span style="${s.done?'text-decoration:line-through;opacity:0.6;':''}">${escapeHtml(s.text)}</span></label>`).join('')}</div>` : ''}
      </div>
    </div>
    <div class="tp-row"><span title="${it.due}">Due ${relativeDueLabel(it.due)}</span><span>${statusText}</span></div>
    <div class="tp-bar"><div class="tp-fill" data-fill-key="${i}" style="width:${pct}%"></div></div>
    <div class="tp-row tp-actions-row">
      <span>${it.total>1 ? fmt(it.done)+'/'+fmt(it.total)+' '+unit : capUnit(unit)}</span>
      <span class="tp-actions">
        ${sortMode==='custom'? `<button data-pos="${pos}" class="tp-move-up tp-secondary" aria-label="Move up" ${pos===0?'disabled':''}>\u2191</button><button data-pos="${pos}" class="tp-move-down tp-secondary" aria-label="Move down" ${pos===listLen-1?'disabled':''}>\u2193</button>` : ''}
        ${(!it.completed && !locked && it.total>1)? `<button data-i="${i}" class="tp-log">+1</button>` : ''}
        ${!locked? `<button data-i="${i}" class="tp-complete">${it.completed? 'Reopen':'Complete'}</button>` : ''}
        <button data-i="${i}" class="tp-edit tp-secondary">Edit</button>
        <button data-i="${i}" class="tp-del tp-danger">Delete</button>
      </span>
    </div>
  </div>`;
}

  global.TPViews = global.TPViews || {};
  global.TPViews.cardHtml = cardHtml;
})(typeof window !== 'undefined' ? window : globalThis);