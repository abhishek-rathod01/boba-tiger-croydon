/* Boba Tiger Hours Tracker — state.js
 *
 * The single source of truth: one root object, autosaved to localStorage on
 * every change. No other module reads/writes localStorage directly.
 *
 * Root object shape (see docs/system-design.md §4):
 * {
 *   version: 1,
 *   settings: { shopName, groqApiKey, model, weekStartsOn },
 *   staff: [ { id, name, active, hourlyRate } ],
 *   entries: [ { id, staffId, date, clockIn, clockOut, breakMinutes,
 *                hoursWorked, source, note, status, createdAt, updatedAt } ],
 *   auditLog: [ { id, timestamp, action, entryId, before, after, via } ],
 *   chatLog: [ { id, timestamp, role, text } ],
 *   meta: { lastBackupAt }
 * }
 */
(function (BT) {
  'use strict';

  var STORAGE_KEY = 'bobaTigerHours_v1';
  var CURRENT_VERSION = 1;

  var listeners = [];
  var root = null;
  var storageStatus = { available: true, reason: null };

  function emptyRoot() {
    return {
      version: CURRENT_VERSION,
      settings: {
        shopName: 'Boba Tiger Croydon',
        groqApiKey: '',
        model: 'llama-3.1-8b-instant',
        weekStartsOn: 'Monday',
        setupComplete: false,
        wizardStep: 'welcome' // welcome | key | staff | done
      },
      staff: [],
      entries: [],
      auditLog: [],
      chatLog: [],
      meta: { lastBackupAt: null }
    };
  }

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Detect whether localStorage is usable at all (private browsing / full /
  // disabled). Must run before anything else touches storage.
  function detectStorage() {
    try {
      var testKey = '__bt_storage_test__';
      window.localStorage.setItem(testKey, '1');
      window.localStorage.removeItem(testKey);
      storageStatus = { available: true, reason: null };
    } catch (e) {
      storageStatus = { available: false, reason: e && e.name === 'QuotaExceededError' ? 'full' : 'blocked' };
    }
    return storageStatus;
  }

  function migrate(obj) {
    // No migrations yet beyond v1; this is the seam for future schema bumps.
    if (!obj.version) obj.version = CURRENT_VERSION;
    if (!obj.meta) obj.meta = { lastBackupAt: null };
    if (!obj.settings) obj.settings = emptyRoot().settings;
    if (obj.settings.model === undefined) obj.settings.model = 'llama-3.1-8b-instant';
    if (obj.settings.setupComplete === undefined) obj.settings.setupComplete = obj.staff && obj.staff.length > 0;
    if (obj.settings.wizardStep === undefined) obj.settings.wizardStep = obj.settings.setupComplete ? 'done' : 'welcome';
    if (!obj.staff) obj.staff = [];
    if (!obj.entries) obj.entries = [];
    if (!obj.auditLog) obj.auditLog = [];
    if (!obj.chatLog) obj.chatLog = [];
    return obj;
  }

  function load() {
    detectStorage();
    if (!storageStatus.available) {
      root = emptyRoot();
      return root;
    }
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      root = raw ? migrate(JSON.parse(raw)) : emptyRoot();
    } catch (e) {
      // Corrupt JSON: don't throw the whole app away, start clean but keep
      // the broken raw string recoverable for support purposes if ever needed.
      root = emptyRoot();
    }
    return root;
  }

  function persist() {
    if (!storageStatus.available) return { ok: false, reason: storageStatus.reason };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(root));
      return { ok: true };
    } catch (e) {
      storageStatus = { available: false, reason: e && e.name === 'QuotaExceededError' ? 'full' : 'blocked' };
      return { ok: false, reason: storageStatus.reason };
    }
  }

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(root); } catch (e) { /* one bad listener shouldn't break others */ }
    });
  }

  // All mutations go through here: run `mutator(root)`, then autosave + notify.
  function update(mutator) {
    mutator(root);
    var result = persist();
    notify();
    return result;
  }

  function subscribe(fn) {
    listeners.push(fn);
    return function unsubscribe() {
      var idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  }

  function get() { return root; }

  function storageInfo() {
    // Rough estimate of bytes used by our key, for the Settings indicator.
    var bytes = 0;
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      bytes = raw ? raw.length : 0;
    } catch (e) { /* ignore */ }
    return { bytes: bytes, available: storageStatus.available, reason: storageStatus.reason };
  }

  // ---- Audit log helper -----------------------------------------------
  // Every create/edit/delete of an entry must call this so the audit trail
  // is complete. `before`/`after` are plain snapshots (or null for create/delete).
  function appendAudit(rootObj, action, entryId, before, after, via) {
    rootObj.auditLog.push({
      id: uid('a'),
      timestamp: new Date().toISOString(),
      action: action, // 'create' | 'edit' | 'delete'
      entryId: entryId,
      before: before,
      after: after,
      via: via // 'clock' | 'ai' | 'manual'
    });
  }

  function appendChat(rootObj, role, text) {
    rootObj.chatLog.push({
      id: uid('c'),
      timestamp: new Date().toISOString(),
      role: role, // 'user' | 'assistant'
      text: text
    });
  }

  // Single source of truth for "hours worked in a date range, per staff".
  // Both the dashboard's weekly/monthly summary AND the AI Q&A context call
  // this exact function — they can't disagree with each other because
  // there's only one place the number is computed.
  //
  // Only counts 'complete' entries (an open/still-clocked-in shift has no
  // hoursWorked yet); range is inclusive {start, end} ISO dates.
  // Returns { byStaffId: { [staffId]: totalHours }, totalHours: number }.
  function computeTotals(rootObj, range) {
    var byStaffId = {};
    var total = 0;
    rootObj.entries.forEach(function (e) {
      if (e.status !== 'complete') return;
      if (e.date < range.start || e.date > range.end) return;
      var hours = e.hoursWorked || 0;
      byStaffId[e.staffId] = (byStaffId[e.staffId] || 0) + hours;
      total += hours;
    });
    // Round for display; keep to 2dp same as individual entries.
    Object.keys(byStaffId).forEach(function (id) { byStaffId[id] = Math.round(byStaffId[id] * 100) / 100; });
    return { byStaffId: byStaffId, totalHours: Math.round(total * 100) / 100 };
  }

  BT.state = {
    STORAGE_KEY: STORAGE_KEY,
    uid: uid,
    load: load,
    get: get,
    update: update,
    subscribe: subscribe,
    storageInfo: storageInfo,
    detectStorage: detectStorage,
    appendAudit: appendAudit,
    appendChat: appendChat,
    computeTotals: computeTotals,
    emptyRoot: emptyRoot
  };
})(window.BT = window.BT || {});
