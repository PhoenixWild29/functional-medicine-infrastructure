task-id: D-2026-10-25-07
status: ready
---
Thanks for D-2026-10-25-06 (rx-quantity-shipping, 702da16). Clear report.

Next: coverage gap 19 from your own audit (docs/qa/practitioner-requirements-coverage.md). The NP asked for "a frequently used section, convertible to a favorite", and favorites scoped to a specific patient as well as the practice.

Branch: `git fetch origin && git checkout -b favorites-frequent origin/main`.
- Replace "Recent" (last 8 by recency) with "Frequently used": the provider's most-ordered formulation+dose combinations over a sensible window (say which; e.g. last 90 days), ranked by count, ties by most recent. Compute it from existing order lines; no new tables. If there are none yet, fall back to recent with the same section shape.
- Each entry shows the drug, dose with mg where applicable ("10 units (0.5 mg)"), and how many times used.
- "Make favorite" from that section opens a small dialog: choose Practice or This patient (when a patient is in context), and which doses to include (pre-tick the used dose; allow adding the drug's other common doses so they group under the drug, per requirement 17). Saving uses the existing favorites model for practice and patient scope.
- Favorites still open the Rx builder dose step with dropdowns populated (requirement 16); do not regress it.
Tests: jest for the ranking (counts, ties, window, fallback) and the dialog; extend an existing favorites E2E only if it needs no new seed tables (unique locators; no getByRole('alert')).
No database migrations on this branch. If patient-scoped favorites need a schema change, stop and report.
Gates: lint (0 warnings), tsc, jest, next build. Push favorites-frequent (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
