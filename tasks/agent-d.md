task-id: D-2026-10-25-14
status: ready
---
Thanks for D-2026-10-25-13 (clinical-difference-saved, 3bd6713, migration 000009 prepared). Noted; it merges after perf-indexes.

Next: in-app Help for clinic staff, so a pilot clinic can answer its own "how do I" questions.

First check whether any help page, help links or tooltips exist today (search for "help", "Help", "/help", "support"); build on them.
Branch: `git fetch origin && git checkout -b clinic-help origin/bundle-features` (so it describes the finished features; it merges after bundle-features).
- Add /help in the clinic app (all clinic roles), linked from the sidebar/user menu, with short task pages written for clinic staff, plain language, exact button labels from the code:
  1. Add a patient (mobile link, sign-up QR, spreadsheet upload, face sheet when available).
  2. Write and sign a prescription (every field the pharmacy needs, allergies/NKDA, Sign all).
  3. Favorites and Frequently used.
  4. Saved clinical difference statements (only if clinical-difference-saved has merged into your base; otherwise leave it out and say so).
  5. Send a treatment plan for the patient to choose, and sign the chosen lines.
  6. Payment links: what the patient sees, expiry, resending.
  7. Order status and what each status means; what to do when an order shows a failure reason.
  8. Team: add a provider, invite an MA or admin, turn access off.
  9. Settings: practice details, Notifications (what is sent), access log, agreements.
  10. Who to contact for help (use the support contact already in the code or env; if none exists, say "Contact CompoundIQ" with no address and list it in the report as a decision for Sam).
- Content lives in code (MDX or TSX, matching the repo's conventions). No external links, no screenshots needed. Accessible headings, works at phone width.
- A small "Help" link on the Rx builder and the plan page header pointing to the relevant section.
Tests: jest that every help page renders and every label it names exists in the component it describes (a simple string check against the source is fine); axe in an existing E2E if cheap.
No database migrations.
Gates: lint (0 warnings), tsc, jest, next build. Push clinic-help (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
