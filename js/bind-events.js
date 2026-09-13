/* bind-events.js — Wire DOM event handlers after each render */
(function (global) {
  /**
   * @param {HTMLElement} root
   * @param {object} c  live bindings from the main app closure
   */
  function bindEvents(root, api) {
const addToggle = document.getElementById('tp-add-toggle');
if(addToggle) addToggle.onclick = ()=>{ api.showForm = true; api.render(); };

const modalBackdrop = document.getElementById('tp-modal-backdrop');
if(modalBackdrop){
  modalBackdrop.addEventListener('click', (e)=>{
    if(e.target === modalBackdrop){ api.editIndex=null; api.showForm=false; api.render(); }
  });
}
const modalClose = document.getElementById('tp-modal-close');
if(modalClose) modalClose.onclick = ()=>{ api.editIndex=null; api.showForm=false; api.render(); };

const exportBtn = document.getElementById('tp-export');
if(exportBtn) exportBtn.onclick = api.exportData;
const exportIcsBtn = document.getElementById('tp-export-ics');
if(exportIcsBtn) exportIcsBtn.onclick = api.exportIcs;
const importBtn = document.getElementById('tp-import-btn');
if(importBtn) importBtn.onclick = ()=> document.getElementById('tp-import')?.click();
const importEl = document.getElementById('tp-import');
if(importEl) importEl.onchange = (e)=>{
  if(e.target.files[0]) api.importData(e.target.files[0]);
};

const courseField = document.getElementById('tp-course');
if(courseField){
  courseField.addEventListener('input', (e)=>{
    const dependsSelect = document.getElementById('tp-depends');
    const existing = api.editIndex!==null ? api.items[api.editIndex] : null;
    dependsSelect.innerHTML = api.dependsOptionsHtml(e.target.value, '', existing);
  });
}

const dueInput = document.getElementById('tp-due');
if(dueInput){
  const wrap = dueInput.closest('.tp-date-wrap');
  const syncDatePlaceholder = ()=>{
    if(wrap) wrap.classList.toggle('tp-has-date', !!dueInput.value);
  };
  syncDatePlaceholder();
  dueInput.addEventListener('input', syncDatePlaceholder);
  dueInput.addEventListener('change', syncDatePlaceholder);
}

const saveBtn = document.getElementById('tp-save');
if(saveBtn){
  saveBtn.onclick = ()=>{
    const title = document.getElementById('tp-title').value.trim();
    const course = document.getElementById('tp-course').value.trim();
    const due = document.getElementById('tp-due').value;
    const unitsRaw = document.getElementById('tp-units').value.trim();
    const total = unitsRaw ? parseFloat(unitsRaw) : 1;
    const unit = document.getElementById('tp-unitlabel').value.trim() || 'Assignment';
    const notes = document.getElementById('tp-notes').value.trim();
    const dependsOn = document.getElementById('tp-depends').value;
    const recurring = document.getElementById('tp-recurring').value;
    const subtaskLines = document.getElementById('tp-subtasks').value.split('\n').map(s=>s.trim()).filter(Boolean);
    const titleEl = document.getElementById('tp-title');
    const dueEl = document.getElementById('tp-due');
    const dueWrap = dueEl ? dueEl.closest('.tp-date-wrap') : null;
    [titleEl,dueEl].forEach(el=>{ if(el) el.classList.remove('tp-field-error'); });
    if(dueWrap) dueWrap.classList.remove('tp-field-error');
    const missing = [];
    if(!title) missing.push(titleEl);
    if(!due) missing.push(dueEl);
    if(missing.length){
      missing.forEach(el=>{
        if(el === dueEl && dueWrap) dueWrap.classList.add('tp-field-error');
        else el.classList.add('tp-field-error');
      });
      missing[0].focus();
      return;
    }
    const prevSubtasks = (api.editIndex!==null && api.items[api.editIndex].subtasks) || [];
    const subtasks = subtaskLines.map(text=>{
      const prev = prevSubtasks.find(s=>s.text===text);
      return { text, done: prev ? prev.done : false };
    });
    if(api.editIndex!==null){
      const it = api.items[api.editIndex];
      it.title=title; it.course=course; it.due=due; it.total=total; it.unit=unit; it.notes=notes;
      it.dependsOn=dependsOn; it.recurring=recurring; it.subtasks=subtasks;
      it.done = Math.min(it.done, total);
      if(api.touchItem) api.touchItem(it);
      else it.updatedAt = Date.now();
      if(api.isDevModeTrigger(it.title, it.total)) api.activateDevMode();
      api.editIndex = null;
    } else {
      const maxOrder = api.items.reduce((m,x)=> Math.max(m, x.order ?? -1), -1);
      api.items.push({id:api.newItemId(),title,course,due,total,unit,notes,done:0,completed:false,dependsOn,recurring,subtasks,completedAt:null,createdAt:api.today(),archived:false,order:maxOrder+1,updatedAt:Date.now()});
      if(api.isDevModeTrigger(title, total)) api.activateDevMode();
      api.pendingScrollId = 'tp-card-'+(api.items.length-1);
      api.pendingScrollAlign = 'top';
    }
    api.showForm = false;
    api.save();
  };
}
const cancelBtn = document.getElementById('tp-cancel');
if(cancelBtn) cancelBtn.onclick = ()=>{ api.editIndex=null; api.showForm=false; api.render(); };

const modalBox = document.getElementById('tp-modal-box');
if(modalBox && saveBtn){
  modalBox.addEventListener('keydown', (e)=>{
    if(e.key==='Enter' && e.target.tagName==='INPUT'){
      e.preventDefault();
      saveBtn.click();
    }
  });
}

{ const __el = document.getElementById('tp-sort'); if(__el) __el.onchange = (e)=>{ api.sortMode=e.target.value; api.savePrefs(); api.render(); }; }
const todayToggleBtn = document.getElementById('tp-today-toggle');
if(todayToggleBtn) todayToggleBtn.onclick = ()=>{
  api.todayExpanded = !api.todayExpanded;
  api.pendingTodayAnim = true;
  api.savePrefs();
  api.render();
};
const todayCard = document.getElementById('tp-today-card');
if(todayCard) todayCard.addEventListener('click', (e)=>{
  // Ignore clicks on the toggle button or on rows that have their own
  // click behavior (scroll-to-card) — only empty space toggles.
  if(e.target.closest('#tp-today-toggle') || e.target.closest('.tp-today-clickable')) return;
  api.todayExpanded = !api.todayExpanded;
  api.pendingTodayAnim = true;
  api.savePrefs();
  api.render();
});
{ const __el = document.getElementById('tp-show-completed'); if(__el) __el.onchange = (e)=>{ api.hideDone = !e.target.checked; api.savePrefs(); api.render(); }; }
{ const __el = document.getElementById('tp-show-archived'); if(__el) __el.onchange = (e)=>{ api.showArchived = e.target.checked; api.savePrefs(); api.render(); }; }
{
  const __filter = document.getElementById('tp-filter');
  if(__filter) __filter.oninput = (e)=>{
    api.pendingFocus = {id:'tp-filter', selStart:e.target.selectionStart, selEnd:e.target.selectionEnd};
    api.searchTerm=e.target.value; api.savePrefs(); api.render();
  };
}
const searchClearBtn = document.getElementById('tp-search-clear');
if(searchClearBtn) searchClearBtn.onclick = ()=>{
  api.searchTerm = '';
  api.savePrefs();
  api.pendingFocus = {id:'tp-filter', selStart:0, selEnd:0};
  api.render();
};
const overdueBanner = document.getElementById('tp-overdue-banner');
if(overdueBanner) overdueBanner.onclick = ()=>{
  api.overdueFilterActive = !api.overdueFilterActive;
  api.render();
};
const clearFiltersBtn = document.getElementById('tp-clear-filters');
if(clearFiltersBtn) clearFiltersBtn.onclick = ()=>{
  api.searchTerm = '';
  api.hideDone = false;
  api.overdueFilterActive = false;
  api.savePrefs();
  api.render();
};
{
  const __el = document.getElementById('tp-theme-select');
  if(__el) __el.onchange = (e)=>{
    api.theme = e.target.value;
    api.applyTheme();
    api.savePrefs();
    api.render();
  };
}
{ const __el = document.getElementById('tp-clear-completed'); if(__el) __el.onclick = api.clearCompleted; }

const devToolbarBtn = document.getElementById('tp-dev-toolbar-btn');
if(devToolbarBtn){
  devToolbarBtn.onclick = ()=>{
    api.devPanelOpen = !api.devPanelOpen;
    api.saveDevPanelOpen();
    api.render();
  };
}
const devTriggerNotify = document.getElementById('tp-dev-trigger-notify');
if(devTriggerNotify){
  devTriggerNotify.onclick = ()=>{
    if (!('Notification' in window)) {
      alert('This browser does not support desktop notifications.');
      return;
    }
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        new Notification('🧪 Dev ping', { body: 'A little planner nudge just for testing ✨', icon: 'icons/icon-192.png' });
      } else {
        alert('Notification permission denied.');
      }
    });
  };
}
const devAdvance1 = document.getElementById('tp-dev-advance-1');
if(devAdvance1){
  devAdvance1.onclick = ()=>{
    const offset = Number(localStorage.getItem(api.DAY_OFFSET_KEY) || 0);
    localStorage.setItem(api.DAY_OFFSET_KEY, String(offset + 1));
    alert('Simulated moving forward 1 day. Reloading...');
    location.reload();
  };
}
const devAdvance7 = document.getElementById('tp-dev-advance-7');
if(devAdvance7){
  devAdvance7.onclick = ()=>{
    const offset = Number(localStorage.getItem(api.DAY_OFFSET_KEY) || 0);
    localStorage.setItem(api.DAY_OFFSET_KEY, String(offset + 7));
    alert('Simulated moving forward 7 days. Reloading...');
    location.reload();
  };
}
const devReset = document.getElementById('tp-dev-reset');
const devResetConfirm = document.getElementById('tp-dev-reset-confirm');
if(devReset && devResetConfirm){
  // Uses an in-page confirm instead of window.confirm() - native dialogs
  // are blocked in sandboxed iframe previews (e.g. Claude's artifact
  // viewer), which silently no-ops this button there.
  devReset.onclick = ()=>{
    devResetConfirm.style.display = 'block';
  };
  const yesBtn = document.getElementById('tp-dev-reset-confirm-yes');
  const noBtn = document.getElementById('tp-dev-reset-confirm-no');
  if(yesBtn) yesBtn.onclick = ()=>{
    localStorage.clear();
    sessionStorage.clear();
    location.reload();
  };
  if(noBtn) noBtn.onclick = ()=>{
    devResetConfirm.style.display = 'none';
  };
}
const devExit = document.getElementById('tp-dev-exit');
if(devExit){
  devExit.onclick = ()=>{
    api.deactivateDevMode();
    api.render();
  };
}

