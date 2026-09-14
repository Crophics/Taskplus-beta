/* app.js — Main Taskplus application
   Depends on: js/utils.js, js/toast.js, js/html.js, js/theme.js, js/notify.js,
   js/io.js, js/courses.js, js/all-logic.js, js/week-logic.js, js/views/*,
   js/today-logic.js, js/bind-events.js, js/boot.js, firebase-sync.js
*/
(function(){
  /* ---- Storage keys & sync ---- */
  const KEY='tp-assignments';
  function syncPush(){
    if(!window.tpSync) return;
    let prefsNow = {};
    try{ prefsNow = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); }catch(e){}
    const { theme: _theme, tab: _tab, ...syncPrefs } = prefsNow;
    window.tpSync.push({
      items,
      courseColors,
      courses,
      dayCompleteLog,
      deletedLog,
      prefs: syncPrefs
    });
  }
  const PREFS_KEY='tp-prefs';
  const COURSE_COLORS_KEY='tp-course-colors';
  const COURSES_KEY='tp-courses';
  const LAST_ACTIVE_DATE_KEY='tp-last-active-date';
  const DAY_COMPLETE_LOG_KEY='tp-day-complete-log';
  const DELETED_LOG_KEY='tp-deleted-log';
  const TOMBSTONE_MAX_AGE_MS = 120*24*60*60*1000; // keep in sync with firebase-sync.js
  const DEV_MODE_KEY='tp-dev-mode';
  const DEV_PANEL_KEY='tp-dev-panel-open';
  const DAY_OFFSET_KEY='tp-day-offset';
  const ARCHIVE_AFTER_DAYS=14;

  /* ---- State ---- */
  let items = JSON.parse(localStorage.getItem(KEY) || '[]');
  function newItemId(){
    if(window.tpSync && window.tpSync.newId) return window.tpSync.newId();
    if(typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'tp-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
  }
  function touchItem(it){
    if(!it.id) it.id = newItemId();
    it.updatedAt = Date.now();
    return it;
  }
  let idsMigrated = false;
  items.forEach(it=>{
    if(!it.id){ it.id = newItemId(); idsMigrated = true; }
    if(it.updatedAt==null){ it.updatedAt = Date.now(); idsMigrated = true; }
  });
  if(idsMigrated) localStorage.setItem(KEY, JSON.stringify(items));

  // Day rollover: the `today` pacing counter (js/today-logic.js) only means
  // anything for the calendar day it was logged on, so reset it the first
  // time the app runs on a new day.
  {
    const storedActiveDate = localStorage.getItem(LAST_ACTIVE_DATE_KEY);
    const nowDate = window.TP.today();
    if(window.TPTodayLogic.resetTodayCounters(items, storedActiveDate, nowDate)){
      localStorage.setItem(KEY, JSON.stringify(items));
    }
    localStorage.setItem(LAST_ACTIVE_DATE_KEY, nowDate);
  }

  /* ---- Courses ---- */
  let courses = [];
  try{ courses = JSON.parse(localStorage.getItem(COURSES_KEY)) || []; }catch(e){ courses = []; }
  if(!localStorage.getItem(COURSES_KEY)){
    courses = window.TPCourses.migrateFromItems(items, courseColorsForMigration());
    localStorage.setItem(COURSES_KEY, JSON.stringify(courses));
  }
  function courseColorsForMigration(){
    try{ return JSON.parse(localStorage.getItem(COURSE_COLORS_KEY)) || {}; }catch(e){ return {}; }
  }
  function saveCourses(){ localStorage.setItem(COURSES_KEY, JSON.stringify(courses)); syncPush(); }

  document.addEventListener('tp-remote-data', function(){
    items = JSON.parse(localStorage.getItem(KEY) || '[]');
    try{ courseColors = JSON.parse(localStorage.getItem(COURSE_COLORS_KEY)) || {}; }catch(e){ courseColors = {}; }
    try{ courses = JSON.parse(localStorage.getItem(COURSES_KEY)) || []; }catch(e){ courses = []; }
    try{ dayCompleteLog = JSON.parse(localStorage.getItem(DAY_COMPLETE_LOG_KEY)) || []; }catch(e){ dayCompleteLog = []; }
    try{ deletedLog = JSON.parse(localStorage.getItem(DELETED_LOG_KEY)) || []; }catch(e){ deletedLog = []; }
    let p = {};
    try{ p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); }catch(e){}
    if(p.allSortMode !== undefined) allSortMode = p.allSortMode;
    if(p.searchTerm !== undefined) searchTerm = p.searchTerm;
    if(p.notifyHour !== undefined && Number.isInteger(p.notifyHour)) notifyHour = p.notifyHour;
    if(p.notifyDigest !== undefined) notifyDigest = !!p.notifyDigest;
    render();
  });
  let devMode = localStorage.getItem(DEV_MODE_KEY) === '1';
  let devPanelOpen = localStorage.getItem(DEV_PANEL_KEY) === '1';
  let editIndex = null; // set while the Add sheet is editing an existing item
  // Tracks which element should regain focus after the next render, as
  // {id, selStart, selEnd}.
  let pendingFocus = null;
  let celebrationPending = null;

  let prefs = {};
  try{ prefs = JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }catch(e){ prefs = {}; }
  let searchTerm = prefs.searchTerm || ''; // All-tab search text
  let theme = ['dark','light','blue','auto'].includes(prefs.theme) ? prefs.theme : 'dark';
  const TABS = ['today','all','week','settings','courses'];
  let tab = TABS.includes(prefs.tab) ? prefs.tab : 'today';
  let addOpen = false;
  let pickerOpen = false;
  let moreOpen = false; // add-sheet "Notes, subtasks, repeat, dependency" disclosure
  let prereqOpen = false; // add-sheet "Do this after" picker
  let menuFor = null; // index into `items`, for the quick-action menu
  // One-shot "just opened" flags so the sheet/menu animate in on open only,
  // not on every re-render (see js/bind-events.js, which clears both at the
  // end of every bindEvents pass so the class only paints once).
  let sheetJustOpened = false;
  let menuJustOpened = false;
  let allSortMode = prefs.allSortMode || 'urgency';
  let allFilterCourse = '';
  let weekSelDay = 0;
  let draft = null; // in-progress Add-sheet form state, see js/views/add-sheet-html.js
  let newCourseName = '';
  let newCourseColor = window.TPCourses.nextPaletteColor(courses);
  let lastAddedCourseId = null;
  // Which hour (0-23, local time) the server-side digest fires at. Mirrors
  // functions/index.js's own default of 8 for a brand new user who hasn't
  // touched the picker yet.
  let notifyHour = Number.isInteger(prefs.notifyHour) ? prefs.notifyHour : 8;
  let notifyDigest = prefs.notifyDigest !== false; // default on

  // Legacy field: no longer written from this app (see courseColorFor()
  // below), only read + round-tripped through syncPush so a push from here
  // doesn't blank it out for the desktop app on the same account.
  let courseColors = {};
  try{ courseColors = JSON.parse(localStorage.getItem(COURSE_COLORS_KEY)) || {}; }catch(e){ courseColors = {}; }

  // Logged only on days where nothing required is left - not just "did
  // something" - so the streak reflects actually staying caught up.
  let dayCompleteLog = [];
  try{ dayCompleteLog = JSON.parse(localStorage.getItem(DAY_COMPLETE_LOG_KEY)) || []; }catch(e){ dayCompleteLog = []; }
  function saveDayCompleteLog(){ localStorage.setItem(DAY_COMPLETE_LOG_KEY, JSON.stringify(dayCompleteLog)); syncPush(); }
  function logDayComplete(){
    const t = today();
    const daySet = new Set(dayCompleteLog);
    if(!daySet.has(t)){
      dayCompleteLog.push(t);
      saveDayCompleteLog();
    }
  }

  // Deletion tombstones: {id, deletedAt}. Without these, syncing with a
  // device that hasn't seen a deletion yet can't tell "item I haven't
  // synced yet" apart from "item someone deleted" - it just re-adds it,
  // which is how deleted assignments used to come back after a sync.
  // See firebase-sync.js's mergeItems/mergeDeletedLog for the merge side.
  let deletedLog = [];
  try{ deletedLog = JSON.parse(localStorage.getItem(DELETED_LOG_KEY)) || []; }catch(e){ deletedLog = []; }
  function saveDeletedLog(){ localStorage.setItem(DELETED_LOG_KEY, JSON.stringify(deletedLog)); syncPush(); }
  function tombstoneItem(id){
    if(!id) return;
    const now = Date.now();
    const existing = deletedLog.find(t=>t.id===id);
    if(existing) existing.deletedAt = now;
    else deletedLog.push({id, deletedAt: now});
  }
  function untombstoneItem(id){
    deletedLog = deletedLog.filter(t=>t.id!==id);
  }
  function pruneDeletedLog(){
    const cutoff = Date.now() - TOMBSTONE_MAX_AGE_MS;
    const before = deletedLog.length;
    deletedLog = deletedLog.filter(t=> (t.deletedAt||0) >= cutoff);
    if(deletedLog.length !== before) localStorage.setItem(DELETED_LOG_KEY, JSON.stringify(deletedLog));
  }
  pruneDeletedLog();

  function savePrefs(){
    localStorage.setItem(PREFS_KEY, JSON.stringify({searchTerm,theme,notifyHour,notifyDigest,tab,allSortMode}));
    syncPush();
  }

  /* ---- Toast (js/toast.js) ---- */
  const showToast = window.TPToast.show;

  /* ---- Theme ---- */
  function applyTheme(){
    window.TPTheme.applyTheme(theme);
  }
  applyTheme();
  window.TPTheme.watchSystemTheme(() => theme);

  const root = document.getElementById('tp-app');

  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape'){
      if(menuFor!==null){ menuFor = null; render(); return; }
      if(addOpen){ closeAddSheet(); render(); return; }
    }
  });

  // Rendering reads colors from the `courses` collection (js/courses.js) via
  // courseColorFor() below, backed by the `courses` collection.
  function courseColorFor(name){ return window.TPCourses.colorFor(courses, name); }
  const contrastTextColor = window.TP.contrastTextColor;

  function openAddSheet(idx){
    if(idx!=null && items[idx]){
      const it = items[idx];
      const course = window.TPCourses.byName(courses, it.course);
      editIndex = idx;
      draft = {
        title: it.title, courseId: course ? course.id : null, due: it.due, amount: it.total, unit: it.unit || '',
        notes: it.notes || '', subtasksText: (it.subtasks || []).map(s => s.text).join('\n'),
        recurring: it.recurring || '', dependsOn: it.dependsOn || '',
      };
    } else {
      editIndex = null;
      const preselected = lastAddedCourseId && window.TPCourses.byId(courses, lastAddedCourseId) ? lastAddedCourseId : null;
      draft = { title: '', courseId: preselected, due: '', amount: 1, unit: '', notes: '', subtasksText: '', recurring: '', dependsOn: '' };
    }
    pickerOpen = false;
    moreOpen = false;
    prereqOpen = false;
    addOpen = true;
    sheetJustOpened = true;
  }
  function closeAddSheet(){
    addOpen = false;
    pickerOpen = false;
    moreOpen = false;
    prereqOpen = false;
    editIndex = null;
    draft = null;
    sheetJustOpened = false;
  }

  const burstConfetti = window.TP.burstConfetti;
  function save(){
    items.forEach(it=>{ if(!it.id) it.id = newItemId(); });
    localStorage.setItem(KEY, JSON.stringify(items));
    render();
    syncPush();
  }
  function triggerCelebration(x, y, big){ celebrationPending = {x, y, big: !!big}; }
  function saveDevMode(){ localStorage.setItem(DEV_MODE_KEY, devMode ? '1' : '0'); }
  function saveDevPanelOpen(){ localStorage.setItem(DEV_PANEL_KEY, devPanelOpen ? '1' : '0'); }
  function isDevModeTrigger(title, total){
    return String(title || '').trim().toLowerCase() === 'dev mode' && Number(total) === 101;
  }
  function activateDevMode(){
    if(devMode) return;
    devMode = true;
    saveDevMode();
    showToast('Dev mode enabled');
  }
  function deactivateDevMode(){
    if(!devMode) return;
    devMode = false;
    devPanelOpen = false;
    saveDevMode();
    saveDevPanelOpen();
    showToast('Dev mode disabled');
  }
  /* ---- Date / format helpers (from js/utils.js) ---- */
  const today = window.TP.today;
  const daysBetween = window.TP.daysBetween;
  const addDays = window.TP.addDays;
  const nextDueDate = window.TP.nextDueDate;
  const relativeDueLabel = window.TP.relativeDueLabel;
  const urgencyClass = window.TP.urgencyClass;
  const fmt = window.TP.fmt;
  const unitLabel = window.TP.unitLabel;
  const capUnit = window.TP.capUnit;

  /* ---- Item helpers ---- */
    function isLocked(it){
    return window.TPItemLogic.isLocked(items, it);
  }
  // An item whose prerequisite was JUST completed today shouldn't immediately
  // join Today's Targets (required or optional) - that would make it look
  // like there's still more to do the same day you already made progress on
  // that chain. It surfaces normally starting tomorrow.
  function unlockedToday(it){
    return window.TPItemLogic.unlockedToday(items, it, today);
  }

  // Reorders items by dragging: src/target are indices into the `items` array.
  // Renumbers `order` only for the currently visible+sorted set (`currentList`)
  // so items hidden by filters keep their existing relative order untouched.
  function reorderByDrag(srcIdx, targetIdx, currentList){
    const positions = currentList.map(x=>x.i);
    const from = positions.indexOf(srcIdx);
    const to = positions.indexOf(targetIdx);
    if(from<0 || to<0 || from===to) return;
    positions.splice(to, 0, positions.splice(from,1)[0]);
    positions.forEach((itemIdx, order)=>{ items[itemIdx].order = order; });
    save();
  }

  /* ---- Streaks & archive ---- */
  function currentStreak(){
    const daySet = new Set(dayCompleteLog);
    let streak = 0;
    let d = today();
    if (!daySet.has(d)) {
      d = addDays(d, -1);
    }
    while (daySet.has(d)) {
      streak++;
      d = addDays(d, -1);
    }
    return streak;
  }

  function autoArchive(){
    let changed=false;
    items.forEach(it=>{
      if(it.completed && it.completedAt && !it.archived && daysBetween(it.completedAt, today())>=ARCHIVE_AFTER_DAYS){
        it.archived = true; changed=true;
      }
    });
    if(changed) localStorage.setItem(KEY, JSON.stringify(items));
  }
  autoArchive();

  function ensureOrder(){
    let changed=false;
    items.forEach((it,idx)=>{
      if(it.order===undefined){ it.order = idx; changed=true; }
    });
    if(changed) localStorage.setItem(KEY, JSON.stringify(items));
  }
  ensureOrder();

  /* ---- Notifications ---- */
  function checkAndNotify(){
    window.TPNotify.checkAndNotify({
      items,
      isLocked,
      today,
      addDays,
      notifyDigest,
      remoteDigestDate: window.tpSync && window.tpSync.getLastDigestDate ? window.tpSync.getLastDigestDate() : null,
      onNotified: function(dateStr){
        if(window.tpSync && window.tpSync.markDigestSentToday) window.tpSync.markDigestSentToday(dateStr);
      }
    });
  }
  // Change the server digest hour. Writes straight to Firestore (no
  // debounce, no batching with other prefs) — see saveNotifyHour's
  // comment in firebase-sync.js for why that matters here specifically.
  async function setNotifyHour(hour){
    const h = Number(hour);
    if(!Number.isInteger(h) || h < 0 || h > 23) return;
    notifyHour = h;
    savePrefs();
    render();
    if(window.tpSync && window.tpSync.saveNotifyHour){
      const res = await window.tpSync.saveNotifyHour(h);
      if(res.ok) showToast('Digest time updated');
      else if(res.reason !== 'signed-out') showToast('Could not update digest time — try again');
    }
  }
  // Another device may have set the hour more recently than this one's
  // local cache; reconcile to Firestore's value on sign-in rather than
  // trusting whatever this device happened to save last.
  document.addEventListener('tp-notify-hour-remote', function(e){
    const h = e.detail && e.detail.notifyHour;
    if(Number.isInteger(h) && h !== notifyHour){
      notifyHour = h;
      savePrefs();
      render();
    }
  });
  document.addEventListener('tp-sync-merged', function(e){
    const s = (e.detail && e.detail.stats) || {};
    const parts = [];
    if(s.remoteWins) parts.push(s.remoteWins + ' updated from another device');
    if(s.addedFromRemote) parts.push(s.addedFromRemote + ' new from another device');
    if(s.addedFromLocal) parts.push(s.addedFromLocal + ' kept local-only');
    if(parts.length) showToast('Synced: ' + parts.join(' · '));
  });
  // Don't run the very first check synchronously at page load: at that
  // instant window.tpSync's remoteDigestDate is always still null — not
  // just because Firebase auth and the fcm doc's onSnapshot listener are
  // async, but because firebase-sync.js is loaded as a `type="module"`
  // script (see index.html), which always defers until after the document
  // has been parsed, while this file is a plain synchronous script that
  // runs immediately as the parser reaches it. So window.tpSync doesn't
  // even exist yet at this point, let alone have a real answer for
  // getLastDigestDate(). Calling checkAndNotify() here regardless meant
  // this device's local "due today/tomorrow" notification would fire even
  // on a day the FCM digest had already been sent (e.g. while the app was
  // closed), because there was no way yet to tell "nothing sent today"
  // apart from "don't know yet". Waiting for tp-fcm-ready (dispatched by
  // firebase-sync.js once that first answer — signed-out, or the fcm
  // doc's initial snapshot — is in) closes that race so only one of the
  // two notifications ever fires for a given day. The timeout is a
  // fallback in case firebase-sync.js fails to load at all, so
  // notifications still work eventually, just without the cross-check.
  let didInitialNotifyCheck = false;
  function runInitialNotifyCheck(){
    if(didInitialNotifyCheck) return;
    didInitialNotifyCheck = true;
    checkAndNotify();
  }
  document.addEventListener('tp-fcm-ready', runInitialNotifyCheck, { once: true });
  setTimeout(runInitialNotifyCheck, 5000);
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState==='visible') checkAndNotify();
  });

  /* ---- Mutations (CRUD, toast, import/export) ---- */
  function makeRecurringClone(it){
    const maxOrder = items.reduce((m,x)=> Math.max(m, x.order ?? -1), -1);
    return {
      id: newItemId(),
      title: it.title, course: it.course, due: nextDueDate(it.due, it.recurring),
      total: it.total, unit: it.unit, notes: it.notes, done: 0, today: 0, completed: false,
      dependsOn: '', recurring: it.recurring,
      subtasks: (it.subtasks||[]).map(s=>({text:s.text, done:false})),
      completedAt: null, createdAt: today(), archived: false, order: maxOrder+1,
      updatedAt: Date.now()
    };
  }


  function deleteItemAt(idx){
    let finished = false;
    const finish = ()=>{
      if(finished) return; // guards against the animationend listener AND the timeout fallback below both firing
      finished = true;
      const removed = items[idx];
      items.splice(idx,1);
      tombstoneItem(removed.id);
      saveDeletedLog();
      save();
      showToast(`Deleted "${removed.title}"`, ()=>{
        untombstoneItem(removed.id);
        removed.updatedAt = Date.now(); // undo counts as a fresh edit, beats the tombstone on other devices
        items.splice(idx,0,removed);
        saveDeletedLog();
        save();
      });
    };
    const el = document.getElementById('tp-card-'+idx);
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(el && !reduced){
      el.classList.add('tp-removing');
      el.addEventListener('animationend', finish, {once:true});
      // Safety net: if the animation never fires animationend (a CSS/class
      // mismatch, an interrupted animation, etc.) the delete must not hang
      // forever with no feedback - which is exactly what happened when
      // css/components.css was removed without updating this function.
      setTimeout(finish, 400);
    } else {
      finish();
    }
  }

  function clearCompleted(){
    const idxs = items.map((it,idx)=> it.completed ? idx : -1).filter(idx=>idx>=0);
    if(idxs.length===0) return;
    const removed = idxs.map(i=>({item:items[i], index:i}));
    [...idxs].reverse().forEach(i=> items.splice(i,1));
    removed.forEach(r=> tombstoneItem(r.item.id));
    saveDeletedLog();
    save();
    showToast(`Deleted ${removed.length} completed assignment${removed.length>1?'s':''}`, ()=>{
      removed.forEach(r=>{
        untombstoneItem(r.item.id);
        r.item.updatedAt = Date.now();
        items.splice(r.index,0,r.item);
      });
      saveDeletedLog();
      save();
    });
  }

  function exportData(){
    window.TPIo.exportData(items);
  }
  function exportIcs(){
    window.TPIo.exportIcs(items);
  }
  function importData(file){
    window.TPIo.importData(file, (data)=>{ items = data; save(); });
  }

  // Computes which items are "required today" (multi-part items that still need
  // progress logged today to stay on pace, plus singles due today/overdue), plus
  // the optional/credit-eligible buckets and whether today counts as fully done.
  // Pulled out of render() so click handlers can call it too, to check whether
  // an action just completed the whole day (-> big confetti) rather than just
  // one item (-> small confetti).
  /* ---- Today's targets (js/today-logic.js) ---- */
  function todayLogicCtx(){
    return {
      items, storageKey: KEY, isLocked, unlockedToday, today, daysBetween
    };
  }
  function computeTodayPanel(){
    return window.TPTodayLogic.computeTodayPanel(todayLogicCtx());
  }
  function hasTodayWorkRemaining(){
    return window.TPTodayLogic.hasTodayWorkRemaining(todayLogicCtx());
  }

  function allGroups(){
    return window.TPAllLogic.buildGroups({
      items, query: searchTerm, sortMode: allSortMode, filterCourse: allFilterCourse,
      isLocked, today, daysBetween,
    });
  }

  /* ---- Render ---- */
  function render(){
    const V = window.TPViews;
    const escapeHtml = window.TPHtml.escapeHtml;
    const itemIndexMap = new Map(items.map((it,idx)=>[it, idx]));
    // Check for day-completion BEFORE computing the streak below, so
    // finishing your last task shows the updated streak on this same paint.
    const panel = computeTodayPanel();
    if(panel.allDoneToday) logDayComplete();
    const streak = currentStreak();

    let screenHtml = '';
    if(tab==='today'){
      const screen = window.TPTodayLogic.computeTodayScreen(panel);
      const totalLoggedToday = items.reduce((s,it)=> s + (it.today||0), 0);
      const d = window.TP.asDate(today());
      screenHtml = V.todayScreenHtml({
        streak, totalLoggedToday, screen, escapeHtml, itemIndexMap,
        dateLabel: d.toLocaleDateString(undefined,{month:'long',day:'numeric'}),
        weekdayLabel: d.toLocaleDateString(undefined,{weekday:'long'}),
        courseColorFor, relativeDueLabel, unitLabel, capUnit,
        TPTodayLogic: window.TPTodayLogic,
      });
    } else if(tab==='all'){
      screenHtml = V.allScreenHtml(allCtx());
    } else if(tab==='week'){
      const weekCtx = { items, today, daysBetween };
      const days = window.TPWeekLogic.computePacedLoad(weekCtx);
      const dayLabels = days.map((_,i)=> window.TP.asDate(addDays(today(),i)).toLocaleDateString(undefined,{weekday:'long'}));
      const stats = window.TPWeekLogic.statTiles(weekCtx);
      const heaviestLabel = window.TPWeekLogic.heaviestDayLabel(days, dayLabels);
      const courseStats = window.TPWeekLogic.byCourseBreakdown(items, courseColorFor);
      const overdueCount = items.filter(it=>!it.completed && !it.archived && !isLocked(it) && daysBetween(today(), it.due)<0).length;
      const advice = overdueCount>0
        ? `${overdueCount} item${overdueCount===1?'':'s'} overdue — clear those first, they're weighing every day's pace down.`
        : (heaviestLabel==='none' ? 'Nothing paced this week yet. Add a due date to see the load.' : `${heaviestLabel} carries the most load this week — consider pulling some of it forward.`);
      screenHtml = V.weekScreenHtml({
        escapeHtml, days, dayLabels, selDay: weekSelDay, stats, heaviestLabel,
        courseColorFor, courseStats, advice, relativeDueLabel,
        items, today, daysBetween, TPWeekLogic: window.TPWeekLogic,
      });
    } else if(tab==='settings'){
      screenHtml = V.settingsScreenHtml({
        theme, notifyHour, notifyDigest, courses, escapeHtml,
        completedCount: items.filter(i=>i.completed).length,
        syncLabel: window.tpSyncLabel || 'Sign in to sync',
      }) + V.devToolbarHtml({ devMode, devPanelOpen });
    } else if(tab==='courses'){
      screenHtml = V.coursesScreenHtml({
        escapeHtml, courses, openCountFor: (name)=> window.TPCourses.openCountForCourse(items, name),
        draftName: newCourseName, draftColor: newCourseColor,
      });
    }

    let html = V.tabBarHtml({ tab }) + screenHtml;

    if(addOpen && draft){
      html += V.addSheetHtml({ draft, courses, items, pickerOpen, moreOpen, prereqOpen, escapeHtml, today, daysBetween, isEdit: editIndex!==null, sheetJustOpened });
    }
    if(menuFor!=null && items[menuFor]){
      const it = items[menuFor];
      html += V.quickMenuHtml({ it, i: menuFor, escapeHtml, relativeDueLabel, unit: it.unit || 'units', menuJustOpened });
    }

    const prevFills = {};
    root.querySelectorAll('[data-fill-key]').forEach(el=>{ prevFills[el.dataset.fillKey] = el.style.width; });

    root.innerHTML = html;

    if(celebrationPending){
      const c = celebrationPending;
      celebrationPending = null;
      requestAnimationFrame(()=> burstConfetti(c.x, c.y, {big: c.big}));
    }

    root.querySelectorAll('[data-fill-key]').forEach(el=>{
      const key = el.dataset.fillKey;
      const newWidth = el.style.width;
      if(prevFills[key] !== undefined && prevFills[key] !== newWidth){
        el.style.width = prevFills[key];
        void el.offsetWidth;
        requestAnimationFrame(()=>{ el.style.width = newWidth; });
      }
    });

    window.TPBind.bindEvents(root, buildApi());
  }

  // Context handed to js/views/all-html.js, factored out so both a full
  // render() and a search-only patch() can build the exact same shape.
  function allCtx(){
    return {
      escapeHtml: window.TPHtml.escapeHtml, searchTerm, sortMode: allSortMode, filterCourse: allFilterCourse,
      courses, groups: allGroups(), itemsLength: items.filter(i=>!i.archived).length,
      isLocked, daysBetween, today, urgencyClass, relativeDueLabel, fmt, unitLabel, capUnit,
      courseColorFor, contrastTextColor,
    };
  }

  // Replaces one container's contents and re-binds, without touching the
  // rest of the DOM - so a focused input is never destroyed mid-typing.
  // Re-binding globally is fine (attaching handlers is cheap); the
  // expensive, bug-producing part is rebuilding the element tree, and
  // that's what this avoids.
  function patch(id, html){
    const el = document.getElementById(id);
    if(!el) return;
    el.innerHTML = html;
    window.TPBind.bindEvents(document.getElementById('tp-app'), buildApi());
  }

  function buildApi(){
    return {
      items, allList: allGroups().flatMap(g=>g.rows), render, patch, allCtx, save, savePrefs, exportData, exportIcs, importData,
      clearCompleted, deleteItemAt, reorderByDrag, makeRecurringClone, triggerCelebration, today, addDays, daysBetween,
      hasTodayWorkRemaining, logDayComplete, checkAndNotify, applyTheme,
      isDevModeTrigger, activateDevMode, deactivateDevMode, saveDevPanelOpen, showToast,
      saveCourses, openAddSheet, closeAddSheet, setNotifyHour,
      DAY_OFFSET_KEY,
      // Every screen switch should land at the top, not wherever the
      // previous (possibly taller) screen happened to be scrolled to.
      get tab(){ return tab; }, set tab(v){ tab = v; if(typeof window.scrollTo === 'function') window.scrollTo(0, 0); },
      get editIndex(){ return editIndex; }, set editIndex(v){ editIndex = v; },
      get draft(){ return draft; },
      get pickerOpen(){ return pickerOpen; }, set pickerOpen(v){ pickerOpen = v; },
      get moreOpen(){ return moreOpen; }, set moreOpen(v){ moreOpen = v; },
      get prereqOpen(){ return prereqOpen; }, set prereqOpen(v){ prereqOpen = v; },
      get menuFor(){ return menuFor; }, set menuFor(v){ menuFor = v; menuJustOpened = (v !== null); },
      get sheetJustOpened(){ return sheetJustOpened; }, set sheetJustOpened(v){ sheetJustOpened = v; },
      get menuJustOpened(){ return menuJustOpened; }, set menuJustOpened(v){ menuJustOpened = v; },
      get searchTerm(){ return searchTerm; }, set searchTerm(v){ searchTerm = v; },
      get allSortMode(){ return allSortMode; }, set allSortMode(v){ allSortMode = v; },
      get allFilterCourse(){ return allFilterCourse; }, set allFilterCourse(v){ allFilterCourse = v; },
      get weekSelDay(){ return weekSelDay; }, set weekSelDay(v){ weekSelDay = v; },
      get pendingFocus(){ return pendingFocus; }, set pendingFocus(v){ pendingFocus = v; },
      get devMode(){ return devMode; }, set devMode(v){ devMode = v; },
      get devPanelOpen(){ return devPanelOpen; }, set devPanelOpen(v){ devPanelOpen = v; },
      get notifyHour(){ return notifyHour; },
      get notifyDigest(){ return notifyDigest; }, set notifyDigest(v){ notifyDigest = v; },
      get theme(){ return theme; }, set theme(v){ theme = v; },
      get courses(){ return courses; },
      get newCourseName(){ return newCourseName; }, set newCourseName(v){ newCourseName = v; },
      get newCourseColor(){ return newCourseColor; }, set newCourseColor(v){ newCourseColor = v; },
      get lastAddedCourseId(){ return lastAddedCourseId; }, set lastAddedCourseId(v){ lastAddedCourseId = v; },
      touchItem, newItemId,
    };
  }
  render();
})();
