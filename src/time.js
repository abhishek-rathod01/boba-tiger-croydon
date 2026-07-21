/* Boba Tiger Hours Tracker — time.js
 *
 * All date/time reasoning for the app lives here. Two rules drive everything:
 *   1. "Today" / "yesterday" / weekday lookups are resolved in the Europe/London
 *      timezone explicitly (never device-local, never UTC) so a shift entered
 *      near midnight, or across a DST boundary, still lands on the right date.
 *   2. Hours worked is pure HH:MM minute arithmetic, computed here in JS —
 *      never trusted from the AI. Overnight shifts (clock-out time <= clock-in
 *      time) add 24h before subtracting the break.
 *
 * Dates are always represented as ISO strings "YYYY-MM-DD" internally, and
 * only formatted to DD/MM/YYYY for display. Times are always "HH:MM" 24h.
 */
(function (BT) {
  'use strict';

  var LONDON_TZ = 'Europe/London';

  // ---- London "wall clock" parts for any Date instant --------------------

  // Returns { year, month, day, hour, minute, second, weekday } as numbers,
  // reflecting the Europe/London local wall-clock time for the given Date
  // (or now, if omitted). weekday: 0=Sunday..6=Saturday (matches Date#getDay).
  function londonParts(date) {
    var d = date instanceof Date ? date : new Date();
    var fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: LONDON_TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
      weekday: 'short'
    });
    var parts = fmt.formatToParts(d);
    var map = {};
    parts.forEach(function (p) { map[p.type] = p.value; });
    var weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    // Some engines render hour "24" for midnight with hour12:false; normalize.
    var hour = parseInt(map.hour, 10);
    if (hour === 24) hour = 0;
    return {
      year: parseInt(map.year, 10),
      month: parseInt(map.month, 10),
      day: parseInt(map.day, 10),
      hour: hour,
      minute: parseInt(map.minute, 10),
      second: parseInt(map.second, 10),
      weekday: weekdayMap[map.weekday]
    };
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // ISO "YYYY-MM-DD" for today in Europe/London.
  function todayISO() {
    var p = londonParts(new Date());
    return p.year + '-' + pad2(p.month) + '-' + pad2(p.day);
  }

  // ISO "HH:MM" for the current London wall-clock time.
  function nowHHMM() {
    var p = londonParts(new Date());
    return pad2(p.hour) + ':' + pad2(p.minute);
  }

  // Add `days` (may be negative) to an ISO date string, calendar-correct
  // (handles month/year rollover and DST — we operate on the date part only,
  // using UTC noon as a safe anchor so no timezone shift can roll the date).
  function addDaysISO(iso, days) {
    var parts = iso.split('-').map(Number);
    var d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
    d.setUTCDate(d.getUTCDate() + days);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  function yesterdayISO() {
    return addDaysISO(todayISO(), -1);
  }

  // Resolve "last <weekday>" relative to London-today. weekdayName is
  // case-insensitive full or 3-letter English name (e.g. "Tuesday"/"tue").
  // "Last Tuesday" means the most recent Tuesday strictly before today
  // (i.e. if today IS Tuesday, it means 7 days ago, not today).
  var WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  function lastWeekdayISO(weekdayName, fromISO) {
    var name = String(weekdayName).toLowerCase();
    var idx = WEEKDAY_NAMES.findIndex(function (w) { return w === name || w.slice(0, 3) === name.slice(0, 3); });
    if (idx === -1) return null;
    var base = fromISO || todayISO();
    var baseParts = base.split('-').map(Number);
    var baseDate = new Date(Date.UTC(baseParts[0], baseParts[1] - 1, baseParts[2], 12, 0, 0));
    var baseWeekday = baseDate.getUTCDay();
    var diff = (baseWeekday - idx + 7) % 7;
    if (diff === 0) diff = 7; // "last X" always means a previous occurrence, not today
    return addDaysISO(base, -diff);
  }

  // ---- Display formatting --------------------------------------------------

  // "YYYY-MM-DD" -> "DD/MM/YYYY"
  function formatDateDMY(iso) {
    if (!iso) return '';
    var parts = iso.split('-');
    if (parts.length !== 3) return iso;
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }

  // "DD/MM/YYYY" -> "YYYY-MM-DD" (best-effort; returns null if unparseable)
  function parseDMYToISO(dmy) {
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(dmy).trim());
    if (!m) return null;
    var day = parseInt(m[1], 10), month = parseInt(m[2], 10), year = parseInt(m[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return year + '-' + pad2(month) + '-' + pad2(day);
  }

  function isValidISODate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return false;
    var parts = iso.split('-').map(Number);
    var d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return d.getUTCFullYear() === parts[0] && (d.getUTCMonth() + 1) === parts[1] && d.getUTCDate() === parts[2];
  }

  // Is `iso` strictly after London-today? (used to reject future-dated entries)
  function isFutureISO(iso) {
    if (!isValidISODate(iso)) return false;
    return iso > todayISO();
  }

  // ---- HH:MM parsing & hours maths ----------------------------------------

  // Parses "H:MM", "HH:MM", "H.MM" style 24h strings into total minutes since
  // midnight (0-1439). Returns null if not parseable or out of range.
  function parseHHMMToMinutes(str) {
    if (str == null) return null;
    var s = String(str).trim();
    var m = /^([0-2]?\d)[:.]([0-5]\d)$/.exec(s);
    if (!m) return null;
    var h = parseInt(m[1], 10), mins = parseInt(m[2], 10);
    if (h > 23) return null;
    return h * 60 + mins;
  }

  function minutesToHHMM(totalMinutes) {
    var m = ((totalMinutes % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60), mm = m % 60;
    return pad2(h) + ':' + pad2(mm);
  }

  // Core rule: hoursWorked = (out - in - break) / 60, computed in JS, rounded
  // to 2dp. If out <= in, treat as an overnight shift (out happens next day),
  // i.e. add 24h (1440 min) to the out-minutes before subtracting.
  // Returns { hoursWorked, minutesWorked, overnight } or null if inputs
  // don't parse or the result would be non-positive after the break.
  function computeHoursWorked(clockIn, clockOut, breakMinutes) {
    var inMin = parseHHMMToMinutes(clockIn);
    var outMin = parseHHMMToMinutes(clockOut);
    var brk = Number(breakMinutes) || 0;
    if (inMin === null || outMin === null || brk < 0) return null;

    var overnight = outMin <= inMin;
    var rawOutMin = overnight ? outMin + 1440 : outMin;
    var workedMinutes = rawOutMin - inMin - brk;
    if (workedMinutes <= 0) return null;

    var hours = Math.round((workedMinutes / 60) * 100) / 100;
    return { hoursWorked: hours, minutesWorked: workedMinutes, overnight: overnight };
  }

  // Given the clock-in date + times, returns the ISO date the entry belongs
  // to. Per spec, overnight entries belong to the clock-in date, so this is
  // simply an identity helper today — kept as a named seam in case the rule
  // ever needs to change (e.g. a "belongs to clock-out date" toggle later).
  function entryDateForClockIn(clockInDateISO) {
    return clockInDateISO;
  }

  // Elapsed minutes between an ISO date + HH:MM clock-in and "now" (London),
  // for live-timer display on an open shift. Handles the shift having
  // started yesterday (or earlier, in the forgotten-clockout case).
  function elapsedMinutesSince(clockInDateISO, clockInHHMM) {
    var inMin = parseHHMMToMinutes(clockInHHMM);
    if (inMin === null || !isValidISODate(clockInDateISO)) return null;
    var todayP = londonParts(new Date());
    var todayIso = todayP.year + '-' + pad2(todayP.month) + '-' + pad2(todayP.day);
    var dayDiff = daysBetweenISO(clockInDateISO, todayIso);
    if (dayDiff < 0) return null; // clock-in is in the future somehow
    var nowMin = todayP.hour * 60 + todayP.minute;
    return dayDiff * 1440 + nowMin - inMin;
  }

  // Whole-day difference between two ISO dates (b - a), calendar-correct.
  function daysBetweenISO(aISO, bISO) {
    var a = aISO.split('-').map(Number);
    var b = bISO.split('-').map(Number);
    var da = Date.UTC(a[0], a[1] - 1, a[2]);
    var db = Date.UTC(b[0], b[1] - 1, b[2]);
    return Math.round((db - da) / 86400000);
  }

  function formatElapsed(totalMinutes) {
    if (totalMinutes == null || totalMinutes < 0) return '--:--';
    var h = Math.floor(totalMinutes / 60), m = totalMinutes % 60;
    return h + 'h ' + pad2(m) + 'm';
  }

  // ---- Week/month ranges, for the dashboard summary AND the Q&A context
  // (the same function feeds both, so their totals can never diverge). ----

  // Inclusive {start, end} ISO dates for the calendar week containing
  // `referenceISO`, per weekStartsOn ("Monday" or "Sunday").
  function weekRange(referenceISO, weekStartsOn) {
    var ref = referenceISO || todayISO();
    var refParts = ref.split('-').map(Number);
    var refDate = new Date(Date.UTC(refParts[0], refParts[1] - 1, refParts[2], 12, 0, 0));
    var weekday = refDate.getUTCDay(); // 0=Sun..6=Sat
    var startsOnSunday = (weekStartsOn === 'Sunday');
    var offsetFromStart = startsOnSunday ? weekday : (weekday + 6) % 7; // days since the week's start
    var start = addDaysISO(ref, -offsetFromStart);
    var end = addDaysISO(start, 6);
    return { start: start, end: end };
  }

  // Inclusive {start, end} ISO dates for the calendar month containing `referenceISO`.
  function monthRange(referenceISO) {
    var ref = referenceISO || todayISO();
    var parts = ref.split('-').map(Number);
    var start = parts[0] + '-' + pad2(parts[1]) + '-01';
    var lastDay = new Date(Date.UTC(parts[0], parts[1], 0)).getUTCDate(); // day 0 of next month = last day of this month
    var end = parts[0] + '-' + pad2(parts[1]) + '-' + pad2(lastDay);
    return { start: start, end: end };
  }

  // Is `iso` within the inclusive [start, end] range (plain string compare,
  // safe because ISO YYYY-MM-DD sorts lexicographically same as chronologically).
  function isDateInRange(iso, range) {
    return iso >= range.start && iso <= range.end;
  }

  BT.time = {
    LONDON_TZ: LONDON_TZ,
    londonParts: londonParts,
    todayISO: todayISO,
    nowHHMM: nowHHMM,
    addDaysISO: addDaysISO,
    yesterdayISO: yesterdayISO,
    lastWeekdayISO: lastWeekdayISO,
    formatDateDMY: formatDateDMY,
    parseDMYToISO: parseDMYToISO,
    isValidISODate: isValidISODate,
    isFutureISO: isFutureISO,
    parseHHMMToMinutes: parseHHMMToMinutes,
    minutesToHHMM: minutesToHHMM,
    computeHoursWorked: computeHoursWorked,
    entryDateForClockIn: entryDateForClockIn,
    elapsedMinutesSince: elapsedMinutesSince,
    daysBetweenISO: daysBetweenISO,
    formatElapsed: formatElapsed,
    weekRange: weekRange,
    monthRange: monthRange,
    isDateInRange: isDateInRange
  };
})(window.BT = window.BT || {});