const manageBtn = document.getElementById('tp-manage-courses');
if(manageBtn) manageBtn.onclick = ()=>{
  api.showCourseManager = !api.showCourseManager;
  if(api.showCourseManager){ api.pendingScrollId = 'tp-course-manager'; api.pendingScrollAlign = 'end'; }
  api.render();
};

const notifyBtn = document.getElementById('tp-enable-notify');
if(notifyBtn) notifyBtn.onclick = async ()=>{
  try {
    if (window.tpSync && window.tpSync.enablePush) {
      const res = await window.tpSync.enablePush(api.notifyHour);
      if (res.ok) {
        if (api.showToast) api.showToast('Reminders on — including when the app is closed');
        else if (window.TPToast) window.TPToast.show('Reminders on — including when the app is closed');
      } else if (res.reason === 'missing-vapid') {
        alert(res.message || 'Add your VAPID key to js/fcm-config.js');
      } else if (res.reason === 'denied') {
        alert('Notification permission denied. You can enable it in browser settings.');
      } else if (res.reason === 'unsupported') {
        alert('Push notifications are not supported in this browser.');
      }
    } else if ('Notification' in window) {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') alert('Notification permission denied.');
    }
  } catch (e) {
    console.warn(e);
    alert('Could not enable push: ' + (e && e.message ? e.message : e));
  }
  api.checkAndNotify();
  api.render();
};


