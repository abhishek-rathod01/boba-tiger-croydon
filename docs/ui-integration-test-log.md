# UI Integration — Test Log

Pass/fail results logged as each screen is restyled. AI-dependent items (require a live Groq key, which this session must not touch) are logged as **NOT RUN** with a reason, never marked pass. Legend: ✅ pass · ❌ fail (fixed before commit, see note) · ⏭️ not run.

---

## Screen 1 — Dashboard (tokens + shared design system)

Method: served `src/` via a local static HTTP server, driven with a headless Chrome instance over the DevTools Protocol (real navigation, clicks, and typed input — not just static rendering) since the Claude-in-Chrome extension bridge was unavailable in this environment. Both light (`data-theme="light"` override) and dark (default OS-scheme) palettes were screenshotted.

- ✅ Fresh load shows the setup wizard (§9 item 1)
- ✅ Wizard: welcome → skip-AI-key → add staff → resumes correctly after a full page refresh mid-wizard (§9 item 1) — confirms wizard state persistence still works after the restyle
- ✅ Skip-AI path: wizard completes and the full dashboard renders with no key set (§9 item 2)
- ✅ Tab switching (Dashboard/Entries/History/Settings) via the restyled tab bar
- ✅ Dashboard settings-gear icon jumps to the Settings tab (new, additive control)
- ✅ Clock in via the custom modal (not native `confirm()`) — "who's in" strip and clock card update live, avatar tint consistent between the strip/card/summary for the same person
- ✅ Clock out via the custom modal — hours computed correctly (same-minute in/out correctly treated as an overnight 24h shift per existing `computeHoursWorked` rule — pre-existing logic, unchanged, verified still wired correctly) and a toast confirms
- ✅ Weekly/monthly summary rows render correct per-person totals from seeded entries (cross-checked against `computeTotals` output)
- ✅ Chat hint text correctly reflects no-AI-key state ("Add a free AI key in Settings…")
- ✅ Chat suggestion chips fill the input without auto-submitting
- ✅ Export section date pickers + button render (button click itself not exercised here — no functional change to export logic, exercised in the full-pass re-test)
- ✅ No horizontal page overflow at 375px viewport width (`scrollWidth === clientWidth`, confirmed via CDP, not just visual inspection) — tabs bar and entries table use their existing intentional internal `overflow-x` scroll, unchanged from before the restyle
- ✅ No console errors/exceptions during the full click-through
- ❌→fixed: initial `index.html` edit removed `#entriesTableBody` (Entries tab) while `app.js`'s `renderEntries()` still targeted it — threw inside the synchronous `render()` pipeline and silently prevented Summary/Export/Chat from ever rendering. Caught via screenshot showing empty Summary/Export sections, root-caused via Chrome's console log capture. Fixed by reverting the Entries section markup to its original (pre-restyle) structure — that screen is done properly in its own pass (Screen 3), not smuggled into this commit.
- ⏭️ NOT RUN: anything requiring a live Groq key (NL entry parsing, Q&A, key validation) — no key available in this session, and touching credentials is out of scope; parsing/validation logic itself is untouched by this UI-only change.

## Screen 2 — AI Review Card

Method: same headless-Chrome/CDP click-through. Since exercising this screen normally requires a live Groq response and no key is available (see plan), `window.fetch` was mocked in the page to return a canned Groq-shaped JSON response — this exercises the real `ai.js` → `app.js` code path (classify/extract parsing, name resolution, validation, review-card render, confirm/discard, audit log) with zero real network calls and no credential involved. This does **not** substitute for testing the model's own NL-parsing quality (§9 items 7-9), which remains NOT RUN.

- ✅ Review card renders on a successful "entry" classification: header (badge/title/subcopy), quoted original text, Who/Date/Clocked in/Clocked out/Break/Note rows, total panel, actions — matches design layout (see docs/ui-integration-decisions.md D3 for the always-editable-fields decision)
- ✅ Editing a field (clock-out time) live-recomputes the displayed total (8.50h after changing 17:00→18:00), same as before the restyle
- ✅ Confirm ("Looks good — save it ✓") saves the entry (`source: 'ai'`), appends an audit log row, and removes the card — verified via `BT.state.get().entries.length` / `.auditLog.length`, not just visually
- ✅ Discard removes the card without saving (`entries.length` stays 0) and posts "Discarded — nothing saved." to the chat log
- ✅ Ambiguous-name clarify flow ("Did you mean X or Y?") still triggers correctly when two staff names are close matches — found incidentally when a test fixture had a duplicate name, confirms `names.js` fuzzy-matching is wired through the new UI unchanged
- ✅ No console errors during the classify → review → confirm/discard cycle
- ✅ Dark-mode palette checked (post-discard state; card itself confirmed in light mode — same CSS variables/classes drive both, no per-theme markup divergence)
- ⏭️ NOT RUN: real Groq NL-parsing accuracy, unknown-name "add new staff?" prompt end-to-end with a real model, Q&A answer accuracy — all require a live key, which this session must not touch. The deterministic JS this screen depends on (`validateEntryFields`, `matchStaffName`, `computeHoursWorked`) is unmodified and was exercised above via the mocked path.

## Screen 3 — Entries / History

Method: headless-Chrome/CDP click-through against seeded entries (open + completed, clock/ai sources, spanning today/yesterday).

- ✅ Entries render grouped by day, most-recent day first, with the design's "TODAY · TUE 21 JUL" / "YESTERDAY · MON 20 JUL" headers
- ✅ Source-tag icon (⏱/✨/✎) shown per row next to the name, legend at the top matches
- ✅ Open (still-clocked-in) entries show "live" instead of an hours total, no misleading number
- ✅ Completed entries show an "Hh MMm" duration (e.g. "4h 58m") derived via the same `computeHoursWorked` used for storage — not a separate/divergent calculation
- ✅ ⋯ overflow opens an Edit/Delete choice modal (design: "History ⋯ opens edit/delete"); Edit opens the existing field-editing modal, saves correctly, and appends an audit-log row with before/after — verified via `BT.state.get().auditLog.length`, not just visually
- ✅ Delete opens the existing confirm-with-warning modal, removes the entry, and appends its own audit-log row
- ✅ Manual add-entry form (kept per docs/ui-integration-decisions.md D5) opens via the "+ Add an entry by hand" disclosure and is unaffected — same `renderManualForm()`/`#manualFormSection` as before
- ✅ History tab (audit log + chat log, kept per D4) still renders correctly under the shared tokens — table, banners, and empty-state ("No conversations yet.") all display properly, no console errors
- ✅ No console errors across the full edit/delete/day-grouping cycle

## Screen 4 — Settings

_pending_

## Wizard restyle

_pending_

## Final full-pass re-test

_pending_
