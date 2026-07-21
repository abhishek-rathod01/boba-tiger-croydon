# UI Integration Plan — design_handoff → working app

Source design: `Boba Tiger Hours Tracker/design_handoff_hours_tracker/` (README.md + `Boba Tiger Hours Tracker.dc.html`, prototype only — not shipped).
Target: `boba-tiger-hours-tracker/src/` — vanilla JS, no build step, no framework. `index.html` is a static shell; `app.js` renders everything else via `innerHTML` template strings bound to fixed DOM ids/classes; `styles.css` is the design system; `state.js`/`time.js`/`names.js`/`ai.js`/`export.js` are pure logic with **zero UI** — none of these five files are touched by this integration.

## Approach

This is a restyle-in-place, not a rewrite:
1. `styles.css` — replace design tokens (`:root` custom properties) with the handoff's palette/type/spacing/radius/shadow values; keep the existing dark-mode mechanism (`@media prefers-color-scheme` + `[data-theme]` overrides), mapping sensible dark equivalents since the handoff is light-only.
2. `index.html` — restructure the static shell (header, tabs, section containers) to match the design's visual language, without renaming/removing any id or class that `app.js` queries.
3. `app.js` — rewrite the `innerHTML` templates inside each `render*` function to match the design's markup/visual structure, keeping every function signature, every id/class the template *emits* that other code depends on (data-* attributes, listener targets), and all validation/audit/state-mutation logic untouched.

## Selector contract (must not break)

Grepped every `$('#...')` / `$all('.…')` / dynamically-assigned class in `app.js`. Static ids that must keep existing in `index.html` after restyle: `#banners #toasts #nowWorkingBody #clockGrid #wizardOverlay #wizardCard #chatLog #reviewCards #chatForm #chatInput #chatSend #chatHint #manualFormSection #entriesTableBody #auditTableBody #chatHistoryLog #summarySection #exportSection #keySettingsSection #staffSettingsSection #backupSettingsSection #storageSettingsSection`. Dynamic classes assigned by JS that CSS must style: `.bt-tab[data-tab]`, `.bt-panel[data-panel][data-active]`, `.bt-clock-btn[data-staff]`, `.bt-entry-edit/.bt-entry-delete/.bt-staff-toggle`, `.rc-staff/.rc-date/.rc-in/.rc-out/.rc-break/.rc-note/.rc-hours/.rc-confirm/.rc-discard` (review card, scoped to its own element), `.bt-msg--user/--assistant`, `.bt-banner--warning/--danger/--info`, `.bt-toast--success/--danger`, `.wizard-remove-staff`, `.bt-fix-forgotten[data-entry]`. Any screen edit that touches one of these re-verifies the JS listener still binds (checked live in Chrome, not just read).

## Screen-by-screen mapping

### Shared tokens (done once, folded into the Dashboard commit)
- Colors, Baloo 2 (display/headings/numbers) + Nunito (body) fonts, 42px/26px/16-20px radii, card/button shadows, `bt-pulse` keyframe → into `:root` and base element rules.
- Fonts loaded via Google Fonts `<link>` in `index.html` `<head>`, same as the handoff — **not** a functional dependency (unlike the SheetJS export CDN): if unreachable, `font-family` falls back to the existing system stack, so this does not weaken the "must survive offline" property anything else in the app relies on.

### 1. Dashboard → `index.html` dashboard `<section>` + `renderNowWorking`, `renderClockGrid`, `renderChatBox`/`renderChatAvailability`, `renderSummary`, `renderExportSection` in `app.js`
- App header, "who's in" green gradient strip (feeds off `#nowWorkingBody`, empty state restyled calm/neutral rather than green), staff clock cards (clocked-in = full-width green-bordered card + pill; clocked-out = half-width warm card + full-width button), weekly/monthly summary rows, chat box, Export button — all restyled, all existing click handlers/ids preserved.
- Avatar tint: design hardcodes 4 person-specific tints (green/purple/amber/blue). Generalized as a 4-color palette cycled by staff list index (deterministic per person, not random per render).

### 2. AI Review Card → `renderReviewCard` in `app.js`
- Restyled to the floating white card, quoted-original box, labelled rows, gradient total panel, green "Looks good" / ghost "Discard" actions.
- **Decision (see decisions.md):** design shows read-only rows with a ✎ that (implicitly) toggles inline edit. Kept fields as always-editable inputs (current, tested behavior) styled to look like the label+value+pencil row, instead of building a new tap-to-reveal-edit interaction. Same recompute-on-change logic, same Confirm/Discard, nothing new to test-break.

### 3. Entries / History → `index.html` entries `<section>` + `renderEntries`/`renderManualForm` in `app.js`
- Design's screen 3 is the entries list: day-grouped, source-tag chips (Clock/AI/Manual), legend, live/hours-total right-aligned, ⋯ opens edit/delete (existing `openEditEntryModal`/`confirmDeleteEntry`, now via one overflow control instead of two buttons).
- **Decision:** manual add-entry form (FR8, required for the no-AI-key path) has no home in the design's mock — kept as a collapsible/section card above the day-grouped list rather than dropped.
- **Decision:** app's separate "History" tab (audit log + chat log, FR6) has no equivalent screen in the design at all — kept as its own tab, restyled with the shared tokens/table look, not redesigned from scratch.

### 4. Settings → `index.html` settings `<section>` + `renderKeySettings`, `renderStaffSettings`, `renderBackupSettings`, `renderStorageSettings` in `app.js`
- AI features card (calm "resting" banner, key field, reassurance line, button), Team card (avatar+name+red ✕ rows, add button), Backup card (last-backup line, back-up/restore buttons).
- **Decision:** NFR6 storage-used indicator has no card in the design — kept as a small card in the same visual language, appended after Backup rather than invented a 4th design section from nothing.

### Wizard (first-run) — not a design screen at all
- **Decision:** design has no setup-wizard screens; FR1 requires one. Restyled the existing wizard overlay/card with the new tokens (warm palette, Baloo 2 headings) for visual consistency but did not redesign its 3-step structure, since inventing new wizard screens is outside "integrate the design" and highest-risk to the one flow every new install depends on.

## Test strategy

Chrome-driven click-through per screen against the restyled `index.html` (via a local static server, not bare `file://`, to sidestep any fetch/module quirks) covering the deterministic paths the restyle actually touches: clock in/refresh/out, manual add/edit/delete + audit log, week/month summary math, export (xlsx if CDN reachable, else CSV fallback), backup → wipe → restore, wizard resume after refresh, tab switching, responsive width. AI-dependent checklist items (NL parsing, Q&A, key validation) **cannot** be run — no Groq key is available and touching credentials is out of scope per operating rules — logged in `docs/ui-integration-test-log.md` as "not run — requires live API key; parsing/validation logic untouched by this UI-only change" rather than marked pass.

## Commit plan
One commit per screen once its edits + relevant checklist/edge-case items are logged: tokens+Dashboard, AI Review Card, Entries/History, Settings, wizard restyle, then a final full-pass commit after the whole-app re-test.