{
  const nh = document.getElementById('tp-notify-hour');
  const nd = document.getElementById('tp-notify-digest');
  if(nh) nh.onchange = ()=>{ api.setNotifyHour(Number(nh.value)); };
  if(nd) nd.onchange = ()=>{ api.notifyDigest = !!nd.checked; api.savePrefs(); };
}

root.querySelectorAll('.tp-course-color').forEach(inp=>{
  inp.onchange = ()=>{
    const key = inp.dataset.course.trim().toLowerCase();
    api.courseColors[key] = inp.value;
    api.saveCourseColors();
    api.render();
  };
});
root.querySelectorAll('.tp-course-rename').forEach(inp=>{
  inp.addEventListener('change', ()=>{
    const oldName = inp.dataset.course;
    const newName = inp.value.trim();
    if(newName && newName!==oldName) api.renameCourse(oldName, newName);
  });
});

root.querySelectorAll('.tp-today-clickable[data-item-i]').forEach(row=>{
  row.onclick = ()=>{
    const targetId = 'tp-card-'+row.dataset.itemI;
    if(!api.scrollToAndHighlight(targetId, 'top')){
      // Probably hidden by an active search filter — clear it and retry after re-render.
      if(api.searchTerm){ api.searchTerm = ''; api.savePrefs(); }
      api.pendingScrollId = targetId;
      api.pendingScrollAlign = 'top';
      api.render();
    }
  };
});

