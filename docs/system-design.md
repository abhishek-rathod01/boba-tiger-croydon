# Boba Tiger Croydon — AI-Powered Hours Tracker
## System Design + Claude Design Execution Prompt

---

## 1. Overview

A single-page web app built in Claude Design (model: Claude Fable 5) for tracking staff hours at Boba Tiger, Croydon. Users are non-technical shop staff and a manager. The app is AI-assisted via the user's own free Groq API key, entered once on first launch.

Two ways to record hours (both supported):
1. **Clock in / clock out** — staff tap a button; timestamps are recorded automatically.
2. **Natural language entry** — the manager types things like *"Priya worked 11 to 7 today with a half hour break, and Sam did 4 hours in the evening"* and the AI converts it into structured entries for review before saving.

The AI also answers questions about the data (*"who worked the most this week?"*, *"total hours for Sam in June?"*).

All data lives locally in the browser (localStorage) with one-click Excel export and JSON backup/restore. No server, no accounts, nothing to maintain.

---

## 2. Requirements

### Functional
- FR1: First-run setup wizard: shop confirmation → Groq API key entry → key validation via a live test call → staff list setup.
- FR2: Clock in / clock out with big, obvious buttons per staff member; prevents double clock-in; handles forgotten clock-outs.
- FR3: Natural language hours entry → AI parses to structured JSON → **user reviews and confirms before anything is saved** (AI never writes directly to the database).
- FR4: AI Q&A over the hours data (data is summarised and sent as context with the question).
- FR5: Chat log: every AI conversation is stored with timestamps.
- FR6: Data log (audit trail): every create/edit/delete of an hours entry is recorded with who/what/when/before/after.
- FR7: Excel export: one button produces a real .xlsx (via SheetJS CDN) with three sheets — Hours, Summary by Staff, Audit Log. CSV fallback if the CDN is unreachable.
- FR8: Manual add/edit/delete of entries with simple forms (no AI required for basic operation — the app must be fully usable if the Groq key is missing or Groq is down).
- FR9: Weekly summary dashboard: hours per person this week, this month, currently clocked in.
- FR10: JSON backup export and import (restore).

### Non-functional
- NFR1: Zero technical knowledge required. No jargon anywhere in the UI. Errors in plain English with a suggested action ("The AI service didn't respond. Check your internet and try again — your data is safe.").
- NFR2: Works entirely client-side. Refresh-safe: all state persists in localStorage.
- NFR3: Timezone: Europe/London. All dates displayed as DD/MM/YYYY, times as 24-hour HH:MM.
- NFR4: Graceful degradation: every AI feature has a manual alternative.
- NFR5: Large touch targets (staff may use a phone or a till-side tablet), high-contrast text, minimum 16px fonts.
- NFR6: The Groq key is stored in localStorage on the device only. UI must include a note: "Your key is saved only on this device" and a "Change / remove key" option in Settings.

### Constraints
- Free Groq tier has rate limits (~30 requests/min class limits on most models); the app must debounce, queue, and show a friendly "one moment…" state rather than failing.
- Browser-side API calls: the key is visible on the device it's saved on. Acceptable for a single-shop internal tool; do not reuse a key you care about elsewhere.
- localStorage cap (~5MB) is far above what years of hours entries will need, but the app should still show a storage-used indicator in Settings.

---

## 3. High-Level Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Browser (SPA)                     │
│                                                      │
│  ┌────────────┐  ┌─────────────┐  ┌──────────────┐  │
│  │  UI Layer  │  │ App Logic   │  │ Storage Layer │  │
│  │ Dashboard  │──│ Validation  │──│ localStorage  │  │
│  │ Clock in/  │  │ Time maths  │  │ (single JSON  │  │
│  │ out, Chat, │  │ Audit hooks │  │  state object │  │
│  │ Settings   │  │ Export      │  │  + autosave)  │  │
│  └────────────┘  └──────┬──────┘  └──────────────┘  │
│                         │                            │
│                  ┌──────▼──────┐                     │
│                  │  AI Module  │                     │
│                  │ Groq client │                     │
│                  └──────┬──────┘                     │
└─────────────────────────┼────────────────────────────┘
                          │ HTTPS
                 ┌────────▼─────────┐
                 │ Groq API         │
                 │ /openai/v1/chat/ │
                 │ completions      │
                 └──────────────────┘
