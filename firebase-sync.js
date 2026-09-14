import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
  import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
  import { getFirestore, doc, setDoc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
  import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";
  import { FCM_VAPID_KEY } from "./js/fcm-config.js";

  const firebaseConfig = {
    apiKey: "AIzaSyB9Xyx3JioVqjvOfWvWvhJUAZV4lCWfjuQ",
    authDomain: "planner-88ab8.firebaseapp.com",
    projectId: "planner-88ab8",
    storageBucket: "planner-88ab8.firebasestorage.app",
    messagingSenderId: "387783207136",
    appId: "1:387783207136:web:c127dfc6250d40a6abc885"
  };

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const provider = new GoogleAuthProvider();

  let currentUser = null;
  let unsubSnapshot = null;
  let unsubFcmSnapshot = null;
  let applyingRemote = false;
  let lastPushedAt = null;
  // Firestore's fcm.lastDigestDate, mirrored locally so the browser
  // notification (notify.js) and the FCM push (functions/index.js) can
  // coordinate: whichever fires first for the day stamps this date, so
  // the other side can skip and the user only sees one notification.
  let remoteDigestDate = null;

  function newId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "tp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function ensureItemMeta(it) {
    if (!it.id) it.id = newId();
    if (it.updatedAt == null) it.updatedAt = Date.now();
    return it;
  }

  function itemKey(it) {
    if (it.id) return "id:" + it.id;
    // Legacy fallback before ids existed
    return "legacy:" + (it.createdAt || "") + "|" + (it.title || "") + "|" + (it.course || "");
  }

  // Content signature for an item, used only to catch the case below where
  // id-matching can't help: two devices that each already have their own
  // random id for what is really the same assignment. Deliberately narrow
  // (the identity-defining fields) so it won't misfire on things like notes
  // or completion progress differing between devices.
  function contentKey(it) {
    return [
      String(it.title || "").trim().toLowerCase(),
      String(it.course || "").trim().toLowerCase(),
      it.due || "",
      it.total != null ? it.total : "",
      String(it.unit || "").trim().toLowerCase(),
    ].join("|");
  }

  /**
   * Merge two item lists by stable id (or legacy key).
   * - Present on only one side → keep, UNLESS a tombstone (see mergeDeletedLog)
   *   for that id is at least as new as the item's own updatedAt — in that
   *   case the item was deliberately deleted on some device and hasn't been
   *   overtaken by a later edit, so it's dropped instead of resurrected.
   * - Present on both → higher updatedAt wins (tie → remote)
   * - Present on only one side by id, but there's an item on the OTHER side
   *   with no id match of its own and the same title/course/due/unit/total →
   *   these are almost certainly the same real-world assignment, added on
   *   two devices before they'd ever synced with each other (each device
   *   handed it its own random id). Collapse them into one instead of
   *   keeping both, which is what used to make every assignment "double" on
   *   first sync. The newer-edited copy wins and its id is kept going
   *   forward so later syncs match it by id normally.
   * Returns { items, remoteWins, localWins, addedFromRemote, addedFromLocal }
   */
  function mergeItems(localItems, remoteItems, deletedLog) {
    const local = (localItems || []).map((it) => ensureItemMeta({ ...it }));
    const remote = (remoteItems || []).map((it) => ensureItemMeta({ ...it }));
    const tombstones = new Map((deletedLog || []).map((t) => [t.id, t.deletedAt || 0]));
    const isDeleted = (it) => {
      if (!it.id || !tombstones.has(it.id)) return false;
      return tombstones.get(it.id) >= (it.updatedAt || 0);
    };

    const localKeys = new Set(local.map(itemKey));
    const remoteKeys = new Set(remote.map(itemKey));

    const map = new Map();
    const stats = { remoteWins: 0, localWins: 0, addedFromRemote: 0, addedFromLocal: 0, coalesced: 0 };

    local.forEach((it) => {
      map.set(itemKey(it), { it, side: "local" });
    });

    remote.forEach((rit) => {
      const key = itemKey(rit);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { it: rit, side: "remote" });
        stats.addedFromRemote++;
        return;
      }
      const lit = existing.it;
      const lu = lit.updatedAt || 0;
      const ru = rit.updatedAt || 0;
      if (ru > lu) {
        map.set(key, { it: rit, side: "remote" });
        stats.remoteWins++;
      } else if (lu > ru) {
        stats.localWins++;
        // keep local
      } else {
        // tie: prefer remote (matches server echo after concurrent equal clocks)
        map.set(key, { it: rit, side: "remote" });
        stats.remoteWins++;
      }
    });

    // Count local-only as addedFromLocal
    local.forEach((it) => {
      const key = itemKey(it);
      const entry = map.get(key);
      if (entry && entry.side === "local" && !remote.some((r) => itemKey(r) === key)) {
        stats.addedFromLocal++;
      }
    });

    // Coalesce id-mismatched duplicates (see comment above).
    const onlyLocalKeys = [...map.keys()].filter((k) => localKeys.has(k) && !remoteKeys.has(k));
    const onlyRemoteKeys = [...map.keys()].filter((k) => remoteKeys.has(k) && !localKeys.has(k));
    onlyLocalKeys.forEach((lKey) => {
      const lEntry = map.get(lKey);
      if (!lEntry || isDeleted(lEntry.it)) return;
      const sig = contentKey(lEntry.it);
      const rKeyIdx = onlyRemoteKeys.findIndex((rKey) => {
        const rEntry = map.get(rKey);
        return rEntry && !isDeleted(rEntry.it) && contentKey(rEntry.it) === sig;
      });
      if (rKeyIdx === -1) return;
      const rKey = onlyRemoteKeys[rKeyIdx];
      const rEntry = map.get(rKey);
      const lit = lEntry.it;
      const rit = rEntry.it;
      const remoteIsNewer = (rit.updatedAt || 0) >= (lit.updatedAt || 0);
      const winner = remoteIsNewer ? rit : lit;
      map.delete(rKey);
      map.set(lKey, { it: winner, side: remoteIsNewer ? "remote" : "local" });
      onlyRemoteKeys.splice(rKeyIdx, 1);
      stats.coalesced++;
      if (remoteIsNewer) stats.addedFromRemote = Math.max(0, stats.addedFromRemote - 1);
      else stats.addedFromLocal = Math.max(0, stats.addedFromLocal - 1);
    });

    const items = [...map.values()].map((e) => e.it).filter((it) => !isDeleted(it));
    return { items, stats };
  }

  function mergeDayLog(localLog, remoteLog) {
    return [...new Set([...(localLog || []), ...(remoteLog || [])])].sort();
  }

  // Tombstones: union by id, keeping the newest deletedAt per id. Pruned to a
  // generous window (well beyond any realistic offline stretch) so the log
  // doesn't grow forever — once a tombstone is older than that, every device
  // has almost certainly already reconciled it and it's safe to drop.
  const TOMBSTONE_MAX_AGE_MS = 120 * 24 * 60 * 60 * 1000; // 120 days
  function mergeDeletedLog(localLog, remoteLog) {
    const byId = new Map();
    [...(localLog || []), ...(remoteLog || [])].forEach((t) => {
      if (!t || !t.id) return;
      const prev = byId.get(t.id);
      if (!prev || (t.deletedAt || 0) > (prev.deletedAt || 0)) byId.set(t.id, t);
    });
    const cutoff = Date.now() - TOMBSTONE_MAX_AGE_MS;
    return [...byId.values()].filter((t) => (t.deletedAt || 0) >= cutoff);
  }

  function mergeCourseColors(localColors, remoteColors) {
    // Union; remote fills gaps, local keeps explicit overrides where both set
    return { ...(remoteColors || {}), ...(localColors || {}) };
  }

  // Same union-by-id philosophy as mergeCourseColors: courses carry no
  // updatedAt of their own, so on a same-id conflict local just wins.
  function mergeCourses(localCourses, remoteCourses) {
    const map = new Map();
    (remoteCourses || []).forEach((c) => map.set(c.id, c));
    (localCourses || []).forEach((c) => map.set(c.id, c));
    return [...map.values()];
  }

  function mergePrefs(localPrefs, remotePrefs) {
    // Prefer local for same keys (device may have just changed UI prefs)
    return { ...(remotePrefs || {}), ...(localPrefs || {}) };
  }

  function readLocalPayload() {
    let prefs = {};
    try {
      prefs = JSON.parse(localStorage.getItem("tp-prefs") || "{}");
    } catch (e) {}
    const { theme, todayExpanded, ...syncPrefs } = prefs;
    // theme/todayExpanded stay device-local
    let items = [];
    try {
      items = JSON.parse(localStorage.getItem("tp-assignments") || "[]");
    } catch (e) {}
    items = items.map((it) => ensureItemMeta(it));
    let deletedLog = [];
    try {
      deletedLog = JSON.parse(localStorage.getItem("tp-deleted-log") || "[]");
    } catch (e) {}
    return {
      items,
      courseColors: JSON.parse(localStorage.getItem("tp-course-colors") || "{}"),
      courses: JSON.parse(localStorage.getItem("tp-courses") || "[]"),
      dayCompleteLog: JSON.parse(localStorage.getItem("tp-day-complete-log") || "[]"),
      deletedLog,
      prefs: syncPrefs,
    };
  }

  function writeLocalPayload(data, { merged } = {}) {
    applyingRemote = true;
    if (data.items) localStorage.setItem("tp-assignments", JSON.stringify(data.items));
    if (data.courseColors) localStorage.setItem("tp-course-colors", JSON.stringify(data.courseColors));
    if (data.courses) localStorage.setItem("tp-courses", JSON.stringify(data.courses));
    if (data.dayCompleteLog) localStorage.setItem("tp-day-complete-log", JSON.stringify(data.dayCompleteLog));
    if (data.deletedLog) localStorage.setItem("tp-deleted-log", JSON.stringify(data.deletedLog));
    if (data.prefs) {
      let existing = {};
      try {
        existing = JSON.parse(localStorage.getItem("tp-prefs") || "{}");
      } catch (e) {}
      localStorage.setItem("tp-prefs", JSON.stringify({ ...existing, ...data.prefs }));
    }
    applyingRemote = false;
    if (merged && merged.stats) {
      document.dispatchEvent(
        new CustomEvent("tp-sync-merged", { detail: { stats: merged.stats } })
      );
    }
  }

  function applyRemoteMerge(remoteData) {
    const local = readLocalPayload();
    const deletedLog = mergeDeletedLog(local.deletedLog, remoteData.deletedLog);
    const { items, stats } = mergeItems(local.items, remoteData.items || [], deletedLog);
    const merged = {
      items,
      courseColors: mergeCourseColors(local.courseColors, remoteData.courseColors),
      courses: mergeCourses(local.courses, remoteData.courses),
      dayCompleteLog: mergeDayLog(local.dayCompleteLog, remoteData.dayCompleteLog),
      deletedLog,
      prefs: mergePrefs(local.prefs, remoteData.prefs),
    };
    writeLocalPayload(merged, { merged: { stats } });
    return stats;
  }

  let messaging = null;

  async function ensureMessaging() {
    if (messaging) return messaging;
    const ok = await isSupported().catch(() => false);
    if (!ok) return null;
    messaging = getMessaging(app);
    return messaging;
  }

  // sw.js (registered once, in boot.js) now handles both offline app-shell
  // caching AND background FCM messages. We deliberately do NOT register a
  // second service worker here: a browser origin can only have one active
  // service worker per scope, and registering firebase-messaging-sw.js at
  // the same root scope as sw.js used to conflict with it (background push
  // could get stuck "waiting" and never activate). Just wait for the
  // existing registration to be ready and hand that to getToken().
  async function registerMessagingSw() {
    if (!("serviceWorker" in navigator)) return null;
    const reg = await navigator.serviceWorker.ready;
    // Never let a falsy/unexpected result silently fall through to
    // getToken()'s own default behavior, which is to register
    // '/firebase-messaging-sw.js' itself — a second worker fighting sw.js
    // for the same scope. Fail loudly here instead so that never happens.
    if (!reg) throw new Error("No active service worker registration for FCM");
    return reg;
  }

  async function saveFcmToken(token, notifyHour) {
    if (!currentUser || !token) return;
    const ref = doc(db, "users", currentUser.uid, "taskplus", "fcm");
    const snap = await getDoc(ref);
    const prev = snap.exists() ? snap.data() : {};
    const tokens = { ...(prev.tokens || {}) };
    tokens[token] = {
      updatedAt: Date.now(),
      userAgent: navigator.userAgent.slice(0, 180),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    };
    await setDoc(
      ref,
      {
        tokens,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        // Prefer whatever hour the user already had picked in the UI over
        // the stored value, so enabling push for the first time doesn't
        // silently reset their choice back to the 8am default.
        notifyHour:
          notifyHour != null ? notifyHour : prev.notifyHour != null ? prev.notifyHour : 8,
        updatedAt: Date.now(),
      },
      { merge: true }
    );
  }

  /**
   * Update just the digest hour for the signed-in user. Writes immediately
   * (no debounce) because dailyDueDigest runs exactly on the hour: the
   * scheduler is "every 60 minutes", which Cloud Scheduler aligns to `0 *
   * * * *` (top of hour), and it does a once-per-day equality check
   * (localHour === notifyHour). A write that lands after that tick doesn't
   * just push the digest an hour later — fcm.lastDigestDate already gets
   * stamped for "no items due" days, and even when it isn't, the hour won't
   * match again until the same time tomorrow. So the whole point of this
   * function is to get the new value into Firestore well before the next
   * `:00`, not to batch it with other prefs.
   * @returns {{ ok: boolean, reason?: string, message?: string }}
   */
  async function saveNotifyHour(hour) {
    if (!currentUser) return { ok: false, reason: "signed-out" };
    const h = Number(hour);
    if (!Number.isInteger(h) || h < 0 || h > 23) return { ok: false, reason: "invalid-hour" };
    try {
      const ref = doc(db, "users", currentUser.uid, "taskplus", "fcm");
      await setDoc(ref, { notifyHour: h, updatedAt: Date.now() }, { merge: true });
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: "error", message: e && e.message };
    }
  }

  /**
   * Called after the browser (foreground) notification fires today, so the
   * scheduled FCM digest — which already skips a user when
   * fcm.lastDigestDate === today (see functions/index.js) — skips them too
   * and doesn't send a second, redundant notification for the same items.
   * @param {string} dateStr today's date, in the same YYYY-MM-DD shape used
   *   throughout notify.js / functions/index.js
   */
  async function markDigestSentToday(dateStr) {
    if (!currentUser || !dateStr) return;
    remoteDigestDate = dateStr;
    try {
      const ref = doc(db, "users", currentUser.uid, "taskplus", "fcm");
      await setDoc(ref, { lastDigestDate: dateStr, updatedAt: Date.now() }, { merge: true });
    } catch (e) {}
  }

  /**
   * Request notification permission, register FCM SW, store token in Firestore.
   * @param {number} [notifyHour] hour already picked in the UI, if any
   * @returns {{ ok: boolean, reason?: string, token?: string }}
   */
  async function enablePush(notifyHour) {
    if (!("Notification" in window)) return { ok: false, reason: "unsupported" };
    if (!FCM_VAPID_KEY) {
      return {
        ok: false,
        reason: "missing-vapid",
        message:
          "Add your Web Push certificate key to js/fcm-config.js (Firebase Console → Cloud Messaging → Web Push certificates).",
      };
    }
    const perm =
      Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, reason: "denied" };

    const msg = await ensureMessaging();
    if (!msg) return { ok: false, reason: "unsupported" };

    const reg = await registerMessagingSw();
    const token = await getToken(msg, {
      vapidKey: FCM_VAPID_KEY,
      serviceWorkerRegistration: reg || undefined,
    });
    if (!token) return { ok: false, reason: "no-token" };
    await saveFcmToken(token, notifyHour);

    // Foreground messages while the app is open
    onMessage(msg, (payload) => {
      const title = (payload.data && payload.data.title) || (payload.notification && payload.notification.title) || "Taskplus";
      const body =
        (payload.data && payload.data.body) ||
        (payload.notification && payload.notification.body) ||
        "";
      try {
        // Same tag + icon path as sw.js's showNotification. FCM
        // "notification"-type payloads (what the Console's test tool
        // sends) can get shown both by the browser's own default handling
        // AND by this foreground handler when the tab is open. Matching
        // tags means a second display replaces the first instead of
        // stacking as two notifications.
        new Notification(title, { body, icon: (payload.data && payload.data.icon) || "./icons/icon-192.png", tag: (payload.data && payload.data.tag) || "taskplus-digest" });
      } catch (e) {}
      document.dispatchEvent(new CustomEvent("tp-fcm-message", { detail: payload }));
    });

    return { ok: true, token };
  }

  async function refreshPushTokenIfEnabled() {
    if (!currentUser) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (!FCM_VAPID_KEY) return;
    try {
      const msg = await ensureMessaging();
      if (!msg) return;
      const reg = await registerMessagingSw();
      const token = await getToken(msg, {
        vapidKey: FCM_VAPID_KEY,
        serviceWorkerRegistration: reg || undefined,
      });
      if (token) await saveFcmToken(token);
    } catch (e) {
      console.warn("FCM token refresh failed", e);
    }
  }

  window.tpSync = {
    signIn: () => signInWithPopup(auth, provider),
    signOut: () => signOut(auth),
    getUser: () => currentUser,
    ensureItemMeta,
    newId,
    enablePush,
    refreshPushTokenIfEnabled,
    saveNotifyHour,
    getLastDigestDate: () => remoteDigestDate,
    markDigestSentToday,
    hasVapidKey: () => !!FCM_VAPID_KEY,
    push: async (payload) => {
      if (!currentUser || applyingRemote) return;
      const items = (payload.items || []).map((it) => ensureItemMeta(it));
      const updatedAt = Date.now();
      lastPushedAt = updatedAt;
      await setDoc(doc(db, "users", currentUser.uid, "taskplus", "data"), {
        ...payload,
        items,
        updatedAt,
      });
    },
  };

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (unsubSnapshot) {
      unsubSnapshot();
      unsubSnapshot = null;
    }
    if (unsubFcmSnapshot) {
      unsubFcmSnapshot();
      unsubFcmSnapshot = null;
    }
    remoteDigestDate = null;
    document.dispatchEvent(new CustomEvent("tp-auth-changed", { detail: { user } }));
    if (!user) {
      // No account signed in, so there's no remote digest to wait for —
      // the caller's initial checkAndNotify() (see app.js) can proceed
      // immediately with remoteDigestDate staying null.
      document.dispatchEvent(new CustomEvent("tp-fcm-ready", {}));
      return;
    }
    refreshPushTokenIfEnabled();

    // fcm.notifyHour is a single per-account value (the scheduled function
    // sends one digest to every token on the account), not per-device — so
    // on sign-in, pull whatever's actually in Firestore and let the UI
    // reconcile to it. Otherwise a second device just shows its own stale
    // local default/last-picked hour, which doesn't match what the server
    // is really going to do. A live listener (rather than one-shot getDoc)
    // also means an FCM push landing while the app is open, or another
    // device stamping lastDigestDate, updates remoteDigestDate right away.
    //
    // fcmSnapshotReady tracks whether the FIRST callback from this listener
    // has landed. Until it does, remoteDigestDate is a stale "null" left
    // over from the reset above, not a real answer — so any caller (e.g.
    // app.js's initial checkAndNotify() at page load) that reads it too
    // early can't tell "no digest sent today" apart from "haven't heard
    // from Firestore yet". That gap was the cause of the local due-soon
    // notification and the FCM push both firing the same day: the FCM
    // digest had already run server-side and stamped fcm.lastDigestDate,
    // but the browser's onSnapshot callback (like any Firestore listener)
    // resolves asynchronously, well after app.js's synchronous startup
    // call to checkAndNotify() had already read remoteDigestDate as null
    // and gone ahead and notified. Dispatching "tp-fcm-ready" the first
    // time this callback fires — and having app.js wait for it before its
    // first check — closes that gap.
    let fcmSnapshotReady = false;
    unsubFcmSnapshot = onSnapshot(doc(db, "users", user.uid, "taskplus", "fcm"), (fcmSnap) => {
      if (fcmSnap.exists()) {
        const data = fcmSnap.data();
        if (Number.isInteger(data.notifyHour)) {
          document.dispatchEvent(new CustomEvent("tp-notify-hour-remote", { detail: { notifyHour: data.notifyHour } }));
        }
        if (data.lastDigestDate) remoteDigestDate = data.lastDigestDate;
      }
      if (!fcmSnapshotReady) {
        fcmSnapshotReady = true;
        document.dispatchEvent(new CustomEvent("tp-fcm-ready", {}));
      }
    });

    const ref = doc(db, "users", user.uid, "taskplus", "data");
    const snap = await getDoc(ref);
    if (snap.exists()) {
      applyRemoteMerge(snap.data());
      document.dispatchEvent(new CustomEvent("tp-remote-data", {}));
      // Push merge result so the other device learns about local-only items
      const local = readLocalPayload();
      const updatedAt = Date.now();
      lastPushedAt = updatedAt;
      await setDoc(ref, { ...local, updatedAt });
    } else {
      await setDoc(ref, { ...readLocalPayload(), updatedAt: Date.now() });
    }

    unsubSnapshot = onSnapshot(ref, (docSnap) => {
      if (!docSnap.exists()) return;
      const data = docSnap.data();
      if (data.updatedAt !== undefined && data.updatedAt === lastPushedAt) return;
      applyRemoteMerge(data);
      document.dispatchEvent(new CustomEvent("tp-remote-data", {}));
    });
  });