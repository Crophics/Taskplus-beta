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
      items: items.filter(it=>!window.TPMoodle.isImported(it)),
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
  // Imported (Moodle) items are stored apart from manual ones so they never
  // reach the shared Firestore doc that firebase-sync.js merges - Moodle is
  // their source of truth and each device syncs from it directly.
  const MOODLE_ITEMS_KEY='tp-moodle-items';
  const MOODLE_STATE_KEY='tp-moodle';
  const MOODLE_EVENTS_KEY='tp-moodle-events';
  const MOODLE_SITE_KEY='tp-moodle-last-site';
  // Grades: what Moodle reported (replaced each sync) and what the user owns
  // (weights, targets, credits). Device-local, like imported items.
  const LLM_KEY='tp-llm-on';
  const LLM_FILES_KEY='tp-llm-files';
  const GRADES_KEY='tp-moodle-grades';
  const GRADE_SETTINGS_KEY='tp-grade-settings';
  const DEV_MODE_KEY='tp-dev-mode';
  const DEV_PANEL_KEY='tp-dev-panel-open';
  const DAY_OFFSET_KEY='tp-day-offset';
  const ARCHIVE_AFTER_DAYS=14;

  /* ---- State ---- */
  function readJsonArray(key){
    try{ const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; }catch(e){ return []; }
  }
  function loadItems(){ return readJsonArray(KEY).concat(readJsonArray(MOODLE_ITEMS_KEY)); }
  function persistItems(){
    const isImp = window.TPMoodle.isImported;
    localStorage.setItem(KEY, JSON.stringify(items.filter(it=>!isImp(it))));
    localStorage.setItem(MOODLE_ITEMS_KEY, JSON.stringify(items.filter(isImp)));
  }
  let items = loadItems();
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
  if(idsMigrated) persistItems();

  // Day rollover: the `today` pacing counter (js/today-logic.js) only means
  // anything for the calendar day it was logged on, so reset it the first
  // time the app runs on a new day.
  {
    const storedActiveDate = localStorage.getItem(LAST_ACTIVE_DATE_KEY);
    const nowDate = window.TP.today();
    if(window.TPTodayLogic.resetTodayCounters(items, storedActiveDate, nowDate)){
      persistItems();
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
    items = loadItems();
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
  const TABS = ['today','all','week','settings','courses','course','manage','item'];
  let tab = TABS.includes(prefs.tab) && prefs.tab !== 'course' && prefs.tab !== 'item' ? prefs.tab : 'today';
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
  // Same one-shot pattern for the screen-switch transition: render() is
  // called on almost every mutation (logging, completing, saving...), not
  // just on a tab change, so this can't just be "screen changes -> fade" -
  // that would replay on every single tap while sitting on one tab. Only
  // the `tab` setter below flips this true; js/bind-events.js clears it
  // after every render pass, same as sheetJustOpened/menuJustOpened.
  let screenJustSwitched = false;
  // The week chart's bar-grow-in should only ever play once per page load -
  // not every time the Week tab is rendered (switching days, adding an
  // assignment, anything). Starts true, flips false the first time the
  // Week screen actually renders, and then never flips back for the rest
  // of this session (a real page reload is the only way to see it again).
  let weekChartFirstRender = true;
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
    localStorage.setItem(PREFS_KEY, JSON.stringify({searchTerm,theme,notifyHour,notifyDigest,tab: tab==='course' ? 'courses' : tab==='item' ? itemDetailFrom : tab,allSortMode}));
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
      if(connectOpen && !connectBusy){ closeConnectSheet(); render(); return; }
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
        minutes: it.estimate && it.estimate.basis === 'user' ? it.estimate.minutes : '',
        imported: window.TPMoodle.isImported(it), // imported work edits its estimate on its own detail screen
      };
    } else {
      editIndex = null;
      const preselected = lastAddedCourseId && window.TPCourses.byId(courses, lastAddedCourseId) ? lastAddedCourseId : null;
      draft = { title: '', courseId: preselected, due: '', amount: 1, unit: '', notes: '', subtasksText: '', recurring: '', dependsOn: '', minutes: '', imported: false };
    }
    pickerOpen = false;
    moreOpen = false;
    prereqOpen = false;
    addOpen = true;
    sheetJustOpened = true;
  }
  function closeAddSheet(){
    // Blur whatever's focused before the caller's next render() call
    // rebuilds #tp-app's innerHTML out from under it, rather than letting
    // the DOM removal trigger the blur as a side effect a moment later.
    if(document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
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
    persistItems();
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
    if(changed) persistItems();
  }
  autoArchive();

  function ensureOrder(){
    let changed=false;
    items.forEach((it,idx)=>{
      if(it.order===undefined){ it.order = idx; changed=true; }
    });
    if(changed) persistItems();
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
      items, storageKey: KEY, persist: persistItems, isLocked, unlockedToday, today, daysBetween
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

  /* ---- Grades (js/grades-logic.js, js/views/grades-html.js) ---- */
  function readJsonObject(key, fallback){
    try{ const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback; }catch(e){ return fallback; }
  }
  let gradesStore = readJsonObject(GRADES_KEY, { syncedAt: null, courses: {} });
  let gradeSettings = readJsonObject(GRADE_SETTINGS_KEY, window.TPGrades.emptySettings());
  if(!gradeSettings.weights) gradeSettings.weights = {};
  if(!gradeSettings.courses) gradeSettings.courses = {};
  let courseDetailName = null;
  function saveGradeSettings(){ localStorage.setItem(GRADE_SETTINGS_KEY, JSON.stringify(gradeSettings)); }
  function saveGradesStore(){ localStorage.setItem(GRADES_KEY, JSON.stringify(gradesStore)); }

  function courseDetailCtx(name){
    const G = window.TPGrades;
    const gc = gradesStore.courses[name] || null;
    const entries = G.buildEntries(name, items, gc);
    const cs = G.courseSettings(gradeSettings, name);
    const calc = G.computeCourse(entries.graded.concat(entries.coming), gradeSettings.weights, {
      target: cs.target, moodleTotal: gc && gc.total !== undefined ? gc.total : null,
    });
    return {
      escapeHtml: window.TPHtml.escapeHtml, name, color: courseColorFor(name), relativeDueLabel,
      settingsForCourse: cs, entries, weights: gradeSettings.weights, calc, target: cs.target,
      letter: G.letterFor(calc.currentPct, cs.scale), summary: '',
    };
  }
  function gradeSummaryHtml(){
    return courseDetailName ? window.TPViews.gradeSummaryHtml(courseDetailCtx(courseDetailName)) : '';
  }
  function openCourse(name){
    courseDetailName = name;
    if(tab !== 'course') screenJustSwitched = true;
    tab = 'course';
    if(typeof window.scrollTo === 'function') window.scrollTo(0, 0);
    savePrefs();
    render();
  }
  // Weight typing is model-only: the caller patches #tp-g-summary, nothing re-renders.
  function setWeight(id, value){
    gradeSettings = window.TPGrades.setWeight(gradeSettings, id, value);
    saveGradeSettings();
  }
  function stepCourseSetting(name, which, dir){
    const cs = window.TPGrades.courseSettings(gradeSettings, name);
    const patch = which === 'target' ? { target: cs.target + dir } : { credits: cs.credits + dir * 0.5 };
    gradeSettings = window.TPGrades.setCourseSetting(gradeSettings, name, patch);
    saveGradeSettings();
    render();
  }
  function useSuggestedWeights(name){
    const e = window.TPGrades.buildEntries(name, items, gradesStore.courses[name] || null);
    let n = 0;
    e.coming.concat(e.graded).forEach(x=>{
      if(x.weightSuggested && !(gradeSettings.weights[x.id] > 0)){ gradeSettings = window.TPGrades.setWeight(gradeSettings, x.id, x.weightSuggested); n++; }
    });
    saveGradeSettings();
    showToast(n ? `Filled ${n} weight${n===1?'':'s'} from Moodle` : 'No weights to fill in');
    render();
  }
  function importGradeSettings(file){
    const reader = new FileReader();
    reader.onload = ()=>{
      try{
        const out = window.TPGrades.importSettings(gradeSettings, JSON.parse(reader.result));
        if(!out.stats.weights && !out.stats.courses){ showToast('Nothing to import in that file'); return; }
        gradeSettings = out.settings;
        saveGradeSettings();
        showToast(`Imported ${out.stats.weights} weight${out.stats.weights===1?'':'s'} and settings for ${out.stats.courses} course${out.stats.courses===1?'':'s'}`);
        render();
      }catch(e){
        showToast('That is not a grade settings file');
      }
    };
    reader.readAsText(file);
  }

  /* ---- Claude estimates (src/estimate.mjs via /api/estimate) ---- */
  // Opt-out switch in Settings. On by default: the assignment's title, points and description go to
  // Anthropic so Claude can estimate it and name the steps. Device-local.
  let llmOn = localStorage.getItem(LLM_KEY) !== '0';
  // Separate switch for sending the assignment's attached PDFs (the handout), on by default.
  let filesOn = localStorage.getItem(LLM_FILES_KEY) !== '0';
  let modelBusy = false;
  let llmUnavailable = false; // the server said it is not set up / not allowed: stop asking this session
  function setLlmOn(on){
    llmOn = !!on;
    localStorage.setItem(LLM_KEY, llmOn ? '1' : '0');
    if(llmOn) llmUnavailable = false;
    render();
    if(llmOn) requestModelEstimates().catch(()=>{});
  }
  function setFilesOn(on){
    filesOn = !!on;
    localStorage.setItem(LLM_FILES_KEY, filesOn ? '1' : '0');
    render();
    if(filesOn && llmOn) requestModelEstimates().catch(()=>{});
  }
  // Asks Claude about items that still have the rule-of-thumb estimate (a few at a time), or, with
  // `force`, about the given items regardless. Quiet by default: a failure leaves the rule-of-thumb
  // estimate in place and nothing else changes.
  async function requestModelEstimates(opts){
    const force = !!(opts && opts.force);
    const only = opts && opts.ids;
    if(!llmOn || !moodleSignedIn() || modelBusy || (llmUnavailable && !force)) return;
    const t = today();
    const cand = items.filter(it=> (!only || only.includes(it.id)) && window.TPMoodle.needsModel(it, t, force, filesOn)).slice(0, 15);
    if(!cand.length){ if(force) showToast('Nothing to estimate'); return; }
    modelBusy = true;
    if(force) render();
    let applied = 0, limited = false, errorMessage = '';
    try{
      for(let i = 0; i < cand.length; i += 5){
        const chunk = cand.slice(i, i + 5);
        const keys = {};
        chunk.forEach(it=>{ keys[it.id] = window.TPEstimate.inputsKey(it); });
        let res;
        try{
          res = await window.TPMoodle.api.estimate(chunk.map(it=> window.TPMoodle.modelInput(it, daysBetween(t, it.due), filesOn)), force, filesOn);
        }catch(e){
          if(e && (e.code === 'not_configured' || e.code === 'not_allowed')) llmUnavailable = true;
          errorMessage = (e && e.message) || '';
          break;
        }
        const out = window.TPMoodle.applyModelResults(items, res.results, { today: t, keys, force, readFiles: filesOn });
        items = out.items;
        applied += out.stats.applied;
        if(out.stats.limited) limited = true;
        if(out.stats.unavailable) llmUnavailable = true;
        persistItems();
        if(out.stats.limited || out.stats.unavailable) break;
      }
    } finally {
      modelBusy = false;
    }
    if(force){
      showToast(applied ? 'Updated with Claude\'s estimate'
        : limited ? 'Today\'s limit for Claude estimates is used up'
        : (errorMessage || 'Claude could not estimate that. Keeping the current estimate.'));
    } else if(applied){
      showToast(`Claude improved ${applied} estimate${applied === 1 ? '' : 's'}`);
    }
    if(!userIsTyping()) render();
  }
  function askClaude(id){ return requestModelEstimates({ force: true, ids: [id] }); }

  /* ---- Assignment detail (js/views/item-detail-html.js) ---- */
  let itemDetailId = null;
  let itemDetailFrom = 'today';
  let itemDescOpen = false;
  function itemIndexById(id){ return items.findIndex(x=>x && x.id === id); }
  function openItem(id){
    if(itemIndexById(id) < 0) return;
    itemDetailId = id;
    itemDescOpen = false;
    if(tab !== 'item') itemDetailFrom = tab;
    screenJustSwitched = true;
    tab = 'item';
    if(typeof window.scrollTo === 'function') window.scrollTo(0, 0);
    savePrefs();
    render();
  }
  function closeItem(){
    tab = itemDetailFrom || 'today';
    savePrefs();
    render();
  }
  // Notes are model-only: typing never re-renders (render-loop rule in AGENTS.md).
  function setItemNotes(id, value){
    const i = itemIndexById(id);
    if(i < 0) return;
    items[i].notes = value;
    touchItem(items[i]);
    persistItems();
  }
  function replaceItem(i, next){
    items[i] = touchItem(next);
    persistItems();
    syncPush();
    render();
  }
  function adjustEstimate(id, delta){
    const i = itemIndexById(id);
    if(i < 0 || !items[i].estimate) return;
    const minutes = items[i].estimate.minutes + delta;
    replaceItem(i, window.TPEstimate.withEstimate(items[i], window.TPEstimate.userEstimate(minutes, items[i].estimate.steps)));
  }
  function resetEstimate(id){
    const i = itemIndexById(id);
    if(i < 0) return;
    replaceItem(i, window.TPEstimate.withEstimate(items[i], window.TPEstimate.estimateForItem(items[i])));
  }
  function itemDetailCtx(){
    const i = itemIndexById(itemDetailId);
    const item = items[i];
    return {
      item, idx: i, escapeHtml: window.TPHtml.escapeHtml, color: item.course ? courseColorFor(item.course) : 'var(--text-faint)',
      relativeDueLabel, daysToDue: daysBetween(today(), item.due), descOpen: itemDescOpen,
      weightPct: gradeSettings.weights[item.id] > 0 ? gradeSettings.weights[item.id] : null,
      fromLabel: ({ today:'Today', week:'Week', all:'All', courses:'Courses' })[itemDetailFrom] || 'Back',
      llm: { available: llmOn && moodleSignedIn() && !llmUnavailable, busy: modelBusy },
    };
  }

  /* ---- Moodle import (js/moodle-client.js, src/worker.mjs) ---- */
  // Cached copy of the server's connection status, so Settings can render
  // instantly and offline. The server is the source of truth.
  function readMoodleState(){
    try{ const v = JSON.parse(localStorage.getItem(MOODLE_STATE_KEY)); return v && typeof v === 'object' ? v : {connected:false}; }catch(e){ return {connected:false}; }
  }
  let moodleState = readMoodleState();
  function saveMoodleState(){ localStorage.setItem(MOODLE_STATE_KEY, JSON.stringify(moodleState)); }
  let moodleBusy = false;
  let connectOpen = false;
  let connectBusy = false;
  let connectError = '';
  let connectJustOpened = false;
  // The draft lives in memory only. The password is never written to storage
  // and is cleared as soon as the attempt finishes, successful or not.
  let connectDraft = { site: '', username: '', password: '' };

  function moodleSignedIn(){ return !!(window.tpSync && window.tpSync.getUser && window.tpSync.getUser()); }
  function appendMoodleEvents(events){
    if(!events || !events.length) return;
    let log = readJsonArray(MOODLE_EVENTS_KEY);
    const ts = Date.now();
    log = log.concat(events.map(e=>({ts, ...e}))).slice(-100);
    localStorage.setItem(MOODLE_EVENTS_KEY, JSON.stringify(log));
  }
  // A background sync must never rebuild the DOM under someone who is typing.
  function userIsTyping(){
    const a = document.activeElement;
    return addOpen || connectOpen || !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  }
  function openConnectSheet(){
    connectDraft = { site: localStorage.getItem(MOODLE_SITE_KEY) || '', username: '', password: '' };
    connectError = '';
    connectBusy = false;
    connectOpen = true;
    connectJustOpened = true;
  }
  function closeConnectSheet(){
    if(document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
    connectOpen = false;
    connectBusy = false;
    connectError = '';
    connectJustOpened = false;
    connectDraft = { site: '', username: '', password: '' };
  }
  async function moodleConnect(){
    if(connectBusy) return;
    const d = connectDraft;
    if(!d.site.trim() || !d.username.trim() || !d.password){
      connectError = 'Fill in the address, username and password.';
      render();
      return;
    }
    connectBusy = true;
    connectError = '';
    render();
    try{
      const status = await window.TPMoodle.api.connect(d.site, d.username.trim(), d.password);
      localStorage.setItem(MOODLE_SITE_KEY, d.site.trim());
      moodleState = status;
      saveMoodleState();
      closeConnectSheet();
      render();
      moodleSync({silent:false});
    }catch(e){
      connectBusy = false;
      connectError = (e && e.message) || 'Could not connect. Try again.';
      d.password = '';
      pendingFocus = {id:'tp-connect-pass'};
      render();
    }
  }
  // Pulls the latest assignments/quizzes through the Worker and merges them in.
  async function moodleSync(opts){
    const silent = !!(opts && opts.silent);
    if(moodleBusy) return;
    moodleBusy = true;
    if(!silent && tab === 'settings' && !userIsTyping()) render();
    try{
      const res = await window.TPMoodle.api.sync();
      const merged = window.TPMoodle.mergeImported(items, res.records, { today: today(), deletedLog, now: Date.now() });
      items = merged.items;
      if(window.TPMoodle.ensureCourses(courses, res.records)) saveCourses();
      appendMoodleEvents(merged.events);
      moodleState = { ...moodleState, connected: true, courses: res.courses, lastSyncAt: res.syncedAt };
      saveMoodleState();
      if(Array.isArray(res.grades)){
        gradesStore = window.TPGrades.mergeGrades(gradesStore, res.grades, res.syncedAt);
        saveGradesStore();
      }
      persistItems();
      if(!silent || merged.stats.added || merged.stats.moved) showToast(window.TPMoodle.summarize(merged.stats));
      requestModelEstimates().catch(()=>{});
    }catch(e){
      const code = e && e.code;
      if(code === 'moodle_auth'){
        moodleState = { connected: false };
        saveMoodleState();
        showToast('Moodle sign-in expired. Connect again in Settings.');
      } else if(!silent && code !== 'too_soon'){
        showToast((e && e.message) || 'Could not sync Moodle');
      }
    } finally {
      moodleBusy = false;
      if(!userIsTyping()) render();
    }
  }
  async function moodleDisconnect(){
    if(!window.confirm('Disconnect Moodle? Assignments already imported stay, but stop updating.')) return;
    try{
      await window.TPMoodle.api.disconnect();
      moodleState = { connected: false };
      saveMoodleState();
      showToast('Moodle disconnected');
    }catch(e){
      showToast((e && e.message) || 'Could not disconnect. Try again.');
    }
    render();
  }
  async function moodleSetCourse(id, on){
    const prev = moodleState.courses || [];
    moodleState = { ...moodleState, courses: prev.map(c=> c.id === id ? { ...c, selected: on } : c) };
    saveMoodleState();
    render();
    try{
      const status = await window.TPMoodle.api.saveCourses(moodleState.courses.filter(c=>c.selected).map(c=>c.id));
      moodleState = status;
      saveMoodleState();
    }catch(e){
      moodleState = { ...moodleState, courses: prev };
      saveMoodleState();
      showToast('Could not save that change');
    }
    render();
  }
  function moodleMaybeAutoSync(){
    if(!moodleSignedIn()) return;
    if(window.TPMoodle.shouldAutoSync(moodleState, Date.now())) moodleSync({silent:true});
    else requestModelEstimates().catch(()=>{}); // nothing to sync yet, but older items may still need Claude's estimate
  }
  async function moodleBoot(){
    try{
      const status = await window.TPMoodle.api.status();
      moodleState = status.connected ? status : { connected: false };
      saveMoodleState();
    }catch(e){
      return; // not configured, offline, or signed out: keep the cached state
    }
    if(tab === 'settings' && !userIsTyping()) render();
    moodleMaybeAutoSync();
  }
  document.addEventListener('tp-auth-changed', function(e){
    if(e.detail && e.detail.user) moodleBoot();
    else if(tab === 'settings' && !userIsTyping()) render();
  });
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState === 'visible') moodleMaybeAutoSync();
  });

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

    if(tab==='item' && itemIndexById(itemDetailId) < 0) tab = itemDetailFrom || 'today';
    let screenHtml = '';
    if(tab==='today'){
      const screen = window.TPTodayLogic.computeTodayScreen(panel);
      const totalLoggedToday = items.reduce((s,it)=> s + (it.today||0), 0);
      const d = window.TP.asDate(today());
      // Minutes view (js/plan-logic.js): what is left today, and whether a later day stands out as heavy.
      const todayPlan = window.TPPlan.computeDays({ items, today: today(), daysBetween, isLocked });
      const heavy = window.TPPlan.heavyDay(todayPlan.days);
      const plan = {
        summary: window.TPPlan.todaySummary(screen.targets, items, screen.getAhead),
        heavy: heavy && heavy.dayIndex > 0
          ? { label: window.TP.asDate(addDays(today(), heavy.dayIndex)).toLocaleDateString(undefined,{weekday:'long'}), minutes: heavy.minutes }
          : null,
      };
      screenHtml = V.todayScreenHtml({
        streak, totalLoggedToday, screen, escapeHtml, itemIndexMap,
        dateLabel: d.toLocaleDateString(undefined,{month:'long',day:'numeric'}),
        weekdayLabel: d.toLocaleDateString(undefined,{weekday:'long'}),
        courseColorFor, relativeDueLabel, unitLabel, capUnit, plan,
        TPTodayLogic: window.TPTodayLogic,
      });
    } else if(tab==='all'){
      screenHtml = V.allScreenHtml(allCtx());
    } else if(tab==='week'){
      const weekCtx = { items, today, daysBetween };
      // Minutes view when any open item has a time estimate; otherwise the original unit view.
      const planDays = window.TPPlan.computeDays({ items, today: today(), daysBetween, isLocked });
      const hasEstimates = items.some(it=> !it.completed && !it.archived && window.TPPlan.minutesPerUnit(it) !== null);
      const days = hasEstimates
        ? planDays.days.map(d=>({ dayIndex: d.dayIndex, total: d.minutes, byCourse: d.byCourse }))
        : window.TPWeekLogic.computePacedLoad(weekCtx);
      const heavyWeek = hasEstimates ? window.TPPlan.heavyDay(planDays.days) : null;
      const minutesCtx = hasEstimates ? {
        on: true, entriesFor: (i)=> planDays.days[i].entries, heavyIndex: heavyWeek ? heavyWeek.dayIndex : -1, unestimated: planDays.unestimated,
        leftMin: items.reduce((s,it)=> (it.completed||it.archived) ? s : s + (window.TPPlan.leftMinutes(it) || 0), 0),
      } : { on: false };
      const dayLabels = days.map((_,i)=> window.TP.asDate(addDays(today(),i)).toLocaleDateString(undefined,{weekday:'long'}));
      const stats = window.TPWeekLogic.statTiles(weekCtx);
      const heaviestLabel = window.TPWeekLogic.heaviestDayLabel(days, dayLabels);
      const courseStats = window.TPWeekLogic.byCourseBreakdown(items, courseColorFor);
      const overdueCount = items.filter(it=>!it.completed && !it.archived && !isLocked(it) && daysBetween(today(), it.due)<0).length;
      const advice = overdueCount>0
        ? `${overdueCount} item${overdueCount===1?'':'s'} overdue — clear those first, they're weighing every day's pace down.`
        : (heaviestLabel==='none' ? 'Nothing paced this week yet. Add a due date to see the load.' : `${heaviestLabel} carries the most load this week — consider pulling some of it forward.`);
      const animateChart = weekChartFirstRender;
      weekChartFirstRender = false;
      screenHtml = V.weekScreenHtml({
        escapeHtml, days, dayLabels, selDay: weekSelDay, stats, heaviestLabel,
        courseColorFor, courseStats, advice, relativeDueLabel, animateChart,
        items, today, daysBetween, TPWeekLogic: window.TPWeekLogic, minutes: minutesCtx,
      });
    } else if(tab==='settings'){
      screenHtml = V.settingsScreenHtml({
        theme, notifyHour, notifyDigest, courses, escapeHtml,
        completedCount: items.filter(i=>i.completed).length,
        syncLabel: window.tpSyncLabel || 'Sign in to sync',
        moodle: { state: moodleState, busy: moodleBusy, signedIn: moodleSignedIn() }, llmOn, filesOn,
      }) + V.devToolbarHtml({ devMode, devPanelOpen });
    } else if(tab==='courses'){
      const ov = window.TPGrades.overview({ courses, items, store: gradesStore, settings: gradeSettings, colorFor: courseColorFor, today: today() });
      screenHtml = V.coursesOverviewHtml({ escapeHtml, rows: ov.rows, gpa: ov.gpa, connected: !!moodleState.connected, relativeDueLabel });
    } else if(tab==='course' && courseDetailName){
      const ctx = courseDetailCtx(courseDetailName);
      ctx.summary = V.gradeSummaryHtml(ctx);
      screenHtml = V.courseDetailHtml(ctx);
    } else if(tab==='item'){
      screenHtml = V.itemDetailHtml(itemDetailCtx());
    } else if(tab==='manage'){
      screenHtml = V.coursesScreenHtml({
        escapeHtml, courses, openCountFor: (name)=> window.TPCourses.openCountForCourse(items, name),
        draftName: newCourseName, draftColor: newCourseColor,
      });
    }

    if(screenJustSwitched) screenHtml = `<div class="tp-screen-enter">${screenHtml}</div>`;
    let html = V.tabBarHtml({ tab: tab==='item' ? itemDetailFrom : tab }) + screenHtml;

    if(addOpen && draft){
      html += V.addSheetHtml({ draft, courses, items, pickerOpen, moreOpen, prereqOpen, escapeHtml, today, daysBetween, isEdit: editIndex!==null, sheetJustOpened });
    }
    if(connectOpen){
      html += V.connectSheetHtml({ draft: connectDraft, error: connectError, busy: connectBusy, escapeHtml, sheetJustOpened: connectJustOpened });
      connectJustOpened = false;
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
      get tab(){ return tab; }, set tab(v){ if(v !== tab) screenJustSwitched = true; tab = v; if(typeof window.scrollTo === 'function') window.scrollTo(0, 0); },
      get screenJustSwitched(){ return screenJustSwitched; }, set screenJustSwitched(v){ screenJustSwitched = v; },
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
      openConnectSheet, closeConnectSheet, moodleConnect, moodleSync, moodleDisconnect, moodleSetCourse,
      get connectDraft(){ return connectDraft; },
      get connectBusy(){ return connectBusy; },
      openCourse, setWeight, stepCourseSetting, useSuggestedWeights, importGradeSettings, gradeSummaryHtml,
      openItem, closeItem, setItemNotes, adjustEstimate, resetEstimate, askClaude, setLlmOn, setFilesOn,
      get llmOn(){ return llmOn; }, get filesOn(){ return filesOn; },
      get itemDetailId(){ return itemDetailId; },
      get itemDescOpen(){ return itemDescOpen; }, set itemDescOpen(v){ itemDescOpen = v; },
      get courseDetailName(){ return courseDetailName; },
    };
  }
  render();
})();