```

Data flow for NL entry: user text → Groq (JSON mode, strict schema) → parsed entries rendered as an editable review card → user taps Confirm → entries written to state → audit log appended → autosave.

Data flow for Q&A: user question → app builds a compact context (relevant date-range slice of entries, pre-aggregated totals) → Groq → answer shown in chat → chat log appended. Pre-aggregating in JavaScript matters: the AI should receive computed totals rather than being trusted to do arithmetic over raw rows.

---

## 4. Data Model (localStorage, one root object)

```json
{
  "version": 1,
  "settings": {
    "shopName": "Boba Tiger Croydon",
    "groqApiKey": "gsk_...",
    "model": "llama-3.3-70b-versatile",
    "weekStartsOn": "Monday"
  },
  "staff": [
    { "id": "s_001", "name": "Priya", "active": true, "hourlyRate": null }
  ],
  "entries": [
    {
      "id": "e_0001",
      "staffId": "s_001",
      "date": "2026-07-14",
      "clockIn": "11:00",
      "clockOut": "19:00",
      "breakMinutes": 30,
      "hoursWorked": 7.5,
      "source": "clock | ai | manual",
      "note": "",
      "status": "complete | open",
      "createdAt": "2026-07-14T11:00:12Z",
      "updatedAt": "2026-07-14T19:01:03Z"
    }
  ],
  "auditLog": [
    {
      "id": "a_0001",
      "timestamp": "2026-07-14T19:01:03Z",
      "action": "create | edit | delete",
      "entryId": "e_0001",
      "before": null,
      "after": { "...snapshot..." },
      "via": "clock | ai | manual"
    }
  ],
  "chatLog": [
    { "id": "c_0001", "timestamp": "...", "role": "user | assistant", "text": "..." }
  ]
}
```

Rules: `hoursWorked` is always recomputed by JavaScript from clockIn/clockOut/breakMinutes (never trusted from the AI); an "open" entry is a clock-in with no clock-out; a staff member can have at most one open entry.

---

## 5. AI Integration Detail (Groq)

**Endpoint:** `POST https://api.groq.com/openai/v1/chat/completions` (OpenAI-compatible)
**Auth:** `Authorization: Bearer <key>` — keys start with `gsk_`
**Default model:** `llama-3.3-70b-versatile`, with `llama-3.1-8b-instant` as automatic fallback if the primary model returns a "model not found / decommissioned" error. Model names change over time, so the Settings screen must include a model field pre-filled with the default, and the error handler must surface a plain-English message if a model is retired.

**NL entry parsing:** use `response_format: {"type": "json_object"}` with a system prompt that defines the exact schema, today's date, the Europe/London timezone, and the current staff list (so "Priya" maps to `s_001`, and unknown names trigger a "Did you mean… / Add new staff member?" prompt rather than a silent guess). Temperature 0. The response is validated in JavaScript (times parse, out > in, staff exists, date not in the future) before the review card is shown; anything invalid is shown to the user as a question, never auto-fixed silently.

**Key validation on setup:** send a 1-token test request; on 401 show "That key doesn't look right — check you copied the whole thing (it starts with gsk_)"; on network failure distinguish "no internet" from "key rejected".

**Rate limiting:** on HTTP 429, read `retry-after` if present, show "The AI is busy — retrying in X seconds", and retry once automatically. Never lose the user's typed text.

---

## 6. Key User Flows

**First run:** Welcome → "Paste your Groq API key" screen with a short illustrated explanation of where to get one (console.groq.com → API Keys → Create) and a "Skip for now — use without AI" option → add staff names → dashboard.

