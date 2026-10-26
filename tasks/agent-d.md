task-id: D-2026-10-26-01
status: ready
---
Thanks for D-2026-10-25-17 (audit-review-breakglass, 9ac3880).

Next: fix C's review of it (origin/review-high-risk, docs/qa/review-2026-10-25-high-risk.md section 7, D1-D6). Read it first.
`git checkout audit-review-breakglass && git pull && git merge origin/phi-access-log-coverage` (C's PHI logging; D2 and D4 only bite after it, and phi-access.ts is edited by both, so resolve it here once).
1. D1 Medium: outside-hours by the clinic's time zone (derive from the clinic's state if no zone column exists; say how multi-zone states are handled), not UTC.
2. D2 High: exclude list-view resources from the bulk-patients flag (or count distinct patients per actor per hour from non-list reads only); read newest first; skip patient and system actors for the deactivated-user flag; treat lookup errors as unknown, not flagged.
3. D3 Low: mark a truncated CSV (last line or header note) and show it on the page.
4. D4 Medium: CSV export fails closed (503) when its log write fails; same for the emergency reason row.
5. D5 Low: a PHI-free Slack alert whenever an emergency reason is used.
6. D6 Low: no change; note it.
Tests: jest for each.
Gates: lint (0 warnings), tsc, jest, next build. Push audit-review-breakglass (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
