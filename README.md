# Boba Tiger Croydon — Hours Tracker

An AI-powered staff hours tracker for Boba Tiger, Croydon. Built as a single-page
web app for non-technical staff, using Groq (free-tier LLM API) for natural
language time entry and Q&A over the hours data.

## Status
🚧 In development — built via Claude Design (model: Claude Fable 5).

## Features
- Clock in / clock out per staff member (handles overnight shifts)
- Natural language entry: type things like *"Priya worked 11 to 7 with a half
  hour break"* and the AI turns it into a reviewable entry — nothing saves
  without confirmation
- AI Q&A over hours data ("who worked the most this week?")
- Full audit log (every create/edit/delete) and chat log
- Excel export (.xlsx) with Hours / Summary / Audit sheets
- JSON backup & restore
- Works fully offline / without an AI key — AI is an enhancement, not a dependency

## Tech
- Single-page app, client-side only, no backend
- Data stored in browser `localStorage`
- AI: [Groq API](https://console.groq.com) (OpenAI-compatible endpoint),
  user supplies their own free API key on first run
- Excel export via [SheetJS](https://sheetjs.com)

## Project structure
```
docs/     — system design doc + the master build prompt used in Claude Design
src/      — the app source (HTML/JS or React, whatever Claude Design exports)
exports/  — sample .xlsx / .json exports for reference (no real staff data)
```

## Setup
1. Open the app in a browser.
2. Enter a free Groq API key (get one at console.groq.com → API Keys), or
   skip and use the app without AI features.
3. Add staff names.
4. Start clocking in/out or typing entries in plain English.

Your Groq key is stored only in your browser on this device — it is never
sent anywhere except directly to Groq's API.

## Design docs
See [`docs/system-design.md`](docs/system-design.md) for the full architecture,
data model, edge cases, and the exact prompt used to generate the app.

## License
MIT — see [LICENSE](LICENSE).