root.querySelectorAll('.tp-subtask-toggle').forEach(cb=>cb.onchange=()=>{
  const it = api.items[cb.dataset.i];
  it.subtasks[cb.dataset.si].done = cb.checked;
  if(api.touchItem) api.touchItem(it); else it.updatedAt = Date.now();
  api.save();
});

root.querySelectorAll('.tp-log').forEach(b=>b.onclick=()=>{
  const it = api.items[b.dataset.i];
  const workBefore = api.hasTodayWorkRemaining(); // also refreshes it.dailyTarget as a side effect
  const metBefore = window.TPTodayLogic.met(it);
  const prevDone = it.done;
  it.done = Math.min(it.done+1, it.total);
  it.today = (it.today||0) + (it.done - prevDone);
    if(api.touchItem) api.touchItem(it); else it.updatedAt = Date.now();
  const reachedDailyTarget = !metBefore && window.TPTodayLogic.met(it);
  const fullyCompleted = it.done>=it.total && !it.completed;
  if(fullyCompleted){
    it.completed = true;
    it.completedAt = api.today();
    if(it.recurring) api.items.push(api.makeRecurringClone(it));
  }
    if(fullyCompleted || reachedDailyTarget){
    const rect = b.getBoundingClientRect();
    const workAfter = api.hasTodayWorkRemaining();
    if(workBefore && !workAfter){
      // Day just finished — log it before save/render so the streak 🔥
      // text appears on this same paint (not the next interaction).
      if(api.logDayComplete) api.logDayComplete();
      api.triggerCelebration(window.innerWidth/2, window.innerHeight*0.25, true);
    } else {
      api.triggerCelebration(rect.left + rect.width/2, rect.top + rect.height/2, false);
    }
  }
  api.save();
});
root.querySelectorAll('.tp-move-up').forEach(b=>b.onclick=()=>{
  const pos = parseInt(b.dataset.pos);
  if(pos<=0) return;
  const curr = api.list[pos].it, prev = api.list[pos-1].it;
  const tmp = curr.order; curr.order = prev.order; prev.order = tmp;
  api.save();
});
root.querySelectorAll('.tp-move-down').forEach(b=>b.onclick=()=>{
  const pos = parseInt(b.dataset.pos);
  if(pos>=api.list.length-1) return;
  const curr = api.list[pos].it, next = api.list[pos+1].it;
  const tmp = curr.order; curr.order = next.order; next.order = tmp;
  api.save();
});

