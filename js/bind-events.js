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

    // Undo the last finished part (assignment detail): done and, if it was logged today, today go back by one.
    function undoOne(idx) {
      const it = api.items[idx];
      if (!it || !(it.done > 0)) return;
      it.done -= 1;
      if ((it.today || 0) > 0) it.today -= 1;
      if (it.completed) { it.completed = false; it.completedAt = null; it.archived = false; }
      api.touchItem(it);
      api.save();
    }

    root.querySelectorAll('.tp-log').forEach(b => b.onclick = () => logOne(parseInt(b.dataset.i), b));
    root.querySelectorAll('.tp-complete').forEach(b => b.onclick = () => toggleComplete(parseInt(b.dataset.i)));

    /* ---- Tab bar ---- */
    root.querySelectorAll('.tp-tab[data-tab]').forEach(b => b.onclick = () => {
      api.tab = b.dataset.tab;
      api.savePrefs();
      api.render();
    });
    const addToggle = document.getElementById('tp-add-toggle');
    if (addToggle) addToggle.onclick = () => { api.openAddSheet(); api.render(); };
    const heavyLine = document.getElementById('tp-t-heavy');
    if (heavyLine) heavyLine.onclick = () => { api.tab = 'week'; api.savePrefs(); api.render(); };
    const openSettings = document.getElementById('tp-open-settings');
    if (openSettings) openSettings.onclick = () => { api.tab = 'settings'; api.savePrefs(); api.render(); };
    const openChanges = document.getElementById('tp-open-changes');
    if (openChanges) openChanges.onclick = () => api.openChanges();
    const chBack = document.getElementById('tp-ch-back');
    if (chBack) chBack.onclick = () => api.closeChanges();
    ['new','moved','grade','feedback','due'].forEach((k) => {
      const t = document.getElementById('tp-al-' + k);
      if (t) t.onclick = () => api.savePrefsToServer({ [k]: !api.alerts.prefs[k] });
    });
    const alQuiet = document.getElementById('tp-al-quiet');
    if (alQuiet) alQuiet.onclick = () => api.savePrefsToServer({ quiet: { on: !api.alerts.prefs.quiet.on } });
    const alQs = document.getElementById('tp-al-qstart');
    if (alQs) alQs.onchange = (e) => api.savePrefsToServer({ quiet: { start: Number(e.target.value) } });
    const alQe = document.getElementById('tp-al-qend');
    if (alQe) alQe.onchange = (e) => api.savePrefsToServer({ quiet: { end: Number(e.target.value) } });
    const alTest = document.getElementById('tp-al-test');
    if (alTest) alTest.onclick = () => api.sendTestAlert();
    const openAll = document.getElementById('tp-open-all');
    if (openAll) openAll.onclick = () => { api.tab = 'all'; api.savePrefs(); api.render(); };
    const allBack = document.getElementById('tp-all-back');
    if (allBack) allBack.onclick = () => { api.tab = 'week'; api.savePrefs(); api.render(); };

    /* ---- Today screen: tap a row body to open the quick-action menu ---- */
    root.querySelectorAll('.tp-t-row, .tp-t-ahead-row').forEach(row => {
      row.onclick = (e) => {
        if (e.target.closest('.tp-t-action') || e.target.closest('.tp-t-ahead-more')) return;
        const idx = Number(row.dataset.itemI);
        if (Number.isNaN(idx)) return;
        const it = api.items[idx];
        // Imported work opens its plan-first detail screen; manual items keep the quick-action menu.
        if (it && it.source && it.source.type === 'moodle' && it.estimate) api.openItem(it.id);
        else { api.menuFor = idx; api.render(); }
      };
    });

    /* ---- Assignment detail ---- */
    const itemBack = document.getElementById('tp-i-back');
    if (itemBack) itemBack.onclick = () => api.closeItem();
    root.querySelectorAll('.tp-i-part').forEach(b => b.onclick = () => {
      const idx = parseInt(b.dataset.i);
      const part = parseInt(b.dataset.part);
      const it = api.items[idx];
      if (!it) return;
      if (part === (it.done || 0) && !it.completed) logOne(idx, b);
      else if (part === (it.done || 0) - 1) undoOne(idx);
    });
    root.querySelectorAll('.tp-i-step[data-delta]').forEach(b => b.onclick = () => api.adjustEstimate(api.itemDetailId, Number(b.dataset.delta)));
    const itemAsk = document.getElementById('tp-i-ask');
    if (itemAsk) itemAsk.onclick = () => api.askClaude(api.itemDetailId);
    const filesToggle = document.getElementById('tp-files-toggle');
    if (filesToggle) filesToggle.onclick = () => api.setFilesOn(!api.filesOn);
    const llmToggle = document.getElementById('tp-llm-toggle');
    if (llmToggle) llmToggle.onclick = () => api.setLlmOn(!api.llmOn);
    const itemReset = document.getElementById('tp-i-reset');
    if (itemReset) itemReset.onclick = () => api.resetEstimate(api.itemDetailId);
    const itemDescToggle = document.getElementById('tp-i-desc-toggle');
    if (itemDescToggle) itemDescToggle.onclick = () => { api.itemDescOpen = !api.itemDescOpen; api.render(); };
    const itemNotes = document.getElementById('tp-i-notes');
    if (itemNotes) itemNotes.oninput = (e) => api.setItemNotes(api.itemDetailId, e.target.value);
    const itemMore = document.getElementById('tp-i-more');
    if (itemMore) itemMore.onclick = () => { api.menuFor = Number(itemMore.dataset.i); api.render(); };

    /* ---- All screen ----
       The header (search input, sort/course chips) lives outside
       #tp-a-results and is never rebuilt while typing, so the clear
       button's visibility - the one piece of the header that depends on
       searchTerm - is toggled directly via [hidden] instead of relying on
       a re-render to add/remove it. */
    const search = document.getElementById('tp-a-search');
    if (search) search.oninput = (e) => {
      api.searchTerm = e.target.value;
      api.savePrefs();
      const clearBtn = document.getElementById('tp-a-search-clear');
      if (clearBtn) clearBtn.hidden = !e.target.value;
      api.patch('tp-a-results', window.TPViews.allResultsHtml(api.allCtx()));
    };
    const searchClear = document.getElementById('tp-a-search-clear');
    if (searchClear) searchClear.onclick = () => {
      api.searchTerm = '';
      api.savePrefs();
      const inp = document.getElementById('tp-a-search');
      if (inp) { inp.value = ''; inp.focus(); }
      searchClear.hidden = true;
      api.patch('tp-a-results', window.TPViews.allResultsHtml(api.allCtx()));
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
    // Close the menu (state only, no render yet) before the action - logOne/
    // toggleComplete already end in api.save(), which renders. Closing
    // first means that one render shows the menu gone; no second render.
    const qmLog = document.getElementById('tp-qm-log');
    if (qmLog) qmLog.onclick = () => { api.menuFor = null; logOne(parseInt(qmLog.dataset.i), qmLog); };
    const qmComplete = document.getElementById('tp-qm-complete');
    if (qmComplete) qmComplete.onclick = () => { api.menuFor = null; toggleComplete(parseInt(qmComplete.dataset.i)); };
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
      api.render(); // close the menu immediately - deleteItemAt's own
      // card-removal animation (or its timeout fallback) shouldn't gate that
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
    const hourSelect = document.getElementById('tp-notify-hour');
    if (hourSelect) hourSelect.onchange = (e) => {
      api.setNotifyHour(Number(e.target.value));
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
    if (manageBtn) manageBtn.onclick = () => { api.tab = 'manage'; api.savePrefs(); api.render(); };
    const exportBtn = document.getElementById('tp-export');
    if (exportBtn) exportBtn.onclick = api.exportData;
    const exportIcsBtn = document.getElementById('tp-export-ics');
    if (exportIcsBtn) exportIcsBtn.onclick = api.exportIcs;
    const importGradesEl = document.getElementById('tp-import-grades');
    if (importGradesEl) importGradesEl.onchange = (e) => { if (e.target.files[0]) api.importGradeSettings(e.target.files[0]); };
    const importEl = document.getElementById('tp-import');
    if (importEl) importEl.onchange = (e) => { if (e.target.files[0]) api.importData(e.target.files[0]); };
    const clearCompletedBtn = document.getElementById('tp-clear-completed');
    if (clearCompletedBtn) clearCompletedBtn.onclick = api.clearCompleted;

    /* ---- Courses tab + Course detail ---- */
    root.querySelectorAll('.tp-g-card[data-course]').forEach(b => b.onclick = () => api.openCourse(b.dataset.course));
    const gToSettings = document.getElementById('tp-g-to-settings');
    if (gToSettings) gToSettings.onclick = () => { api.tab = 'settings'; api.savePrefs(); api.render(); };
    const gBack = document.getElementById('tp-g-back');
    if (gBack) gBack.onclick = () => { api.tab = 'courses'; api.savePrefs(); api.render(); };
    // Weights: model only + patch the one summary node (never rebuild the focused input).
    root.querySelectorAll('.tp-g-weight[data-weight-id]').forEach(inp => inp.oninput = (e) => {
      api.setWeight(inp.dataset.weightId, e.target.value);
      api.patch('tp-g-summary', api.gradeSummaryHtml());
    });
    root.querySelectorAll('.tp-g-step[data-g-step]').forEach(b => b.onclick = () => {
      api.stepCourseSetting(api.courseDetailName, b.dataset.gStep, Number(b.dataset.dir));
    });
    const clsInput = document.getElementById('tp-cls-input');
    if (clsInput) clsInput.onchange = (e) => { if (!api.setMeets(clsInput.dataset.course, e.target.value)) e.target.value = ''; };
    const gUseSuggested = document.getElementById('tp-g-use-suggested');
    if (gUseSuggested) gUseSuggested.onclick = () => api.useSuggestedWeights(api.courseDetailName);

    /* ---- Moodle (Settings group + Connect sheet) ---- */
    const moodleConnectBtn = document.getElementById('tp-moodle-connect');
    if (moodleConnectBtn) moodleConnectBtn.onclick = () => { api.openConnectSheet(); api.render(); };
    const moodleSyncBtn = document.getElementById('tp-moodle-sync');
    if (moodleSyncBtn) moodleSyncBtn.onclick = () => api.moodleSync({ silent: false });
    const moodleDisconnectBtn = document.getElementById('tp-moodle-disconnect');
    if (moodleDisconnectBtn) moodleDisconnectBtn.onclick = api.moodleDisconnect;
    root.querySelectorAll('[data-moodle-course]').forEach(b => b.onclick = () => {
      api.moodleSetCourse(Number(b.dataset.moodleCourse), b.getAttribute('aria-checked') !== 'true');
    });

    const connectBackdrop = document.getElementById('tp-connect-backdrop');
    if (connectBackdrop) connectBackdrop.addEventListener('click', (e) => {
      if (e.target === connectBackdrop && !api.connectBusy) { api.closeConnectSheet(); api.render(); }
    });
    const connectCancel = document.getElementById('tp-connect-cancel');
    if (connectCancel) connectCancel.onclick = () => { api.closeConnectSheet(); api.render(); };
    // Model-only fields (same rule as the Add sheet): typing never re-renders.
    [['tp-connect-site', 'site'], ['tp-connect-user', 'username'], ['tp-connect-pass', 'password']].forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.oninput = (e) => { api.connectDraft[key] = e.target.value; };
      el.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); api.moodleConnect(); } };
    });
    const connectSubmit = document.getElementById('tp-connect-submit');
    if (connectSubmit) connectSubmit.onclick = () => api.moodleConnect();

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
      const btn = document.getElementById('tp-c-add');
      if (btn) btn.disabled = !e.target.value.trim();
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
    // Keeping the sheet's bottom above the iOS keyboard (js/boot.js's single
    // persistent visualViewport listener) doesn't need re-wiring here on
    // every render - it looks up #tp-sheet fresh each time it fires.
    const sheetCancel = document.getElementById('tp-sheet-cancel');
    if (sheetCancel) sheetCancel.onclick = () => { api.closeAddSheet(); api.render(); };
    // Model-only fields: nothing else on screen depends on what's typed, so
    // just update the draft - no render(), no patch(), no pendingFocus. The
    // input is never touched, so it can't lose focus or its caret position.
    const addTitle = document.getElementById('tp-add-title');
    if (addTitle) addTitle.oninput = (e) => { api.draft.title = e.target.value; };
    const addMinutes = document.getElementById('tp-add-minutes');
    if (addMinutes) addMinutes.oninput = (e) => { api.draft.minutes = e.target.value; };
    const addNotes = document.getElementById('tp-add-notes');
    if (addNotes) addNotes.oninput = (e) => { api.draft.notes = e.target.value; };

    function refreshHint() {
      const el = document.getElementById('tp-add-hint');
      if (el) el.innerHTML = window.TPViews.pacingHintHtml(api.draft, api.today, api.daysBetween);
    }

    const addUnit = document.getElementById('tp-add-unit');
    if (addUnit) addUnit.oninput = (e) => { api.draft.unit = e.target.value; refreshHint(); };
    const addDue = document.getElementById('tp-add-due');
    if (addDue) addDue.oninput = (e) => { api.draft.due = e.target.value; refreshHint(); };
    const addAmount = document.getElementById('tp-add-amount');
    if (addAmount) addAmount.oninput = (e) => {
      api.draft.amount = Math.max(1, parseInt(e.target.value) || 1);
      refreshHint();
    };
    // Steppers are clicks, not typing, but they shouldn't steal focus from
    // the amount field either - patch instead of a full render().
    const addMinus = document.getElementById('tp-add-minus');
    if (addMinus) addMinus.onclick = () => {
      api.draft.amount = Math.max(1, (Number(api.draft.amount) || 1) - 1);
      const inp = document.getElementById('tp-add-amount');
      if (inp) inp.value = api.draft.amount;
      refreshHint();
    };
    const addPlus = document.getElementById('tp-add-plus');
    if (addPlus) addPlus.onclick = () => {
      api.draft.amount = (Number(api.draft.amount) || 1) + 1;
      const inp = document.getElementById('tp-add-amount');
      if (inp) inp.value = api.draft.amount;
      refreshHint();
    };
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
      api.tab = 'manage';
      api.savePrefs();
      api.render();
    };

    const addMore = document.getElementById('tp-add-more');
    if (addMore) addMore.onclick = () => { api.moreOpen = !api.moreOpen; api.render(); };

    const addSubtasks = document.getElementById('tp-add-subtasks');
    if (addSubtasks) addSubtasks.oninput = (e) => {
      api.draft.subtasksText = e.target.value;
      const n = e.target.value.split('\n').map(s => s.trim()).filter(Boolean).length;
      const el = document.getElementById('tp-add-subcount');
      if (el) el.textContent = n ? n + (n === 1 ? ' subtask' : ' subtasks') : 'Each line becomes its own checkbox.';
    };

    root.querySelectorAll('.tp-add-seg-opt[data-repeat]').forEach(b => b.onclick = () => {
      api.draft.recurring = b.dataset.repeat;
      api.render();
    });

    const prereqTrigger = document.getElementById('tp-add-prereq-trigger');
    if (prereqTrigger) prereqTrigger.onclick = () => { api.prereqOpen = !api.prereqOpen; api.render(); };

    root.querySelectorAll('.tp-add-course-option[data-prereq]').forEach(opt => opt.onclick = () => {
      api.draft.dependsOn = opt.dataset.prereq;
      api.prereqOpen = false;
      api.render();
    });

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
      const notes = (api.draft.notes || '').trim();
      // {text, done} matches the shape makeRecurringClone (js/app.js) and the
      // rest of the codebase already use - not {title, done}.
      const subtasks = (api.draft.subtasksText || '')
        .split('\n').map(s => s.trim()).filter(Boolean)
        .map(t => ({ text: t, done: false }));
      const recurring = api.draft.recurring || '';
      const dependsOn = api.draft.dependsOn || '';
      const minutes = Number(api.draft.minutes) || 0;
      if (api.editIndex !== null) {
        const it = api.items[api.editIndex];
        const oldTitle = it.title;
        it.title = title; it.course = courseName; it.due = due; it.total = amount; it.unit = unit;
        it.done = Math.min(it.done, amount);
        it.notes = notes;
        it.recurring = recurring;
        it.dependsOn = dependsOn;
        it.subtasks = subtasks.map(st => {
          const prev = (it.subtasks || []).find(p => p.text === st.text);
          return prev ? { ...st, done: prev.done } : st;
        });
        // dependsOn matches by title (see js/item-logic.js), so a rename has
        // to carry forward into anything that was depending on the old one.
        if (oldTitle !== title) {
          api.items.forEach(x => { if (x.dependsOn === oldTitle) x.dependsOn = title; });
        }
        if (!api.draft.imported) {
          // A time estimate typed here is the user's own; clearing the field removes it.
          if (minutes > 0) it.estimate = window.TPEstimate.userEstimate(minutes);
          else if (it.estimate && it.estimate.basis === 'user') delete it.estimate;
        }
        api.touchItem(it);
        if (api.isDevModeTrigger(it.title, it.total)) api.activateDevMode();
      } else {
        const maxOrder = api.items.reduce((m, x) => Math.max(m, x.order ?? -1), -1);
        const created = {
          id: api.newItemId(), title, course: courseName, due, total: amount, unit,
          notes, done: 0, today: 0, completed: false, dependsOn, recurring,
          subtasks, completedAt: null, createdAt: api.today(), archived: false,
          order: maxOrder + 1, updatedAt: Date.now(),
        };
        if (minutes > 0) created.estimate = window.TPEstimate.userEstimate(minutes);
        api.items.push(created);
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

    // The enter-animation classes only need to paint once; clear all three so
    // the next render doesn't replay them.
    api.sheetJustOpened = false;
    api.menuJustOpened = false;
    api.screenJustSwitched = false;
  }

  global.TPBind = { bindEvents };
})(typeof window !== 'undefined' ? window : globalThis);
