/* app.js — Main Taskplus application
   Depends on: js/utils.js, js/toast.js, js/html.js, js/theme.js, js/notify.js, js/io.js, js/week-chart.js, js/form.js, js/views/*, js/today-logic.js, js/bind-events.js, js/boot.js, firebase-sync.js
*/
(function(){
  /* ---- Storage keys & sync ---- */
  const KEY='tp-assignments';
  function syncPush(){
    if(!window.tpSync) return;
    let prefsNow = {};
    try{ prefsNow = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); }catch(e){}
    const { theme: _theme, todayExpanded: _todayExpanded, tab: _tab, ...syncPrefs } = prefsNow;
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
    if(p.sortMode !== undefined) sortMode = p.sortMode;
    if(p.hideDone !== undefined) hideDone = !!p.hideDone;
    if(p.showArchived !== undefined) showArchived = !!p.showArchived;
    if(p.notifyHour !== undefined && Number.isInteger(p.notifyHour)) notifyHour = p.notifyHour;
    if(p.notifyDigest !== undefined) notifyDigest = !!p.notifyDigest;
    render();
  });
  let devMode = localStorage.getItem(DEV_MODE_KEY) === '1';
  let devPanelOpen = localStorage.getItem(DEV_PANEL_KEY) === '1';
  let editIndex = null;
  let showForm = false;
  let showCourseManager = false;
  // Tracks which element should regain focus after the next render.
  // Either the string 'title' (focus the form's title field) or
  // {id, selStart, selEnd} to restore focus + cursor position on a specific input.
  let pendingFocus = null;
  let pendingScrollId = null;
  let pendingScrollAlign = 'end';
  let pendingTodayAnim = false;
  let weekChartAnimated = false;
  let overdueFilterActive = false;
  let dragSrcIndex = null;
  let celebrationPending = null;

  let prefs = {};
  try{ prefs = JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }catch(e){ prefs = {}; }
  let sortMode = prefs.sortMode || 'urgency';
  let hideDone = !!prefs.hideDone;
  let showArchived = !!prefs.showArchived;
  let searchTerm = prefs.searchTerm || '';
  let theme = ['dark','light','blue','auto'].includes(prefs.theme) ? prefs.theme : 'blue';
  let todayExpanded = !!prefs.todayExpanded;
  const TABS = ['today','all','week','settings','courses'];
  let tab = TABS.includes(prefs.tab) ? prefs.tab : 'today';
  let addOpen = false;
  let pickerOpen = false;
  let menuFor = null; // index into `items`, for the long-press quick-action menu
  let allSortMode = prefs.allSortMode || 'urgency';
  let allFilterCourse = '';
  let weekSelDay = 0;
  let draft = null; // in-progress Add-sheet form state, see js/views/add-sheet-html.js
  // Which hour (0-23, local time) the server-side digest fires at. Mirrors
  // functions/index.js's own default of 8 for a brand new user who hasn't
  // touched the picker yet.
  let notifyHour = Number.isInteger(prefs.notifyHour) ? prefs.notifyHour : 8;
  let notifyDigest = prefs.notifyDigest !== false; // default on

  let courseColors = {};
  try{ courseColors = JSON.parse(localStorage.getItem(COURSE_COLORS_KEY)) || {}; }catch(e){ courseColors = {}; }
  function saveCourseColors(){ localStorage.setItem(COURSE_COLORS_KEY, JSON.stringify(courseColors)); syncPush(); }

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
    localStorage.setItem(PREFS_KEY, JSON.stringify({sortMode,hideDone,showArchived,searchTerm,theme,todayExpanded,notifyHour,notifyDigest,tab,allSortMode}));
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
    if(e.key === 'Escape' && (editIndex!==null || showForm)){
      editIndex = null; showForm = false; render();
      return;
    }
    const tag = document.activeElement ? document.activeElement.tagName : '';
    const typing = tag==='INPUT' || tag==='TEXTAREA' || tag==='SELECT';
    if(!typing && editIndex===null && !showForm){
      if(e.key==='n'){
        e.preventDefault(); showForm = true; pendingFocus = 'title'; render();
      } else if(e.key==='/'){
        e.preventDefault();
        const f = document.getElementById('tp-filter');
        if(f) f.focus();
      }
    }
  });

  /* ---- Course colors ---- */
  const defaultColors = ['#1fae8e','#f0a824','#e8553c','#4361ee','#b83fd1','#2ea9dd','#e0538a'];
  let currentColorMap = {};
  function computeCourseColorMap(){
    const courseKeys = [...new Set(items.map(i=>(i.course||'').trim().toLowerCase()).filter(Boolean))].sort();
    const map = {};
    const usedColors = new Set();
    // Manual overrides get priority and reserve their color.
    courseKeys.forEach(key=>{
      if(courseColors[key]){
        map[key] = courseColors[key];
        usedColors.add(courseColors[key]);
      }
    });
    // Everyone else gets the first unused color from the palette.
    // Only once every color is taken do we fall back to hash-based reuse.
    courseKeys.forEach(key=>{
      if(map[key]) return;
      let assigned = defaultColors.find(c=>!usedColors.has(c));
      if(!assigned){
        let h=0; for(let c of key) h = (h*31 + c.charCodeAt(0))>>>0;
        assigned = defaultColors[h % defaultColors.length];
      }
      map[key] = assigned;
      usedColors.add(assigned);
    });
    return map;
  }
  function courseColor(course){
    const key = (course||'').trim().toLowerCase();
    if(!key) return '#888';
    return currentColorMap[key] || '#888';
  }
  const contrastTextColor = window.TP.contrastTextColor;

  function renameCourse(oldName, newName){
    const oldKey = oldName.trim().toLowerCase();
    const newKey = newName.trim().toLowerCase();
    items.forEach(it=>{
      if((it.course||'').trim().toLowerCase()===oldKey) it.course = newName.trim();
    });
    if(oldKey!==newKey && courseColors[oldKey]){
      courseColors[newKey] = courseColors[oldKey];
      delete courseColors[oldKey];
      saveCourseColors();
    }
    save();
  }

  const scrollToAndHighlight = window.TP.scrollToAndHighlight;

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
      total: it.total, unit: it.unit, notes: it.notes, done: 0, completed: false,
      dependsOn: '', recurring: it.recurring,
      subtasks: (it.subtasks||[]).map(s=>({text:s.text, done:false})),
      completedAt: null, createdAt: today(), archived: false, order: maxOrder+1,
      updatedAt: Date.now()
    };
  }


  function deleteItemAt(idx){
    const finish = ()=>{
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

  function dependsOptionsHtml(course, selected, excludeItem){
    return window.TPForm.dependsOptionsHtml(items, course, selected, excludeItem);
  }

  function formHtml(existing){
    return window.TPForm.formHtml(items, existing);
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
  const linkifyNotes = window.TPHtml.linkifyNotes;

  function weekChartHtml(summaryText, animate){
    return window.TPWeekChart.weekChartHtml({
      items, summaryText, animate, today, addDays, courseColor
    });
  }

  function getDailyStreakNotice(){
    const todayKey = today();
    const seen = localStorage.getItem('tp-streak-banner-seen-date');
    const dismissed = localStorage.getItem('tp-streak-banner-dismissed-date');
    if(seen === todayKey || dismissed === todayKey) return null;

    const streak = currentStreak();
    if(streak > 0){
      return {
        message: `Your ${streak}-day streak is still active. Keep the momentum going today.`
      };
    }

    // Only announce "streak ended" when a real streak just broke: the day
    // before yesterday is logged (streak was alive) but yesterday is not
    // (missed that day). Empty installs, imports with no recent history, and
    // streaks that died days ago must not show this banner.
    const yesterday = addDays(todayKey, -1);
    const dayBeforeYesterday = addDays(todayKey, -2);
    const daySet = new Set(dayCompleteLog);
    const justEnded = daySet.has(dayBeforeYesterday) && !daySet.has(yesterday);
    if(!justEnded) return null;

    return {
      message: 'Your streak ended today. Reset your focus and build it back tomorrow.'
    };
  }

  function dismissDailyStreakNotice(){
    localStorage.setItem('tp-streak-banner-dismissed-date', today());
    localStorage.setItem('tp-streak-banner-seen-date', today());
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


  /* ---- Render ---- */
  function render(){
    currentColorMap = computeCourseColorMap();
    const V = window.TPViews;
    // Check for day-completion BEFORE computing the streak text below, so
    // finishing your last task shows the updated streak instantly instead
    // of waiting until the next render.
    if(computeTodayPanel().allDoneToday) logDayComplete();
    let html = '';
    html += V.topbarHtml({ searchTerm, sortMode });

    const overdueCount = items.filter(it=>!it.completed && !it.archived && !isLocked(it) && daysBetween(today(), it.due)<0).length;
    html += V.overdueBannerHtml({ overdueCount, overdueFilterActive });

    const totalActive = items.filter(i=>!i.completed).length;
    const totalCompleted = items.filter(i=>i.completed).length;
    const streak = currentStreak();
    const streakText = streak > 0 ? `${streak}-day streak 🔥` : '';
    const summaryText = `${totalActive} active \u00b7 ${totalCompleted} completed${streak>0? ' \u00b7 '+streakText : ''}`;

    html += weekChartHtml(summaryText, !weekChartAnimated);
    weekChartAnimated = true;

    html += V.streakBannerHtml({ streakNotice: getDailyStreakNotice() });

    let list = items.map((it,i)=>({it,i}));
    if(!showArchived) list = list.filter(x=>!x.it.archived);
    if(hideDone) list = list.filter(x=>!x.it.completed);
    if(overdueFilterActive) list = list.filter(x=>!x.it.completed && !isLocked(x.it) && daysBetween(today(), x.it.due)<0);
    if(searchTerm){
      const q = searchTerm.toLowerCase();
      list = list.filter(x=>
        (x.it.title||'').toLowerCase().includes(q) ||
        (x.it.course||'').toLowerCase().includes(q) ||
        (x.it.notes||'').toLowerCase().includes(q)
      );
    }
    function sortPriority(it){ return isLocked(it) ? 1 : (it.completed ? 2 : 0); }

    if(sortMode==='custom') list.sort((a,b)=>{
      const pa=sortPriority(a.it), pb=sortPriority(b.it);
      if(pa!==pb) return pa-pb;
      return (a.it.order ?? a.i) - (b.it.order ?? b.i);
    });
    else if(sortMode==='due') list.sort((a,b)=>{
      const pa=sortPriority(a.it), pb=sortPriority(b.it);
      if(pa!==pb) return pa-pb;
      return a.it.due.localeCompare(b.it.due);
    });
    else list.sort((a,b)=>{
      const pa=sortPriority(a.it), pb=sortPriority(b.it);
      if(pa!==pb) return pa-pb;
      return daysBetween(today(),a.it.due) - daysBetween(today(),b.it.due);
    });

    const panel = computeTodayPanel();
    const { requiredTight, requiredPace, optionalBuckets, hasRequired, pickBuckets, allDoneToday } = panel;
    const itemIndexMap = new Map(items.map((it,idx)=>[it, idx]));

    const todayResult = V.todayPanelHtml({
      itemIndexMap, todayExpanded, requiredTight, requiredPace, optionalBuckets,
      pickBuckets, hasRequired, allDoneToday, onAllDone: logDayComplete,
      relativeDueLabel, fmt, unitLabel, capUnit,
    });
    const requiredItemSet = todayResult.requiredItemSet;
    html = todayResult.html + html;

    if(list.length===0){
      html += V.emptyStateHtml({ itemsLength: items.length, searchTerm, hideDone, overdueFilterActive });
    }

    list.forEach(({it,i}, pos)=>{
      html += V.cardHtml({
        it, i, pos, listLen: list.length, sortMode, requiredItemSet,
        isLocked, daysBetween, today, addDays, urgencyClass, relativeDueLabel,
        fmt, unitLabel, capUnit, courseColor, contrastTextColor, linkifyNotes,
      });
    });

    html += V.ioControlsHtml({ hideDone, showArchived, theme, notifyHour, notifyDigest });
    html += V.devToolbarHtml({ devMode, devPanelOpen });
    html += V.courseManagerHtml({ showCourseManager, items, courseColor });
    html += V.modalHtml({
      editIndex, showForm,
      formInnerHtml: formHtml(editIndex!==null ? items[editIndex] : null),
    });
    html += V.fabHtml();


    const prevFills = {};
    root.querySelectorAll('[data-fill-key]').forEach(el=>{
      prevFills[el.dataset.fillKey] = el.style.width;
    });
    const prevCardOpacity = {};
    root.querySelectorAll('.tp-card[id^="tp-card-"]').forEach(el=>{
      prevCardOpacity[el.id] = getComputedStyle(el).opacity;
    });
    const prevTodayBodyEl = root.querySelector('.tp-today-body-anim');
    const prevTodayBodyHeight = (pendingTodayAnim && prevTodayBodyEl) ? prevTodayBodyEl.getBoundingClientRect().height : null;
    const prevTodayBodyHTML = (pendingTodayAnim && prevTodayBodyEl) ? prevTodayBodyEl.innerHTML : null;

    root.innerHTML = html;

    const streakDismissBtn = document.getElementById('tp-streak-dismiss');
    if(streakDismissBtn){
      streakDismissBtn.onclick = ()=>{
        dismissDailyStreakNotice();
        render();
      };
    }

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

    const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(!reducedMotion){
      root.querySelectorAll('.tp-card[id^="tp-card-"]').forEach(el=>{
        const prev = prevCardOpacity[el.id];
        if(prev === undefined) return;
        const target = getComputedStyle(el).opacity;
        if(prev !== target){
          el.style.opacity = prev;
          void el.offsetWidth;
          requestAnimationFrame(()=>{ el.style.opacity = target; });
        }
      });
    }
    if(prevTodayBodyHeight!==null && !reducedMotion){
      const newBodyEl = root.querySelector('.tp-today-body-anim');
      if(newBodyEl){
        const newHeight = newBodyEl.getBoundingClientRect().height;
        // The compact and expanded bodies share the same markup for the
        // required-items prefix, so there's no need to crossfade text.
        if(newHeight < prevTodayBodyHeight && prevTodayBodyHTML!==null){
          // Closing: the real (compact) content is already in the DOM, but
          // it's shorter than what was on screen, so shrinking around it
          // would just close a blank gap instead of clipping the outgoing
          // rows away. Show the old (taller) content while the box shrinks,
          // then swap in the real compact content once it's fully hidden.
          const newHTML = newBodyEl.innerHTML;
          newBodyEl.innerHTML = prevTodayBodyHTML;
          newBodyEl.style.height = prevTodayBodyHeight+'px';
          void newBodyEl.offsetWidth;
          newBodyEl.style.transition = 'height 0.3s ease';
          requestAnimationFrame(()=>{
            newBodyEl.style.height = newHeight+'px';
          });
          newBodyEl.addEventListener('transitionend', function handler(e){
            if(e.propertyName!=='height') return;
            newBodyEl.innerHTML = newHTML;
            newBodyEl.style.height = '';
            newBodyEl.style.transition = '';
            newBodyEl.removeEventListener('transitionend', handler);
          });
        } else {
          // Opening (or same height): the new, taller content is already in
          // the DOM - just grow into it so the extra rows are revealed as
          // space allows.
          newBodyEl.style.height = prevTodayBodyHeight+'px';
          void newBodyEl.offsetWidth;
          newBodyEl.style.transition = 'height 0.3s ease';
          requestAnimationFrame(()=>{
            newBodyEl.style.height = newHeight+'px';
          });
          newBodyEl.addEventListener('transitionend', function handler(e){
            if(e.propertyName!=='height') return;
            newBodyEl.style.height = '';
            newBodyEl.style.transition = '';
            newBodyEl.removeEventListener('transitionend', handler);
          });
        }
      }
    }
    pendingTodayAnim = false;

    window.TPBind.bindEvents(root, {
      items, list, render, save, savePrefs, exportData, exportIcs, importData,
      dependsOptionsHtml, clearCompleted, deleteItemAt, renameCourse, saveCourseColors,
      courseColors, reorderByDrag, makeRecurringClone, triggerCelebration, today,
      hasTodayWorkRemaining, logDayComplete, scrollToAndHighlight, checkAndNotify, applyTheme,
      isDevModeTrigger, activateDevMode, deactivateDevMode, saveDevPanelOpen, showToast,
      DAY_OFFSET_KEY,
      get showForm(){ return showForm; }, set showForm(v){ showForm = v; },
      get editIndex(){ return editIndex; }, set editIndex(v){ editIndex = v; },
      get sortMode(){ return sortMode; }, set sortMode(v){ sortMode = v; },
      get todayExpanded(){ return todayExpanded; }, set todayExpanded(v){ todayExpanded = v; },
      get pendingTodayAnim(){ return pendingTodayAnim; }, set pendingTodayAnim(v){ pendingTodayAnim = v; },
      get hideDone(){ return hideDone; }, set hideDone(v){ hideDone = v; },
      get showArchived(){ return showArchived; }, set showArchived(v){ showArchived = v; },
      get searchTerm(){ return searchTerm; }, set searchTerm(v){ searchTerm = v; },
      get pendingFocus(){ return pendingFocus; }, set pendingFocus(v){ pendingFocus = v; },
      get overdueFilterActive(){ return overdueFilterActive; }, set overdueFilterActive(v){ overdueFilterActive = v; },
      get theme(){ return theme; }, set theme(v){ theme = v; },
      get showCourseManager(){ return showCourseManager; }, set showCourseManager(v){ showCourseManager = v; },
      get pendingScrollId(){ return pendingScrollId; }, set pendingScrollId(v){ pendingScrollId = v; },
      get pendingScrollAlign(){ return pendingScrollAlign; }, set pendingScrollAlign(v){ pendingScrollAlign = v; },
      get dragSrcIndex(){ return dragSrcIndex; }, set dragSrcIndex(v){ dragSrcIndex = v; },
      get devMode(){ return devMode; }, set devMode(v){ devMode = v; },
      get devPanelOpen(){ return devPanelOpen; }, set devPanelOpen(v){ devPanelOpen = v; },
      get notifyHour(){ return notifyHour; }, setNotifyHour,
      get notifyDigest(){ return notifyDigest; }, set notifyDigest(v){ notifyDigest = v; },
      touchItem, newItemId,
    });

  }
  render();
})();