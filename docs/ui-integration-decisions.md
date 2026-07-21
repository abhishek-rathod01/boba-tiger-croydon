# UI Integration — Decisions Log

Each entry: the fork, the two reasonable readings, what was picked, and why. Rule applied throughout: preserve existing tested functionality, prefer the easiest-to-reverse option.

---

### D1 — Google Fonts (Baloo 2 / Nunito) vs. the existing no-CDN-font rule
`styles.css` had an explicit comment: "No web-font CDN (must survive offline / file://) — system rounded font stack instead." The design specifies Baloo 2 + Nunito from Google Fonts.
**Picked:** add the Google Fonts `<link>` (matches the SheetJS pattern already in the app: progressive enhancement, not a hard dependency). If unreachable, `font-family` falls through to the existing system-rounded stack (`ui-rounded, "Segoe UI Variable", …`), which is still in the stack as the fallback. Unlike SheetJS (an actual functional dependency with branching fallback code), a missing font is a silent, harmless degrade — no logic depends on which font renders. Reversible by deleting one `<link>` tag.

### D2 — No wizard screen in the design
The design's README explicitly lists four screens; there is no first-run setup wizard. FR1 (welcome → key → staff wizard, resumable on refresh) is a hard functional requirement.
**Picked:** kept the existing wizard flow and its 3 steps unchanged structurally; restyled its overlay/card with the new tokens (palette, Baloo 2 headings, button styles) for visual consistency with the rest of the app. Did not invent new wizard screens — that would be designing beyond the handoff, not integrating it.

### D3 — AI Review Card "tap ✎ to edit" interaction
The design shows each field as a read-only label + value + pencil icon, implying tap-to-reveal-edit. The existing, tested implementation shows all fields as always-editable inputs with live recompute on every keystroke/change.
**Picked:** kept fields always-editable (current behavior), styled to visually match the design's label/value row (caps label, big value, pencil glyph as a static affordance rather than a toggle control). Building a new tap-to-edit state machine would be new, untested interaction surface for zero functional gain — "tap anything to fix it" is still true, just without an extra tap to enter edit mode.

### D4 — Design screen 3 ("Entries / History") vs. the app's two separate tabs
The design's "Entries / History" screen is actually just a day-grouped, source-tagged **entries list** (with a month filter) — it does not depict an audit trail or chat log view at all. The app has a separate "History" tab that is specifically the audit log (FR6) + chat log (FR5), which is a distinct, required feature with no equivalent design screen.
**Picked:** mapped design screen 3 onto the app's existing "Entries" tab (restyled: day groups, source-tag legend/chips, ⋯ overflow for edit/delete). Left the "History" tab (audit log + chat log) in place as its own tab, restyled with the shared design tokens but not redesigned from scratch, since dropping or hiding it would remove FR6/FR5 visibility with no design guidance on where it should live instead.

### D5 — Manual add-entry form has no home in the design mock
FR8 requires the app work fully with no AI key, which depends on the manual entry form. The design's Entries screen shows only the list + legend + filter, no add-entry form.
**Picked:** kept the manual entry form as a card at the top of the restyled Entries tab (in the shared visual language), rather than dropping it or inventing a separate design screen for it.

### D6 — Storage-used indicator (NFR6) has no card in the design's Settings screen
The design's Settings has exactly 3 white cards: AI features, The team, Keep your data safe. NFR6 requires a storage-used indicator.
**Picked:** added a small 4th card in the same visual language directly below "Keep your data safe," rather than cramming it into the backup card (different concern) or dropping it (violates NFR6).

### D7 — Avatar tint colors are per-name in the mock, not systematic
The design hardcodes specific tints to specific mock names (Maya=green, Elijah=purple, Priya=amber, Sam=blue) — there's no rule given for a 5th+ person or for real staff names that don't match the mock.
**Picked:** built a 4-tint palette (the same 4 hue pairs from the mock) cycled deterministically by each staff member's position in the staff list (stable per person across renders, not random), rather than guessing a naming-based rule that doesn't generalize.