**Clock in/out:** Dashboard shows every active staff member as a large card. Tap → "Clock in Priya at 11:02? [Yes] [Pick a different time]". Clocked-in staff show a live timer and a Clock Out button. If someone is still clocked in after 14 hours, flag it on the dashboard: "Sam looks like they forgot to clock out yesterday — fix this entry?"

**NL entry:** Chat box on dashboard. User types; AI replies with a review card ("I understood: Priya, Mon 14 Jul, 11:00–19:00, 30 min break = 7.5 hrs. Save this?") with editable fields, Confirm and Discard. Multiple entries in one sentence produce multiple cards.

**Q&A:** Same chat box. App detects intent (Groq is asked to classify: `entry` vs `question` in the same JSON call) and routes accordingly.

**Export:** Big "Export to Excel" button on dashboard with a date-range picker defaulting to "this month". Generates `BobaTiger_Hours_2026-07.xlsx`.

---

## 7. Error Handling & Edge Cases (must all be handled)

1. No/invalid Groq key → all AI UI shows a gentle banner; manual features fully work.
2. Groq down / no internet → clock in/out and manual entry unaffected (they never touch the network).
3. AI returns malformed JSON → one silent retry with a "return only valid JSON" reinforcement; if it fails again, "I couldn't understand that — try rephrasing, or add the entry manually" + a shortcut to the manual form.
4. Overnight shifts (clock out past midnight) → supported; hours computed across the boundary, entry belongs to the clock-in date.
5. Overlapping entries for the same person → warn on confirm, allow override (manager knows best).
6. Duplicate NL entry (same person/date/times already saved) → warn before saving.
7. localStorage full or blocked (private browsing) → detect on launch, warn plainly, offer JSON download instead of autosave.
8. SheetJS CDN unreachable → fall back to CSV download with a note that it opens in Excel.
9. User clears browser data → mitigated by a monthly "Download a backup" reminder banner after 30 days without a backup.
10. Two devices used simultaneously → out of scope for v1; Settings must state "Use this on one device — data does not sync."

---

## 8. Trade-offs (explicit)

| Decision | Chose | Traded away | Why |
|---|---|---|---|
| Storage | localStorage | Multi-device sync, server backup | Zero setup for non-technical users; backup/export mitigates |
| AI calls | Browser → Groq direct | Key confidentiality on shared device | No server to run; single-shop internal tool; free tier key |
| AI writes | Review-before-save | One extra tap | Correctness over speed; payroll data must never be silently wrong |
| Hours maths | Computed in JS, never by the LLM | Slight duplication of logic | LLM arithmetic is unreliable; JS is deterministic |
| Export | SheetJS .xlsx + CSV fallback | Small CDN dependency | Manager asked for Excel specifically |

**Revisit as it grows:** multi-device → move to a hosted backend or a synced store; payroll rates → the `hourlyRate` field is already in the schema, unused in v1; multiple locations → add a `location` field to entries.

---

## 9. Pre-ship Test Checklist (Claude Design must verify every item before delivery)