root.querySelectorAll('.tp-drag-handle').forEach(handle=>{
  handle.addEventListener('dragstart', (e)=>{
    api.dragSrcIndex = parseInt(handle.dataset.i);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(api.dragSrcIndex));
    const card = handle.closest('.tp-card');
    if(card) card.classList.add('tp-dragging');
  });
  handle.addEventListener('dragend', ()=>{
    root.querySelectorAll('.tp-card.tp-dragging').forEach(c=>c.classList.remove('tp-dragging'));
    root.querySelectorAll('.tp-card.tp-drop-target').forEach(c=>c.classList.remove('tp-drop-target'));
    api.dragSrcIndex = null;
  });
});
root.querySelectorAll('.tp-card[data-i]').forEach(card=>{
  card.addEventListener('dragover', (e)=>{
    if(api.dragSrcIndex===null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    card.classList.add('tp-drop-target');
  });
  card.addEventListener('dragleave', ()=>{
    card.classList.remove('tp-drop-target');
  });
  card.addEventListener('drop', (e)=>{
    e.preventDefault();
    card.classList.remove('tp-drop-target');
    const targetIdx = parseInt(card.dataset.i);
    if(api.dragSrcIndex===null || targetIdx===api.dragSrcIndex) return;
    api.reorderByDrag(api.dragSrcIndex, targetIdx, api.list);
    api.dragSrcIndex = null;
  });
});
root.querySelectorAll('.tp-edit').forEach(b=>b.onclick=()=>{
  api.editIndex = parseInt(b.dataset.i); api.pendingFocus = 'none'; api.render();
});
root.querySelectorAll('.tp-complete').forEach(b=>b.onclick=()=>{
  const it = api.items[b.dataset.i];
  const completing = !it.completed;
  const workBefore = api.hasTodayWorkRemaining();
  const prevDone = it.done;
  it.completed = !it.completed;
  if(it.completed){
    it.done = it.total;
    it.today = (it.today||0) + Math.max(it.done - prevDone, 0);
    it.completedAt = api.today();
    if(it.recurring) api.items.push(api.makeRecurringClone(it));
  } else {
    it.completedAt = null;
    it.archived = false;
  }
  if(api.touchItem) api.touchItem(it); else it.updatedAt = Date.now();
    if(completing){
    const rect = b.getBoundingClientRect();
    const workAfter = api.hasTodayWorkRemaining();
    if(workBefore && !workAfter){
      // Day just finished — log it before save/render so the streak 🔥
      // text appears on this same paint (not the next interaction).
      if(api.logDayComplete) api.logDayComplete();
      api.triggerCelebration(window.innerWidth/2, window.innerHeight*0.25, true);
    } else {
      api.triggerCelebration(rect.left + rect.width/2, rect.top + rect.height/2, false);
    }
  }
  api.save();
});
root.querySelectorAll('.tp-del').forEach(b=>b.onclick=()=>{
  api.deleteItemAt(parseInt(b.dataset.i));
});

// Restore focus to whatever the user was interacting with before this api.render.
if(api.pendingFocus === 'title'){
  const t = document.getElementById('tp-title');
  if(t) t.focus();
} else if(api.pendingFocus){
  const el = document.getElementById(api.pendingFocus.id);
  if(el){
    el.focus();
    if(api.pendingFocus.selStart!=null && el.setSelectionRange){
      try{ el.setSelectionRange(api.pendingFocus.selStart, api.pendingFocus.selEnd); }catch(e){}
    }
  }
}
api.pendingFocus = null;

if(api.pendingScrollId){
  api.scrollToAndHighlight(api.pendingScrollId, api.pendingScrollAlign);
  api.pendingScrollId = null;
  api.pendingScrollAlign = 'end';
}

root.querySelectorAll('details.tp-export-dropdown').forEach(d=>{
  d.addEventListener('toggle', ()=>{
    if(!d.open) return;
    requestAnimationFrame(()=>{
      const panel = d.querySelector('.tp-dropdown-panel');
      if(!panel) return;
      const overflow = panel.getBoundingClientRect().bottom - window.innerHeight;
      if(overflow > 0) window.scrollBy({top: overflow + 16, behavior:'smooth'});
    });
  });
});

  }

  global.TPBind = { bindEvents };
})(typeof window !== 'undefined' ? window : globalThis);