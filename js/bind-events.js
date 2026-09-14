/* bind-events.js — Wire DOM event handlers after each render */
(function (global) {
  const LONG_PRESS_MS = 500;
  const LONG_PRESS_MOVE_TOLERANCE = 10;

  function bindEvents(root, api) {
    const TL = window.TPTodayLogic;

    /* ---- Logging / completing (shared by Today rows, Get-ahead, quick-menu) ---- */
    function logOne(idx, sourceEl) {
      const it = api.items[idx];
      if (!it) return;
      const workBefore = api.hasTodayWorkRemaining(); // refreshes it.dailyTarget as a side effect
      const metBefore = TL.met(it);
      const prevDone = it.done;
      it.done = Math.min(it.done + 1, it.total);
      it.today = (it.today || 0) + (it.done - prevDone);
      api.touchItem(it);
      const reachedDailyTarget = !metBefore && TL.met(it);
      const fullyCompleted = it.done >= it.total && !it.completed;
      if (fullyCompleted) {
        it.completed = true;
        it.completedAt = api.today();
        if (it.recurring) api.items.push(api.makeRecurringClone(it));
      }
      if (fullyCompleted || reachedDailyTarget) {
        const rect = sourceEl.getBoundingClientRect();
        const workAfter = api.hasTodayWorkRemaining();
        if (workBefore && !workAfter) {
          api.logDayComplete();
          api.triggerCelebration(window.innerWidth / 2, window.innerHeight * 0.25, true);
        } else {
          api.triggerCelebration(rect.left + rect.width / 2, rect.top + rect.height / 2, false);
        }
      }
      api.save();
    }

    function toggleComplete(idx) {
      const it = api.items[idx];
      if (!it) return;
      const completing = !it.completed;
      const workBefore = api.hasTodayWorkRemaining();
      const prevDone = it.done;
      it.completed = !it.completed;
      if (it.completed) {
        it.done = it.total;
        it.today = (it.today || 0) + Math.max(it.done - prevDone, 0);
        it.completedAt = api.today();
        if (it.recurring) api.items.push(api.makeRecurringClone(it));
      } else {
        it.completedAt = null;
        it.archived = false;
      }
      api.touchItem(it);
      if (completing) {
        const workAfter = api.hasTodayWorkRemaining();
        if (workBefore && !workAfter) {
          api.logDayComplete();
          api.triggerCelebration(window.innerWidth / 2, window.innerHeight * 0.25, true);
        }
      }
      api.save();
    }

    root.querySelectorAll('.tp-log').forEach(b => b.onclick = () => logOne(parseInt(b.dataset.i), b));
    root.querySelectorAll('.tp-complete').forEach(b => b.onclick = () => toggleComplete(parseInt(b.dataset.i)));
    root.querySelectorAll('.tp-del').forEach(b => b.onclick = () => api.deleteItemAt(parseInt(b.dataset.i)));

    /* ---- Tab bar ---- */
    root.querySelectorAll('.tp-tab[data-tab]').forEach(b => b.onclick = () => {
      api.tab = b.dataset.tab;
      api.savePrefs();
      api.render();
    });
    const addToggle = document.getElementById('tp-add-toggle');
    if (addToggle) addToggle.onclick = () => { api.openAddSheet(); api.render(); };

    /* ---- Today screen: tap a row body to open the quick-action menu ---- */
    root.querySelectorAll('.tp-t-row, .tp-t-ahead-row').forEach(row => {
      row.onclick = (e) => {
        if (e.target.closest('.tp-t-action') || e.target.closest('.tp-t-ahead-more')) return;
        const idx = Number(row.dataset.itemI);
        if (!Number.isNaN(idx)) { api.menuFor = idx; api.render(); }
      };
    });

    /* ---- All screen ---- */
    {
      const search = document.getElementById('tp-a-search');
      if (search) search.oninput = (e) => {
        api.pendingFocus = { id: 'tp-a-search', selStart: e.target.selectionStart, selEnd: e.target.selectionEnd };
        api.searchTerm = e.target.value;
        api.savePrefs();
        api.render();
      };
    }
    const searchClear = document.getElementById('tp-a-search-clear');
    if (searchClear) searchClear.onclick = () => {
      api.searchTerm = '';
      api.savePrefs();
      api.pendingFocus = { id: 'tp-a-search', selStart: 0, selEnd: 0 };
      api.render();
    };
    root.querySelectorAll('.tp-a-chip[data-sort]').forEach(b => b.onclick = () => {
      api.allSortMode = b.dataset.sort;
      api.savePrefs();
      api.render();
    });
    root.querySelectorAll('.tp-a-chip[data-course-filter]').forEach(b => b.onclick = () => {
      const val = b.dataset.courseFilter;
      api.allFilterCourse = (val && val.toLowerCase() === (api.allFilterCourse || '').toLowerCase()) ? '' : val;
      api.savePrefs();
      api.render();
    });

    /* ---- Drag to reorder (pointer-based; iOS Safari has no HTML5 DnD from touch) ---- */
    root.querySelectorAll('.tp-a-drag').forEach(handle => {
      const card = handle.closest('.tp-a-card');
      if (!card) return;

      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        const cards = [...root.querySelectorAll('.tp-a-card[data-i]')];
        const srcIndex = parseInt(card.dataset.i);
        let overCard = null;
        card.classList.add('tp-dragging');

        const onMove = (ev) => {
          const y = ev.clientY;
          const hit = cards.find(c => {
            if (c === card) return false;
            const r = c.getBoundingClientRect();
            return y >= r.top && y <= r.bottom;
          });
          if (hit !== overCard) {
            if (overCard) overCard.classList.remove('tp-drop-target');
            overCard = hit || null;
            if (overCard) overCard.classList.add('tp-drop-target');
          }
        };

        const onUp = () => {
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', onUp);
          handle.removeEventListener('pointercancel', onUp);
          card.classList.remove('tp-dragging');
          if (overCard) {
            overCard.classList.remove('tp-drop-target');
            const targetIdx = parseInt(overCard.dataset.i);
            if (targetIdx !== srcIndex) {
              if (api.allSortMode !== 'custom') { api.allSortMode = 'custom'; api.savePrefs(); }
              api.reorderByDrag(srcIndex, targetIdx, api.allList);
              return;
            }
          }
          api.render();
        };

        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
      });
    });

    // Long-press an All-tab card (not its drag handle) to open the quick-action menu.
    root.querySelectorAll('.tp-a-card[data-i]').forEach(card => {
      let timer = null, startX = 0, startY = 0;
      const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
      card.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.tp-a-drag')) return;
        startX = e.clientX; startY = e.clientY;
        timer = setTimeout(() => {
          timer = null;
          api.menuFor = parseInt(card.dataset.i);
          api.render();
        }, LONG_PRESS_MS);
      });
      card.addEventListener('pointermove', (e) => {
        if (!timer) return;
        if (Math.abs(e.clientX - startX) > LONG_PRESS_MOVE_TOLERANCE || Math.abs(e.clientY - startY) > LONG_PRESS_MOVE_TOLERANCE) cancel();
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(evt => card.addEventListener(evt, cancel));
    });

    /* ---- Quick-action menu ---- */
    const qmenuBackdrop = document.getElementById('tp-qmenu-backdrop');
    if (qmenuBackdrop) qmenuBackdrop.addEventListener('click', (e) => {
      if (e.target === qmenuBackdrop) { api.menuFor = null; api.render(); }
    });
    const qmLog = document.getElementById('tp-qm-log');
    if (qmLog) qmLog.onclick = () => { logOne(parseInt(qmLog.dataset.i), qmLog); api.menuFor = null; api.render(); };
    const qmComplete = document.getElementById('tp-qm-complete');
    if (qmComplete) qmComplete.onclick = () => { toggleComplete(parseInt(qmComplete.dataset.i)); api.menuFor = null; api.render(); };
    const qmPush = document.getElementById('tp-qm-push');
    if (qmPush) qmPush.onclick = () => {
      const it = api.items[parseInt(qmPush.dataset.i)];
      if (it) { it.due = api.addDays(it.due, 1); api.touchItem(it); api.menuFor = null; api.save(); }
    };
    const qmEdit = document.getElementById('tp-qm-edit');
    if (qmEdit) qmEdit.onclick = () => {
      const idx = parseInt(qmEdit.dataset.i);
      api.menuFor = null;
      api.openAddSheet(idx);
      api.render();
    };
    const qmDelete = document.getElementById('tp-qm-delete');
    if (qmDelete) qmDelete.onclick = () => {
      const idx = parseInt(qmDelete.dataset.i);
      api.menuFor = null;
      api.deleteItemAt(idx);
    };

    /* ---- Week screen ---- */
    root.querySelectorAll('.tp-w-col[data-day]').forEach(col => col.onclick = () => {
      api.weekSelDay = Number(col.dataset.day);
      api.render();
    });

    /* ---- Settings screen ---- */
    root.querySelectorAll('.tp-s-segment[data-theme-choice]').forEach(b => b.onclick = () => {
      api.theme = b.dataset.themeChoice;
      api.applyTheme();
      api.savePrefs();
      api.render();
    });
    const notifyDigestToggle = document.getElementById('tp-notify-digest');
    if (notifyDigestToggle) notifyDigestToggle.onclick = () => {
      api.notifyDigest = !api.notifyDigest;
      api.savePrefs();
      api.render();
    };
    const cycleHourBtn = document.getElementById('tp-cycle-hour');
    if (cycleHourBtn) cycleHourBtn.onclick = () => {
      api.setNotifyHour((Number(cycleHourBtn.dataset.hour) + 1) % 24);
    };
    const notifyBtn = document.getElementById('tp-enable-notify');
    if (notifyBtn) notifyBtn.onclick = async () => {
      try {
        if (window.tpSync && window.tpSync.enablePush) {
          const res = await window.tpSync.enablePush(api.notifyHour);
          if (res.ok) api.showToast('Reminders on — including when the app is closed');
          else if (res.reason === 'missing-vapid') alert(res.message || 'Add your VAPID key to js/fcm-config.js');
          else if (res.reason === 'denied') alert('Notification permission denied. You can enable it in browser settings.');
          else if (res.reason === 'unsupported') alert('Push notifications are not supported in this browser.');
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
    const manageBtn = document.getElementById('tp-manage-courses');
    if (manageBtn) manageBtn.onclick = () => { api.tab = 'courses'; api.savePrefs(); api.render(); };
    const exportBtn = document.getElementById('tp-export');
    if (exportBtn) exportBtn.onclick = api.exportData;
    const exportIcsBtn = document.getElementById('tp-export-ics');
    if (exportIcsBtn) exportIcsBtn.onclick = api.exportIcs;
    const importEl = document.getElementById('tp-import');
    if (importEl) importEl.onchange = (e) => { if (e.target.files[0]) api.importData(e.target.files[0]); };
    const clearCompletedBtn = document.getElementById('tp-clear-completed');
    if (clearCompletedBtn) clearCompletedBtn.onclick = api.clearCompleted;

    /* ---- Dev toolbar (unchanged from the desktop app) ---- */
    const devToolbarBtn = document.getElementById('tp-dev-toolbar-btn');
    if (devToolbarBtn) devToolbarBtn.onclick = () => { api.devPanelOpen = !api.devPanelOpen; api.saveDevPanelOpen(); api.render(); };
    const devTriggerNotify = document.getElementById('tp-dev-trigger-notify');
    if (devTriggerNotify) devTriggerNotify.onclick = () => {
      if (!('Notification' in window)) { alert('This browser does not support desktop notifications.'); return; }
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') new Notification('🧪 Dev ping', { body: 'A little planner nudge just for testing ✨', icon: 'icons/icon-192.png' });
        else alert('Notification permission denied.');
      });
    };
    const devAdvance1 = document.getElementById('tp-dev-advance-1');
    if (devAdvance1) devAdvance1.onclick = () => {
      const offset = Number(localStorage.getItem(api.DAY_OFFSET_KEY) || 0);
      localStorage.setItem(api.DAY_OFFSET_KEY, String(offset + 1));
      alert('Simulated moving forward 1 day. Reloading...');
      location.reload();
    };
    const devAdvance7 = document.getElementById('tp-dev-advance-7');
    if (devAdvance7) devAdvance7.onclick = () => {
      const offset = Number(localStorage.getItem(api.DAY_OFFSET_KEY) || 0);
      localStorage.setItem(api.DAY_OFFSET_KEY, String(offset + 7));
      alert('Simulated moving forward 7 days. Reloading...');
      location.reload();
    };
    const devReset = document.getElementById('tp-dev-reset');
    const devResetConfirm = document.getElementById('tp-dev-reset-confirm');
    if (devReset && devResetConfirm) {
      devReset.onclick = () => { devResetConfirm.style.display = 'block'; };
      const yesBtn = document.getElementById('tp-dev-reset-confirm-yes');
      const noBtn = document.getElementById('tp-dev-reset-confirm-no');
      if (yesBtn) yesBtn.onclick = () => { localStorage.clear(); sessionStorage.clear(); location.reload(); };
      if (noBtn) noBtn.onclick = () => { devResetConfirm.style.display = 'none'; };
    }
    const devExit = document.getElementById('tp-dev-exit');
    if (devExit) devExit.onclick = () => { api.deactivateDevMode(); api.render(); };

    /* ---- Courses screen ---- */
    root.querySelectorAll('.tp-c-name[data-course-id]').forEach(inp => {
      inp.addEventListener('change', () => {
        const id = inp.dataset.courseId;
        const newName = inp.value.trim();
        const course = window.TPCourses.byId(api.courses, id);
        if (course && newName && newName !== course.name) {
          if ((api.allFilterCourse || '').toLowerCase() === course.name.toLowerCase()) api.allFilterCourse = newName;
          window.TPCourses.renameCourse(api.items, api.courses, id, newName);
          api.saveCourses();
          api.save();
        } else {
          api.render();
        }
      });
    });
    root.querySelectorAll('.tp-c-swatch[data-course-id]').forEach(sw => sw.onclick = () => {
      window.TPCourses.setCourseColor(api.courses, sw.dataset.courseId, sw.dataset.color);
      api.saveCourses();
      api.render();
    });
    root.querySelectorAll('[data-delete-course]').forEach(b => b.onclick = () => {
      const id = b.dataset.deleteCourse;
      const course = window.TPCourses.byId(api.courses, id);
      if (course && (api.allFilterCourse || '').toLowerCase() === course.name.toLowerCase()) api.allFilterCourse = '';
      window.TPCourses.deleteCourse(api.courses, id);
      api.saveCourses();
      api.render();
    });
    const newCourseNameInput = document.getElementById('tp-c-new-name');
    if (newCourseNameInput) newCourseNameInput.oninput = (e) => {
      api.newCourseName = e.target.value;
      api.pendingFocus = { id: 'tp-c-new-name', selStart: e.target.selectionStart, selEnd: e.target.selectionEnd };
      api.render();
    };
    root.querySelectorAll('.tp-c-new-swatch').forEach(sw => sw.onclick = () => { api.newCourseColor = sw.dataset.color; api.render(); });
    const addCourseBtn = document.getElementById('tp-c-add');
    if (addCourseBtn) addCourseBtn.onclick = () => {
      const created = window.TPCourses.addCourse(api.courses, api.newCourseName, api.newCourseColor);
      if (created) {
        api.lastAddedCourseId = created.id;
        api.newCourseName = '';
        api.newCourseColor = window.TPCourses.nextPaletteColor(api.courses);
        api.saveCourses();
      }
      api.render();
    };
    const backBtn = document.getElementById('tp-c-back');
    if (backBtn) backBtn.onclick = () => { api.tab = 'settings'; api.savePrefs(); api.render(); };

    /* ---- Add sheet ---- */
    const sheetBackdrop = document.getElementById('tp-sheet-backdrop');
    if (sheetBackdrop) sheetBackdrop.addEventListener('click', (e) => {
      if (e.target === sheetBackdrop) { api.closeAddSheet(); api.render(); }
    });
    // Keep the sheet's own bottom (the pacing hint + submit button) above the
    // iOS keyboard: fixed elements don't resize when the keyboard opens, so
    // the visual viewport shrinking is the only signal available for this.
    if (window.visualViewport) {
      const sheet = document.getElementById('tp-sheet');
      const onVV = () => {
        if (!document.getElementById('tp-sheet')) {
          window.visualViewport.removeEventListener('resize', onVV);
          return;
        }
        sheet.style.paddingBottom =
          Math.max(24, window.innerHeight - window.visualViewport.height + 24) + 'px';
      };
      window.visualViewport.addEventListener('resize', onVV);
    }
    const sheetCancel = document.getElementById('tp-sheet-cancel');
    if (sheetCancel) sheetCancel.onclick = () => { api.closeAddSheet(); api.render(); };
    const addTitle = document.getElementById('tp-add-title');
    if (addTitle) addTitle.oninput = (e) => {
      api.draft.title = e.target.value;
      api.pendingFocus = { id: 'tp-add-title', selStart: e.target.selectionStart, selEnd: e.target.selectionEnd };
      api.render();
    };
    const addUnit = document.getElementById('tp-add-unit');
    if (addUnit) addUnit.oninput = (e) => {
      api.draft.unit = e.target.value;
      api.pendingFocus = { id: 'tp-add-unit', selStart: e.target.selectionStart, selEnd: e.target.selectionEnd };
      api.render();
    };
    const addDue = document.getElementById('tp-add-due');
    if (addDue) addDue.oninput = (e) => { api.draft.due = e.target.value; api.pendingFocus = { id: 'tp-add-due' }; api.render(); };
    const addAmount = document.getElementById('tp-add-amount');
    if (addAmount) addAmount.oninput = (e) => { api.draft.amount = Math.max(1, parseInt(e.target.value) || 1); api.pendingFocus = { id: 'tp-add-amount' }; api.render(); };
    const addMinus = document.getElementById('tp-add-minus');
    if (addMinus) addMinus.onclick = () => { api.draft.amount = Math.max(1, (Number(api.draft.amount) || 1) - 1); api.render(); };
    const addPlus = document.getElementById('tp-add-plus');
    if (addPlus) addPlus.onclick = () => { api.draft.amount = (Number(api.draft.amount) || 1) + 1; api.render(); };
    const courseTrigger = document.getElementById('tp-add-course-trigger');
    if (courseTrigger) courseTrigger.onclick = () => { api.pickerOpen = !api.pickerOpen; api.render(); };
    root.querySelectorAll('.tp-add-course-option[data-course-id]').forEach(opt => opt.onclick = () => {
      api.draft.courseId = opt.dataset.courseId;
      api.pickerOpen = false;
      api.render();
    });
    const manageFromSheet = document.getElementById('tp-add-manage-courses');
    if (manageFromSheet) manageFromSheet.onclick = () => {
      api.closeAddSheet();
      api.tab = 'courses';
      api.savePrefs();
      api.render();
    };
    const addSubmit = document.getElementById('tp-add-submit');
    if (addSubmit) addSubmit.onclick = () => {
      const titleEl = document.getElementById('tp-add-title');
      const dueEl = document.getElementById('tp-add-due');
      const title = api.draft.title.trim();
      const due = api.draft.due;
      [titleEl, dueEl].forEach(el => el && el.classList.remove('tp-field-error'));
      if (!title || !due) {
        if (!title && titleEl) titleEl.classList.add('tp-field-error');
        if (!due && dueEl) dueEl.classList.add('tp-field-error');
        return;
      }
      const amount = Math.max(1, Number(api.draft.amount) || 1);
      const course = window.TPCourses.byId(api.courses, api.draft.courseId);
      const courseName = course ? course.name : '';
      const unit = api.draft.unit.trim();
      if (api.editIndex !== null) {
        const it = api.items[api.editIndex];
        it.title = title; it.course = courseName; it.due = due; it.total = amount; it.unit = unit;
        it.done = Math.min(it.done, amount);
        api.touchItem(it);
        if (api.isDevModeTrigger(it.title, it.total)) api.activateDevMode();
      } else {
        const maxOrder = api.items.reduce((m, x) => Math.max(m, x.order ?? -1), -1);
        api.items.push({
          id: api.newItemId(), title, course: courseName, due, total: amount, unit,
          notes: '', done: 0, today: 0, completed: false, dependsOn: '', recurring: '',
          subtasks: [], completedAt: null, createdAt: api.today(), archived: false,
          order: maxOrder + 1, updatedAt: Date.now(),
        });
        if (api.isDevModeTrigger(title, amount)) api.activateDevMode();
        api.tab = 'today';
        api.savePrefs();
      }
      api.closeAddSheet();
      api.save();
    };

    // Restore focus to whatever the user was interacting with before this render.
    if (api.pendingFocus) {
      const el = document.getElementById(api.pendingFocus.id);
      if (el) {
        el.focus();
        if (api.pendingFocus.selStart != null && el.setSelectionRange) {
          try { el.setSelectionRange(api.pendingFocus.selStart, api.pendingFocus.selEnd); } catch (e) {}
        }
      }
    }
    api.pendingFocus = null;
  }

  global.TPBind = { bindEvents };
})(typeof window !== 'undefined' ? window : globalThis);
