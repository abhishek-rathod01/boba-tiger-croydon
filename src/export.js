/* Boba Tiger Hours Tracker — export.js
 *
 * JSON backup/restore is implemented here now (simple, no external
 * dependency). Excel (.xlsx via SheetJS CDN) + CSV fallback export is
 * added in Phase 5.
 */
(function (BT) {
  'use strict';

  function triggerDownload(filename, content, mimeType) {
    var blob = new Blob([content], { type: mimeType });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function downloadBackup() {
    var root = BT.state.get();
    var json = JSON.stringify(root, null, 2);
    var today = BT.time.todayISO();
    triggerDownload('BobaTiger_Backup_' + today + '.json', json, 'application/json');
    BT.state.update(function (r) { r.meta.lastBackupAt = new Date().toISOString(); });
  }

  // Parses and validates a backup file's text content. Returns
  // { ok: true, data } or { ok: false, message } — never throws.
  function parseBackupText(text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { ok: false, message: "That file doesn't look like a Boba Tiger backup (it isn't valid JSON). Choose the .json file you downloaded from Settings." };
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries) || !Array.isArray(parsed.staff)) {
      return { ok: false, message: "That file doesn't look like a Boba Tiger backup — it's missing the expected data. Choose the .json file you downloaded from Settings." };
    }
    return { ok: true, data: parsed };
  }

  function restoreFromData(data) {
    BT.state.update(function (root) {
      var fresh = BT.state.emptyRoot();
      Object.keys(fresh).forEach(function (key) {
        if (data[key] !== undefined) root[key] = data[key]; else root[key] = fresh[key];
      });
      // Re-run migration-style defaults in case the backup predates a field.
      if (root.settings.model === undefined) root.settings.model = fresh.settings.model;
      if (root.settings.setupComplete === undefined) root.settings.setupComplete = root.staff.length > 0;
    });
  }

  // ---- Excel (.xlsx) export, CSV fallback --------------------------------

  var SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js';
  var sheetjsLoadPromise = null;

  // Loaded on demand (only when the user actually exports), not as a static
  // <script> tag in index.html — that's what lets us branch cleanly on
  // "did the CDN actually load" (onload -> real .xlsx, onerror/timeout ->
  // CSV fallback) rather than guessing from a tag that gives no such signal.
  function loadSheetJS() {
    if (window.XLSX) return Promise.resolve(true);
    if (sheetjsLoadPromise) return sheetjsLoadPromise;
    sheetjsLoadPromise = new Promise(function (resolve) {
      var script = document.createElement('script');
      script.src = SHEETJS_URL;
      script.onload = function () { resolve(!!window.XLSX); };
      script.onerror = function () { resolve(false); };
      document.head.appendChild(script);
      // Belt-and-braces: some network failures (e.g. a hung connection)
      // never fire onerror at all, so don't wait forever.
      setTimeout(function () { resolve(!!window.XLSX); }, 8000);
    });
    return sheetjsLoadPromise;
  }

  function staffName(root, staffId) {
    var s = root.staff.find(function (x) { return x.id === staffId; });
    return s ? s.name : 'Unknown';
  }

  function summarizeSnapshotForExport(root, snap) {
    if (!snap) return '';
    var name = staffName(root, snap.staffId);
    if (snap.status === 'open') return name + ' — clocked in ' + snap.clockIn + ' (open)';
    return name + ' — ' + BT.time.formatDateDMY(snap.date) + ' ' + snap.clockIn + '–' + snap.clockOut +
      ', ' + (snap.hoursWorked != null ? snap.hoursWorked.toFixed(2) : '?') + 'h';
  }

  // Builds the three sheets' row data (array-of-arrays, header row first) for
  // the given inclusive {start, end} ISO date range. Kept independent of
  // SheetJS itself so it's tolerant of the CDN being unreachable, and so the
  // exact same rows feed both the .xlsx path and the CSV fallback path.
  //
  // The Summary sheet is built from BT.state.computeTotals — the same
  // function the dashboard and the AI Q&A context use — so an exported
  // total can never disagree with what's shown on screen.
  //
  // Open (still-clocked-in) shifts that fall in range ARE included as a row
  // (never silently dropped) with "Still working" in place of a clock-out
  // time and blank break/hours, since neither is known yet.
  function buildExportRows(range) {
    var root = BT.state.get();

    var hoursRows = [['Name', 'Date', 'In', 'Out', 'Break (min)', 'Hours', 'Source', 'Note']];
    root.entries
      .filter(function (e) { return BT.time.isDateInRange(e.date, range); })
      .sort(function (a, b) { return (a.date + a.clockIn).localeCompare(b.date + b.clockIn); })
      .forEach(function (e) {
        var isOpen = e.status === 'open';
        hoursRows.push([
          staffName(root, e.staffId),
          BT.time.formatDateDMY(e.date),
          e.clockIn,
          isOpen ? 'Still working' : e.clockOut,
          isOpen ? '' : e.breakMinutes,
          isOpen ? '' : e.hoursWorked,
          e.source,
          e.note || ''
        ]);
      });

    var totals = BT.state.computeTotals(root, range);
    var summaryRows = [['Name', 'Total hours']];
    root.staff.filter(function (s) { return s.active !== false; }).forEach(function (s) {
      summaryRows.push([s.name, totals.byStaffId[s.id] || 0]);
    });

    var auditRows = [['When', 'Action', 'Via', 'Before', 'After']];
    root.auditLog.forEach(function (a) {
      auditRows.push([
        new Date(a.timestamp).toLocaleString('en-GB'),
        a.action, a.via,
        summarizeSnapshotForExport(root, a.before),
        summarizeSnapshotForExport(root, a.after)
      ]);
    });

    return { hoursRows: hoursRows, summaryRows: summaryRows, auditRows: auditRows };
  }

  function buildFilenameBase(range) {
    var mRange = BT.time.monthRange(range.start);
    if (range.start === mRange.start && range.end === mRange.end) {
      return 'BobaTiger_Hours_' + range.start.slice(0, 7); // matches the spec's example filename
    }
    return 'BobaTiger_Hours_' + range.start + '_to_' + range.end;
  }

  function csvEscape(val) {
    var s = String(val == null ? '' : val);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function rowsToCsv(rows) {
    return rows.map(function (r) { return r.map(csvEscape).join(','); }).join('\r\n');
  }

  function exportCsvFallback(rows, filenameBase) {
    triggerDownload(filenameBase + '_Hours.csv', rowsToCsv(rows.hoursRows), 'text/csv');
    triggerDownload(filenameBase + '_Summary.csv', rowsToCsv(rows.summaryRows), 'text/csv');
    triggerDownload(filenameBase + '_AuditLog.csv', rowsToCsv(rows.auditRows), 'text/csv');
  }

  // Returns { ok: true, usedFallback: boolean, filename or filenameBase }.
  async function exportForRange(range) {
    var rows = buildExportRows(range);
    var filenameBase = buildFilenameBase(range);
    var sheetjsReady = await loadSheetJS();

    if (!sheetjsReady || !window.XLSX) {
      exportCsvFallback(rows, filenameBase);
      return { ok: true, usedFallback: true, filenameBase: filenameBase };
    }

    var wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(rows.hoursRows), 'Hours');
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(rows.summaryRows), 'Summary');
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(rows.auditRows), 'Audit Log');
    var filename = filenameBase + '.xlsx';
    window.XLSX.writeFile(wb, filename);
    return { ok: true, usedFallback: false, filename: filename, workbook: wb };
  }

  BT.exportData = {
    downloadBackup: downloadBackup,
    parseBackupText: parseBackupText,
    restoreFromData: restoreFromData,
    triggerDownload: triggerDownload,
    loadSheetJS: loadSheetJS,
    buildExportRows: buildExportRows,
    buildFilenameBase: buildFilenameBase,
    exportForRange: exportForRange,
    exportCsvFallback: exportCsvFallback
  };
})(window.BT = window.BT || {});