- [ ] Fresh load → setup wizard appears; refresh mid-wizard → resumes correctly
- [ ] Skip-AI path: entire app usable with no key
- [ ] Invalid key → correct message; valid key → green confirmation
- [ ] Clock in, refresh page, clock out → duration correct
- [ ] Clock-out time before clock-in time → rejected with plain message
- [ ] Overnight shift 22:00–02:00 → 4.0 hours, correct date
- [ ] NL: "priya did 9 to 5 with an hour break yesterday" → correct card (8h − 1h = 7h, yesterday's date, DD/MM shown)
- [ ] NL with unknown name → "Add new staff?" prompt, no silent creation
- [ ] NL producing two entries in one message → two cards
- [ ] Q&A: "who worked most this week" → answer matches dashboard numbers exactly
- [ ] Edit an entry → audit log shows before/after
- [ ] Delete an entry → confirmation dialog, audit log records it
- [ ] Export .xlsx → opens in Excel, 3 sheets, dates as DD/MM/YYYY, totals correct
- [ ] Kill network → clock in/out still works; AI shows friendly offline message
- [ ] 429 simulation → retry message, user text preserved
- [ ] Backup export → clear storage → import → identical state

---
---

## 10. MASTER PROMPT — paste this into Claude Design

```
Build a complete, production-quality single-page web app: an hours tracker
for a sushi shop called "Boba Tiger Croydon". The users are completely
non-technical shop staff and one manager. Every label, message, and error
must be in plain everyday English — no technical jargon anywhere.

TOP PRIORITY: this must be bug-free and dead simple. Prefer fewer features
done perfectly over more features. All logic that involves money-adjacent
data (hours) must be deterministic JavaScript, never left to the AI.

== CORE FEATURES ==

1. FIRST-RUN SETUP WIZARD
   - Step 1: Welcome screen ("Boba Tiger Hours Tracker").
   - Step 2: Groq API key entry. Explain in 2 friendly sentences where to
     get a free key (console.groq.com → API Keys → Create API Key) and
     that it starts with "gsk_". Validate the key with a tiny live test
     call to Groq before continuing. Plain-English errors: wrong key vs
     no internet. Include a "Skip for now — use without AI" button; the
     whole app must work without AI.
   - Step 3: Add staff members (just names). Minimum one.
   - Wizard state survives a page refresh.

2. CLOCK IN / CLOCK OUT
   - Dashboard shows each active staff member as a large tappable card.
   - Tap to clock in (confirm dialog with editable time, defaulting to
     now, Europe/London). Clocked-in staff show a live elapsed timer and
     a Clock Out button.
   - A person can only have one open shift. Support overnight shifts
     (clock out after midnight → hours computed across the boundary,
     entry belongs to the clock-in date).
   - If a shift has been open more than 14 hours, show a dashboard
     warning: "X looks like they forgot to clock out — fix this entry?"

3. AI NATURAL-LANGUAGE ENTRY + Q&A (one chat box, Groq-powered)
   - Endpoint: POST https://api.groq.com/openai/v1/chat/completions
     Header: Authorization: Bearer <key from settings>
     Default model "llama-3.3-70b-versatile"; if the API returns a
     model-not-found/decommissioned error, automatically retry with
     "llama-3.1-8b-instant" and tell the user Settings has a model field
     they can update. Temperature 0. Use
     response_format {"type":"json_object"}.
   - Single classification+extraction call. System prompt must include:
     today's date, timezone Europe/London, the staff list with IDs, and
     a strict output schema:
     {"intent":"entry"|"question",
      "entries":[{"staffId","date","clockIn","clockOut","breakMinutes","note"}],
      "answerContext":"..."}
   - intent=entry → show each parsed entry as a REVIEW CARD with editable
     fields and Confirm / Discard buttons. NOTHING is saved until the
     user taps Confirm. Recompute hoursWorked in JavaScript from the
     times — never use an AI-computed number. Validate: times parse,
     out after in (or overnight), staff ID exists, date not in future.
     Unknown staff name → ask "Add [name] as a new staff member?" —
     never silently guess or create.
   - intent=question → make a SECOND call: send the question plus a
     compact context you compute in JavaScript (relevant entries for the
     date range mentioned, PLUS pre-computed totals per person per
     week/month). Instruct the model to answer only from that context.
     Display the answer in the chat.
   - Handle malformed JSON: retry once with a stricter reminder, then
     apologise and point to manual entry. Handle HTTP 429: show "The AI
     is busy — retrying shortly", retry once after the retry-after delay,
     never lose the user's typed text. Handle offline: friendly message,
     manual features unaffected.

4. MANUAL ENTRY / EDIT / DELETE
   - Simple form: staff dropdown, date picker, in/out times, break
     minutes, optional note. Same validation as AI entries.
   - Edit and delete from the entries list; delete needs a confirmation.

5. LOGS
   - Audit log: every create/edit/delete stores timestamp, action,
     before-snapshot, after-snapshot, and source (clock/ai/manual).
     Viewable in a "History" tab, read-only.
   - Chat log: every AI conversation stored with timestamps, viewable
     in the chat tab (scrollback), included in backups.

6. EXCEL EXPORT
   - Big "Export to Excel" button with a date-range picker (default:
     this month). Load SheetJS from the CDN
     (https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js)
     and generate a real .xlsx named like BobaTiger_Hours_2026-07.xlsx
     with three sheets: "Hours" (one row per entry: name, date DD/MM/YYYY,
     in, out, break, hours, source, note), "Summary" (total hours per
     person for the range), "Audit Log". If the CDN fails to load, fall
     back to downloading CSV files and tell the user they open in Excel.

7. BACKUP / RESTORE
   - Settings: "Download backup" (full JSON) and "Restore from backup"
     (file picker, with a confirm warning that it replaces current data).
   - If no backup has been taken for 30 days, show a gentle dashboard
     banner suggesting one.

8. SETTINGS
   - Change/remove Groq key (with the note "Your key is saved only on
     this device"), edit model name, manage staff (add/deactivate —
     never hard-delete staff who have entries), storage-used indicator,
     and the single-device disclaimer: "Use this on one device — data
     does not sync between devices."

== DATA & STATE ==
- Everything in ONE root object autosaved to localStorage on every
  change (key: "bobaTigerHours_v1"). Schema versioned ("version": 1).
- Dates stored ISO (YYYY-MM-DD), displayed DD/MM/YYYY; times 24h HH:MM;
  timezone Europe/London throughout.
- hoursWorked always = (out − in − break) computed in JS, rounded to 2dp.
- Detect localStorage unavailable/full on launch and warn plainly.

== UI REQUIREMENTS ==
- Warm, clean, friendly design suitable for a small food shop; large
  touch targets (min 44px), min 16px text, works on phone and tablet.
- Tabs: Dashboard (clock cards + chat box + weekly summary + export
  button), Entries (list/edit), History (audit log), Settings.
- Weekly summary on dashboard: hours per person this week and this
  month, and who is clocked in right now.
- Every destructive action has a confirmation. Every error message says
  what happened AND what to do next, in plain English.

== BEFORE YOU FINISH, SELF-TEST ALL OF THESE ==
1. Fresh load shows wizard; refresh mid-wizard resumes.
2. Skip-AI path: full app works with no key.
3. Overnight shift 22:00–02:00 = 4.0 hours on the clock-in date.
4. "priya did 9 to 5 with an hour break yesterday" → card shows 7.00
   hours and yesterday's date.
5. Unknown name in NL entry → add-staff prompt, nothing auto-saved.
6. Q&A totals exactly match dashboard totals.
7. Edit + delete both appear in the audit log with before/after.
8. Excel file opens with 3 sheets and correct totals.
9. Offline: clocking still works; AI fails politely.
10. Backup → wipe → restore → identical state.
Fix anything that fails before presenting the app.
```

---

## 11. Verification Notes (2-step check, as per your standing preference)

**Pass 1 — facts:** Groq's API is OpenAI-compatible at `api.groq.com/openai/v1/chat/completions` with Bearer auth and `gsk_` keys — verified against my knowledge of Groq's documented API. JSON mode via `response_format` is supported. `llama-3.3-70b-versatile` is Groq's flagship free-tier model as of my knowledge cutoff — **caveat:** Groq retires models over time, which is exactly why the design includes an editable model field and an automatic fallback rather than a hardcoded name. SheetJS CDN URL and browser localStorage limits (~5MB) verified as standard.

**Pass 2 — logic:** traced the two failure-prone paths. (a) Overnight shift: 22:00→02:00 = (24−22)+(2−0) = 4h, assigned to clock-in date — handled by the boundary rule in §7.4. (b) NL example: "9 to 5 with an hour break" = 8h − 1h = 7h — the checklist figure matches. Also confirmed the design never lets the LLM compute hours or write to storage directly; both were the biggest silent-corruption risks and both are structurally blocked.

**Honest uncertainty flag:** I can't guarantee current Groq free-tier rate limits or that CORS behaviour hasn't changed since my knowledge cutoff; the design degrades gracefully in both cases (429 handling, offline handling, skip-AI mode), so neither can brick the app for your staff.
