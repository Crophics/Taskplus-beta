/* app.js — Main Taskplus application
   Depends on: js/utils.js, js/toast.js, js/html.js, js/theme.js, js/notify.js,
   js/io.js, js/courses.js, js/all-logic.js, js/week-logic.js, js/views/*,
   js/today-logic.js, js/bind-events.js, js/boot.js, firebase-sync.js
*/
(function(){
  /* ---- Storage keys & sync ---- */
  const KEY='tp-assignments';
  function syncPush(){
    refreshProgressMap();
    if(!window.tpSync) return;
    let prefsNow = {};
    try{ prefsNow = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); }catch(e){}
    const { theme: _theme, tab: _tab, ...syncPrefs } = prefsNow;
    window.tpSync.push({
      items: items.filter(it=>!window.TPMoodle.isImported(it)),
      courseColors,
      courses,
      deletedCourses,
      ignored: ignoredMap,
      progress: progressMap,
      estimates: estimateMap,
      actuals: actualMap,
      aiEstimates: aiMap,
      notes: noteMap,
      dayCompleteLog,
      deletedLog,
      prefs: syncPrefs
    });
  }
  const PREFS_KEY='tp-prefs';
  const COURSE_COLORS_KEY='tp-course-colors';
  const COURSES_KEY='tp-courses';
  const DELETED_COURSES_KEY='tp-deleted-courses';
  const IGNORED_KEY='tp-ignored';
  const PROGRESS_KEY='tp-imported-progress';
  const ESTIMATES_KEY='tp-imported-estimates';
  const ACTUALS_KEY='tp-imported-actuals';
  const AI_KEY='tp-imported-ai';
  const NOTES_KEY='tp-imported-notes';
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
  const FEED_KEY='tp-feed';
  const MOODLE_SITE_KEY='tp-moodle-last-site';
  const LLM_KEY='tp-llm-on';
  const LLM_FILES_KEY='tp-llm-files';
  // Grades were dropped (Moodle stays the place for them): forget what an older version stored.
  ['tp-moodle-grades','tp-grade-settings','tp-schedule'].forEach(k=>{ try{ localStorage.removeItem(k); }catch(e){} });
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
  // Courses deleted here or on another device ({key: name, deletedAt}); see TPCourses.applyTombstones.
  let deletedCourses = readJsonArray(DELETED_COURSES_KEY);
  function saveDeletedCourses(){ try{ localStorage.setItem(DELETED_COURSES_KEY, JSON.stringify(deletedCourses)); }catch(e){} }
  // The user deleted a course: remember it, or the next sync brings it back from another copy of the data.
  function recordCourseDeleted(name){
    deletedCourses = window.TPCourses.recordDeletion(deletedCourses, name, Date.now());
    saveDeletedCourses();
  }
  // A course synced in from another device can duplicate one made here (same name, different id), or
  // be one deleted since: keep one per name and drop the deleted.
  function dedupeCourses(){
    const clean = window.TPCourses.applyTombstones(window.TPCourses.dedupeByName(courses), deletedCourses);
    if(clean.length === courses.length) return;
    courses = clean;
    try{ localStorage.setItem(COURSES_KEY, JSON.stringify(courses)); }catch(e){}
  }
  dedupeCourses();

  document.addEventListener('tp-remote-data', function(){
    items = loadItems();
    try{ courseColors = JSON.parse(localStorage.getItem(COURSE_COLORS_KEY)) || {}; }catch(e){ courseColors = {}; }
    try{ courses = JSON.parse(localStorage.getItem(COURSES_KEY)) || []; }catch(e){ courses = []; }
    deletedCourses = readJsonArray(DELETED_COURSES_KEY);
    dedupeCourses();
    ignoredMap = readJsonObject(IGNORED_KEY, {});
    progressMap = readJsonObject(PROGRESS_KEY, {});
    estimateMap = readJsonObject(ESTIMATES_KEY, {});
    actualMap = readJsonObject(ACTUALS_KEY, {});
    aiMap = readJsonObject(AI_KEY, {});
    noteMap = readJsonObject(NOTES_KEY, {});
    if(applySyncedMaps()) persistItems();
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
  const TABS = ['today','all','week','settings','manage','item','changes'];
  // A saved 'courses' tab (removed: Courses is part of All now) opens All.
  let tab = prefs.tab === 'courses' || prefs.tab === 'course' ? 'all' : TABS.includes(prefs.tab) && prefs.tab !== 'item' && prefs.tab !== 'changes' ? prefs.tab : 'today';
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
    localStorage.setItem(PREFS_KEY, JSON.stringify({searchTerm,theme,notifyHour,notifyDigest,tab: tab==='item' ? itemDetailFrom : tab==='changes' ? changesFrom : tab,allSortMode}));
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
      if(timeFor!==null){ skipTime(); return; }
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
      items, courses, query: searchTerm, sortMode: allSortMode, filterCourse: allFilterCourse,
      isLocked, today, daysBetween,
    });
  }

  function readJsonObject(key, fallback){
    try{ const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback; }catch(e){ return fallback; }
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
    let applied = 0, limited = false, errorMessage = '', errorCodes = [];
    try{
      for(let i = 0; i < cand.length; i += 5){
        const chunk = cand.slice(i, i + 5);
        const keys = {};
        chunk.forEach(it=>{ keys[it.id] = window.TPEstimate.inputsKey(it); });
        let res;
        try{
          res = await window.TPMoodle.api.estimate(chunk.map(it=> window.TPMoodle.modelInput(it, it.due ? daysBetween(t, it.due) : null, filesOn, window.TPLearn.pastWork(it, items))), force, filesOn);
        }catch(e){
          if(e && (e.code === 'not_configured' || e.code === 'not_allowed')) llmUnavailable = true;
          errorMessage = (e && e.message) || '';
          break;
        }
        const out = window.TPMoodle.applyModelResults(items, res.results, { today: t, keys, force, readFiles: filesOn });
        items = out.items;
        recordAi(out.stats.appliedIds);
        window.TPLearn.applyLearning(items);
        applied += out.stats.applied;
        if(out.stats.limited) limited = true;
        errorCodes = errorCodes.concat(out.stats.errors);
        if(out.stats.unavailable) llmUnavailable = true;
        persistItems();
        if(out.stats.limited || out.stats.unavailable) break;
      }
    } finally {
      modelBusy = false;
    }
    if(force){
      showToast(applied ? 'Updated with an AI estimate'
        : limited ? 'Today\'s limit for AI estimates is used up'
        : (errorMessage || aiFailureText(errorCodes)));
    } else if(applied){
      showToast(`AI improved ${applied} estimate${applied === 1 ? '' : 's'}`);
    }
    if(!userIsTyping()) render();
  }
  // Plain words for why an AI answer did not come (the server's error codes).
  function aiFailureText(codes){
    const c = (codes || [])[0];
    const why = ({
      busy: 'The AI service is busy or rate-limited right now. Try again in a minute.',
      daily_limit: 'Today\'s limit for AI estimates is used up.',
      server_misconfigured: 'The AI key on the server is not working.',
      not_configured: 'The AI is not set up on the server.',
      refused: 'The AI declined to answer for this assignment.',
      truncated: 'The AI\'s answer was cut off. Try again.',
      bad_output: 'The AI\'s answer was not usable. Try again.',
      model_error: 'The AI service returned an error. Try again in a minute.',
      bad_input: 'That assignment could not be sent to the AI.',
    })[c];
    return (why || 'The AI could not estimate that.') + ' Keeping the current estimate.';
  }
  function askClaude(id){ return requestModelEstimates({ force: true, ids: [id] }); }

  /* ---- Assignment detail (js/views/item-detail-html.js) ---- */
  let itemDetailId = null;
  let itemDetailFrom = 'today';
  let itemDescOpen = false;
  function itemIndexById(id){ return items.findIndex(x=>x && x.id === id); }
  /* ---- Ignore: write off overdue work so it stops showing as overdue (js/item-logic.js isPlanned) ---- */
  const isPlanned = window.TPItemLogic.isPlanned;
  // Only overdue, unfinished work can be ignored; once ignored, "stop ignoring" is always available.
  function canIgnore(it){
    return !!it && !it.completed && !it.ignored && !!it.due && window.TPDue.isOverdue(it, today());
  }
  // Imported items never reach the cloud, so the ignored flag travels as its own small map (item id -> {on, at}).
  let progressMap = readJsonObject(PROGRESS_KEY, {});
  let actualMap = readJsonObject(ACTUALS_KEY, {});
  let aiMap = readJsonObject(AI_KEY, {});
  let noteMap = readJsonObject(NOTES_KEY, {});
  // Everything about imported items that travels between devices, applied in one place (see "What syncs" in AGENTS.md).
  function applySyncedMaps(){
    const M = window.TPMoodle;
    const r = [applyIgnoredFromMap(), M.applyProgress(items, progressMap), M.applyEstimates(items, estimateMap, aiMap), M.applyActuals(items, actualMap), M.applyNotes(items, noteMap), window.TPLearn.applyLearning(items), window.TPLearn.refitParts(items)];
    return r.some(Boolean);
  }
  // An AI answer made before entries existed gets one now, stamped with when it was made, so an older copy on another device cannot win.
  function recordAi(ids){
    const M = window.TPMoodle;
    let next = aiMap;
    (ids || []).forEach(id=>{ const it = items.find(x=> x && x.id === id); if(it) next = M.setAiEntry(next, id, it, it.estimate && it.estimate.at); });
    next = M.seedAiMap(items, next, estimateMap);
    if(JSON.stringify(next) !== JSON.stringify(aiMap)){
      aiMap = next;
      try{ localStorage.setItem(AI_KEY, JSON.stringify(aiMap)); }catch(e){}
    }
  }

  /* ---- "How long did it take?" (js/learning.js, js/views/time-sheet-html.js) ---- */
  let timeFor = null; // id of the item the sheet is asking about
  let timeJustOpened = false;
  function askTime(it){
    if(!it || !window.TPLearn.canAsk(it)) return;
    timeFor = it.id;
    timeJustOpened = true;
  }
  function skipTime(){ timeFor = null; render(); }
  function saveActual(minutes){
    const it = items.find(x=> x && x.id === timeFor);
    timeFor = null;
    if(!it) { render(); return; }
    const a = window.TPLearn.recordActual(it, minutes, Date.now());
    if(!a){ render(); return; }
    if(window.TPMoodle.isImported(it)){
      actualMap = window.TPMoodle.setActualEntry(actualMap, it.id, a);
      try{ localStorage.setItem(ACTUALS_KEY, JSON.stringify(actualMap)); }catch(e){}
    }
    touchItem(it);
    window.TPLearn.applyLearning(items); // similar open work is re-estimated from what you just said
    save();
    showToast('Saved. Similar work will use it.');
  }
  let estimateMap = readJsonObject(ESTIMATES_KEY, {});
  // Your own estimates of imported items sync through this map (see TPMoodle.setEstimateEntry).
  function recordEstimate(id, minutes, steps){
    estimateMap = window.TPMoodle.setEstimateEntry(estimateMap, id, minutes, Date.now(), steps);
    try{ localStorage.setItem(ESTIMATES_KEY, JSON.stringify(estimateMap)); }catch(e){}
  }
  // Done / progress on imported items syncs as its own small map (they never reach the cloud document).
  function refreshProgressMap(){
    const next = window.TPMoodle.progressMap(items, progressMap, Date.now());
    if(JSON.stringify(next) !== JSON.stringify(progressMap)){
      progressMap = next;
      try{ localStorage.setItem(PROGRESS_KEY, JSON.stringify(progressMap)); }catch(e){}
    }
  }
  // Repair items an earlier version left reopened but with every part still counted done (they never came back).
  (function repairReopened(){
    let fixed = false;
    items.forEach(it=>{
      if(!it.completed && it.total > 0 && it.done >= it.total){ it.done = it.total - 1; it.updatedAt = Date.now(); fixed = true; }
    });
    if(fixed){ persistItems(); refreshProgressMap(); }
  })();
  if(window.TPMoodle.applyProgress(items, progressMap)) persistItems();
  let ignoredMap = readJsonObject(IGNORED_KEY, {});
  function applyIgnoredFromMap(){
    return window.TPItemLogic.applyIgnored(items, ignoredMap, today(), daysBetween);
  }
  if(applyIgnoredFromMap()) persistItems();
  // Items ignored before the map existed have no record yet: add one so they reach other devices too.
  (function seedIgnoredMap(){
    let seeded = false;
    items.forEach(it=>{
      if(it.ignored && it.id && !ignoredMap[it.id]){ ignoredMap = window.TPItemLogic.setIgnoredEntry(ignoredMap, it.id, true, Date.now()); seeded = true; }
    });
    if(seeded){ try{ localStorage.setItem(IGNORED_KEY, JSON.stringify(ignoredMap)); }catch(e){} }
  })();
  // Run once everything above exists: records old AI answers and applies what other devices sent.
  recordAi([]);
  if(applySyncedMaps()) persistItems();
  function setIgnored(idx, on){
    const it = items[idx];
    if(!it) return;
    if(on && !canIgnore(it)) return;
    if(on) it.ignored = true; else delete it.ignored;
    ignoredMap = window.TPItemLogic.setIgnoredEntry(ignoredMap, it.id, on, Date.now());
    try{ localStorage.setItem(IGNORED_KEY, JSON.stringify(ignoredMap)); }catch(e){}
    touchItem(it);
    menuFor = null;
    save();
    showToast(on ? 'Ignored. It won\'t show as overdue.' : 'No longer ignored');
  }
  function openItem(id){
    if(itemIndexById(id) < 0) return;
    itemDetailId = id;
    itemDescOpen = false;
    planDraft = null;
    if(tab !== 'item') itemDetailFrom = tab;
    screenJustSwitched = true;
    tab = 'item';
    if(typeof window.scrollTo === 'function') window.scrollTo(0, 0);
    savePrefs();
    render();
  }
  function closeItem(){
    planDraft = null;
    tab = itemDetailFrom || 'today';
    savePrefs();
    render();
  }
  // Notes are model-only: typing never re-renders (render-loop rule in AGENTS.md).
  let notesPushTimer = null;
  function setItemNotes(id, value){
    const i = itemIndexById(id);
    if(i < 0) return;
    items[i].notes = value;
    items[i].notesAt = Date.now();
    touchItem(items[i]);
    if(window.TPMoodle.isImported(items[i])){
      noteMap = window.TPMoodle.setNoteEntry(noteMap, id, value, items[i].notesAt);
      try{ localStorage.setItem(NOTES_KEY, JSON.stringify(noteMap)); }catch(e){}
    }
    persistItems();
    // Share it once typing pauses (no render: the field must keep focus).
    clearTimeout(notesPushTimer);
    notesPushTimer = setTimeout(syncPush, 1500);
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
    const mine = window.TPEstimate.userEstimate(minutes, items[i].estimate.steps);
    if(window.TPMoodle.isImported(items[i])) recordEstimate(items[i].id, mine.minutes, mine.steps);
    replaceItem(i, window.TPEstimate.withEstimate(items[i], mine));
  }
  function resetEstimate(id){
    const i = itemIndexById(id);
    if(i < 0) return;
    if(window.TPMoodle.isImported(items[i])) recordEstimate(items[i].id, null);
    replaceItem(i, window.TPEstimate.withEstimate(items[i], window.TPEstimate.estimateForItem(items[i])));
  }
  /* ---- Edit the plan: parts, their names and their minutes (TPEstimate.planRows/checkPlan/withPlan) ---- */
  let planDraft = null; // {rows: [{name, minutes}], locked: finished parts that cannot change, error}
  function canEditPlan(it){
    return !!it && window.TPMoodle.isImported(it) && !it.completed && !!it.estimate && !!it.due && !(it.source && it.source.kind === 'quiz');
  }
  function openPlanEditor(){
    const it = items[itemIndexById(itemDetailId)];
    if(!canEditPlan(it)) return;
    planDraft = { rows: window.TPEstimate.planRows(it), locked: Math.min(it.done || 0, Math.max((it.total || 1) - 1, 0)), error: '' };
    render();
  }
  function closePlanEditor(){ planDraft = null; render(); }
  function savePlan(){
    const i = itemIndexById(itemDetailId);
    if(i < 0 || !planDraft) return;
    const res = window.TPEstimate.checkPlan(planDraft.rows);
    if(res.error){ planDraft.error = res.error; render(); return; }
    const next = window.TPEstimate.withPlan(items[i], res.steps);
    recordEstimate(items[i].id, next.estimate.minutes, next.estimate.steps);
    planDraft = null;
    replaceItem(i, next);
    showToast('Plan saved');
  }
  function itemDetailCtx(){
    const i = itemIndexById(itemDetailId);
    const item = items[i];
    return {
      item, idx: i, escapeHtml: window.TPHtml.escapeHtml, color: item.course ? courseColorFor(item.course) : 'var(--text-faint)',
      relativeDueLabel, daysToDue: item.due ? daysBetween(today(), item.due) : null, descOpen: itemDescOpen, canIgnore: canIgnore(item),
      fromLabel: ({ today:'Today', week:'Week', all:'All', courses:'Courses' })[itemDetailFrom] || 'Back',
      llm: { available: llmOn && moodleSignedIn() && !llmUnavailable, busy: modelBusy },
      canEditPlan: canEditPlan(item), planDraft, canTime: window.TPLearn.canAsk(item),
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
  // What only THIS device knows about its imports; the server's status must never overwrite it.
  function ownImportState(){ return { lastImportAt: moodleState.lastImportAt, importShape: moodleState.importShape, syncError: moodleState.syncError }; }
  // Pulls the latest assignments/quizzes through the Worker and merges them in.
  async function moodleSync(opts){
    const silent = !!(opts && opts.silent);
    if(moodleBusy) return;
    moodleBusy = true;
    if(!silent && tab === 'settings' && !userIsTyping()) render();
    try{
      const res = await window.TPMoodle.api.sync();
      const merged = window.TPMoodle.mergeImported(items, res.records, { today: today(), deletedLog, now: Date.now(), progress: progressMap });
      items = merged.items;
      // Items Moodle just created (e.g. on a second device) have no ignore flag yet: apply the synced list.
      applyIgnoredFromMap();
      applySyncedMaps(); // ...nor your own estimates, the AI's answers, times and notes
      // A course with no assignments yet still gets its card: every course picked for syncing is listed.
      const names = (res.records||[]).map(r=>r.course).concat((res.courses||[]).filter(c=>c.selected).map(c=>c.code));
      if(window.TPMoodle.ensureCourseNames(courses, names, undefined, deletedCourses)) saveCourses();
      appendMoodleEvents(merged.events);
      addToFeed(res.events);
      moodleState = { ...moodleState, connected: true, courses: res.courses, lastSyncAt: res.syncedAt, lastImportAt: Date.now(), importShape: window.TPMoodle.IMPORT_SHAPE, syncError: null, warnings: (res.warnings||[]).slice(0, 40) };
      saveMoodleState();
      persistItems();
      syncPush(); // the cloud copy learns about new manual state (and this device about others') right away
      if(!silent || merged.stats.added || merged.stats.moved) showToast(window.TPMoodle.summarize(merged.stats));
      requestModelEstimates().catch(()=>{});
    }catch(e){
      const code = e && e.code;
      if(code === 'moodle_auth'){
        moodleState = { connected: false };
        saveMoodleState();
        showToast('Moodle sign-in expired. Connect again in Settings.');
      } else if(code === 'too_soon'){
        // The server synced a moment ago (its own 30-minute check) and refuses a second call for 30 s: try again shortly.
        if(!(opts && opts.retried)) setTimeout(()=>moodleSync({silent:true, retried:true}), 31000);
      } else if(code === 'offline' && silent && ((opts && opts.attempt) || 0) < window.TPMoodle.RETRY_MS.length){
        // The automatic sync could not reach the server (often the network is not up yet): try again soon.
        const attempt = (opts && opts.attempt) || 0;
        setTimeout(()=>moodleSync({silent:true, attempt: attempt + 1}), window.TPMoodle.RETRY_MS[attempt]);
      } else {
        // Remember why, so Settings can say so (a silent open-time sync used to fail without a trace).
        moodleState = { ...moodleState, syncError: (e && e.message) || 'Could not sync Moodle' };
        saveMoodleState();
        if(!silent) showToast(moodleState.syncError);
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
      moodleState = { ...status, ...ownImportState() };
      saveMoodleState();
    }catch(e){
      moodleState = { ...moodleState, courses: prev };
      saveMoodleState();
      showToast('Could not save that change');
    }
    render();
  }
  // Opening the app from an alert means the server found something: import now, however recent the last sync.
  let forceSyncOnOpen = location.hash === '#sync';
  if(forceSyncOnOpen){ try{ window.history.replaceState(null, '', location.pathname + location.search); }catch(e){} }
  function moodleSyncFromAlert(){
    if(moodleSignedIn()) moodleSync({silent:true});
  }
  if('serviceWorker' in navigator){
    navigator.serviceWorker.addEventListener('message', e=>{ if(e.data && e.data.type === 'tp-notification-click') moodleSyncFromAlert(); });
  }
  // A push while the app is open: the server just synced (it limits calls to one per 30 s), so wait a moment.
  document.addEventListener('tp-fcm-message', (e)=>{
    // The app is open, so the system may not show a banner: say it here too.
    const d = e && e.detail && e.detail.data;
    if(d && d.title) showToast(d.body ? d.title + ': ' + d.body : d.title);
    setTimeout(moodleSyncFromAlert, 35000);
  });
  function moodleMaybeAutoSync(){
    if(!moodleSignedIn()) return;
    if(forceSyncOnOpen){ forceSyncOnOpen = false; moodleSync({silent:true}); return; }
    if(window.TPMoodle.shouldAutoSync(moodleState, Date.now())) moodleSync({silent:true});
    else requestModelEstimates().catch(()=>{}); // nothing to sync yet, but older items may still need Claude's estimate
  }

  /* ---- What's new feed + Moodle alerts (Phase 5; js/views/changes-html.js) ---- */
  let feed = (function(){
    const f = readJsonObject(FEED_KEY, null);
    if(!(f && Array.isArray(f.events))) return { events: [], seenAt: Date.now() };
    // Grade and feedback updates no longer exist; drop ones an older version saved.
    return { ...f, events: f.events.filter(e=> e && e.kind !== 'grade' && e.kind !== 'feedback') };
  })();
  let changesFrom = 'today';
  let alerts = { loaded:false, configured:false, devices:0, prefs:{ new:true, moved:true, due:true, quiet:{ on:false, start:22, end:8 } } };
  function saveFeed(){ try{ localStorage.setItem(FEED_KEY, JSON.stringify(feed)); }catch(e){} }
  function addToFeed(events){
    if(!events || !events.length) return;
    feed = window.TPMoodle.mergeFeed(feed, events, Date.now());
    saveFeed();
  }
  function openChanges(){
    if(tab !== 'changes') changesFrom = tab;
    tab = 'changes';
    screenJustSwitched = true;
    if(typeof window.scrollTo === 'function') window.scrollTo(0, 0);
    render();
    feed = window.TPMoodle.markFeedSeen(feed, Date.now()); // the unread highlight stays for this view, then clears
    saveFeed();
  }
  function closeChanges(){ tab = changesFrom || 'today'; render(); }
  async function loadFeed(){
    try{
      const r = await window.TPMoodle.api.feed();
      addToFeed(r.events);
    }catch(e){ /* offline or not set up: keep what we have */ }
  }
  async function loadAlerts(){
    try{
      const s = await window.TPMoodle.api.pushStatus();
      alerts = { loaded:true, configured:!!s.configured, devices:s.devices||0, prefs:s.prefs };
      if(tab === 'settings' && !userIsTyping()) render();
    }catch(e){ /* keep defaults */ }
  }
  async function registerPushToken(token){
    try{ await window.TPMoodle.api.registerPush(token); }catch(e){ return; }
    loadAlerts();
  }
  document.addEventListener('tp-push-token', function(e){ if(e.detail && e.detail.token) registerPushToken(e.detail.token); });
  async function savePrefsToServer(patch){
    const old = alerts.prefs;
    const next = { ...old, ...patch, quiet: { ...old.quiet, ...(patch.quiet||{}) } };
    alerts = { ...alerts, prefs: next };
    render();
    try{
      const s = await window.TPMoodle.api.pushPrefs(next);
      alerts = { loaded:true, configured:!!s.configured, devices:s.devices||0, prefs:s.prefs };
    }catch(e){
      alerts = { ...alerts, prefs: old };
      showToast((e && e.message) || 'Could not save that change');
    }
    if(!userIsTyping()) render();
  }
  async function sendTestAlert(){
    try{
      const r = await window.TPMoodle.api.testPush();
      showToast(r.sent ? 'Test sent to ' + ((r.targets && r.targets.length) ? r.targets.join(' and ') : r.sent + ' device' + (r.sent === 1 ? '' : 's')) : 'Nothing was delivered. ' + (r.reason || 'Check notification permission.'));
    }catch(e){ showToast((e && e.message) || 'Could not send a test'); }
  }
  async function moodleBoot(){
    try{
      const status = await window.TPMoodle.api.status();
      moodleState = status.connected ? { ...status, ...ownImportState() } : { connected: false };
      saveMoodleState();
    }catch(e){
      return; // not configured, offline, or signed out: keep the cached state
    }
    if(tab === 'settings' && !userIsTyping()) render();
    loadFeed().then(()=>{ if(tab === 'today' && !userIsTyping()) render(); });
    loadAlerts();
    moodleMaybeAutoSync();
  }
  document.addEventListener('tp-auth-changed', function(e){
    if(e.detail && e.detail.user) moodleBoot();
    else if(tab === 'settings' && !userIsTyping()) render();
  });
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState === 'visible') moodleMaybeAutoSync();
  });
  // The connection came back (or came up late after opening the app): catch up if a sync is due.
  window.addEventListener('online', ()=>{ moodleMaybeAutoSync(); });

  // Touch gestures (js/gestures.js): swipe between tabs, swipe back, pull down to sync with Moodle.
  if(window.TPGestures){
    window.TPGestures.init({
      state: ()=>({ tab, blocked: !!(addOpen || connectOpen || menuFor != null || timeFor != null || userIsTyping()) }),
      goTab: (t)=>{ tab = t; screenJustSwitched = true; savePrefs(); render(); if(typeof window.scrollTo === 'function') window.scrollTo(0, 0); },
      // Use the screen's own back button so the gesture and the button can never disagree.
      back: ()=>{
        const b = document.querySelector('.tp-c-back');
        if(b) b.click();
        else if(tab === 'settings'){ tab = 'today'; screenJustSwitched = true; savePrefs(); render(); }
      },
      refresh: ()=>{
        if(!moodleState.connected){ showToast('Connect Moodle in Settings to sync'); return; }
        return moodleSync({silent:false});
      }
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
        courseColorFor, relativeDueLabel, unitLabel, capUnit, plan, today, daysBetween,
        TPTodayLogic: window.TPTodayLogic,
        showBell: !!moodleState.connected, unread: window.TPMoodle.unreadCount(feed),
      });
    } else if(tab==='all'){
      screenHtml = V.allScreenHtml(allCtx());
    } else if(tab==='week'){
      const weekCtx = { items, today, daysBetween };
      // Minutes view when any open item has a time estimate; otherwise the original unit view.
      const planDays = window.TPPlan.computeDays({ items, today: today(), daysBetween, isLocked });
      const hasEstimates = items.some(it=> !it.completed && !it.archived && isPlanned(it) && window.TPPlan.minutesPerUnit(it) !== null);
      const days = hasEstimates
        ? planDays.days.map(d=>({ dayIndex: d.dayIndex, total: d.minutes, byCourse: d.byCourse }))
        : window.TPWeekLogic.computePacedLoad(weekCtx);
      const heavyWeek = hasEstimates ? window.TPPlan.heavyDay(planDays.days) : null;
      const minutesCtx = hasEstimates ? {
        on: true, entriesFor: (i)=> planDays.days[i].entries, heavyIndex: heavyWeek ? heavyWeek.dayIndex : -1, unestimated: planDays.unestimated,
        leftMin: items.reduce((s,it)=> (it.completed||it.archived||!isPlanned(it)) ? s : s + (window.TPPlan.leftMinutes(it) || 0), 0),
      } : { on: false };
      const dayLabels = days.map((_,i)=> window.TP.asDate(addDays(today(),i)).toLocaleDateString(undefined,{weekday:'long'}));
      const stats = window.TPWeekLogic.statTiles(weekCtx);
      const heaviestLabel = window.TPWeekLogic.heaviestDayLabel(days, dayLabels);
      const courseStats = window.TPWeekLogic.byCourseBreakdown(items, courseColorFor);
      const animateChart = weekChartFirstRender;
      weekChartFirstRender = false;
      screenHtml = V.weekScreenHtml({
        escapeHtml, days, dayLabels, selDay: weekSelDay, stats, heaviestLabel,
        courseColorFor, courseStats, relativeDueLabel, animateChart,
        items, today, daysBetween, TPWeekLogic: window.TPWeekLogic, minutes: minutesCtx,
        hdr: headerCtx(),
      });
    } else if(tab==='settings'){
      screenHtml = V.settingsScreenHtml({
        theme, notifyHour, notifyDigest, courses, escapeHtml,
        completedCount: items.filter(i=>i.completed).length,
        syncLabel: window.tpSyncLabel || 'Sign in to sync',
        moodle: { state: moodleState, busy: moodleBusy, signedIn: moodleSignedIn() }, llmOn, filesOn, alerts,
      }) + V.devToolbarHtml({ devMode, devPanelOpen });
    } else if(tab==='item'){
      screenHtml = V.itemDetailHtml(itemDetailCtx());
    } else if(tab==='changes'){
      screenHtml = V.changesScreenHtml({ feed, escapeHtml, now: Date.now(), fromLabel: ({week:'Week', all:'All'})[changesFrom] || 'Today', colorFor: courseColorFor });
    } else if(tab==='manage'){
      screenHtml = V.coursesScreenHtml({
        escapeHtml, courses, openCountFor: (name)=> window.TPCourses.openCountForCourse(items, name),
        draftName: newCourseName, draftColor: newCourseColor,
      });
    }

    if(screenJustSwitched) screenHtml = `<div class="tp-screen-enter">${screenHtml}</div>`;
    let html = V.tabBarHtml({ tab: tab==='item' ? itemDetailFrom : tab==='changes' ? changesFrom : tab }) + screenHtml;

    if(addOpen && draft){
      html += V.addSheetHtml({ draft, courses, items, pickerOpen, moreOpen, prereqOpen, escapeHtml, today, daysBetween, isEdit: editIndex!==null, sheetJustOpened });
    }
    if(connectOpen){
      html += V.connectSheetHtml({ draft: connectDraft, error: connectError, busy: connectBusy, escapeHtml, sheetJustOpened: connectJustOpened });
      connectJustOpened = false;
    }
    if(menuFor!=null && items[menuFor]){
      const it = items[menuFor];
      html += V.quickMenuHtml({ it, i: menuFor, escapeHtml, relativeDueLabel, unit: it.unit || 'units', menuJustOpened, canIgnore: canIgnore(it), color: courseColorFor(it.course), imported: window.TPMoodle.isImported(it), canOpen: !!(it.source && it.source.type === 'moodle' && it.estimate) });
    }

    if(timeFor!=null){
      const it = items.find(x=> x && x.id === timeFor);
      if(it){
        const raw = window.TPLearn.rawEstimate(it);
        html += V.timeSheetHtml({ it, escapeHtml, color: courseColorFor(it.course), justOpened: timeJustOpened, estimateText: raw ? window.TPPlan.fmtMinutes(window.TPPlan.roundDisplay(raw.minutes)) : '' });
        timeJustOpened = false;
      }
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
  // What every main screen's header needs: the What's new bell (with its unread dot) and Settings.
  function headerCtx(){ return { showBell: !!moodleState.connected, unread: window.TPMoodle.unreadCount(feed) }; }
  function allCtx(){
    return {
      escapeHtml: window.TPHtml.escapeHtml, hdr: headerCtx(), searchTerm, sortMode: allSortMode, filterCourse: allFilterCourse,
      courses, groups: allGroups(),
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
      askTime, skipTime, saveActual,
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
      openChanges, closeChanges, savePrefsToServer, sendTestAlert, get alerts(){ return alerts; },
      setIgnored, canIgnore, recordCourseDeleted, openItem, closeItem, setItemNotes, adjustEstimate, resetEstimate, askClaude, setLlmOn, setFilesOn,
      get llmOn(){ return llmOn; }, get filesOn(){ return filesOn; },
      get itemDetailId(){ return itemDetailId; },
      get planDraft(){ return planDraft; }, openPlanEditor, closePlanEditor, savePlan,
      get itemDescOpen(){ return itemDescOpen; }, set itemDescOpen(v){ itemDescOpen = v; },
    };
  }
  render();
})();
