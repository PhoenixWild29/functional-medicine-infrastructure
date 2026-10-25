task-id: D-2026-10-25-17
status: ready
---
Thanks for D-2026-10-25-16 (password-flows, 69e60cf).

Next: gaps B16 and B13 from C's HIPAA evidence map (origin/review-high-risk, docs/compliance/technical-safeguards-evidence-2026-10-25.md). Read them first.

Branch: `git fetch origin && git checkout -b audit-review-breakglass origin/bundle-features`.
1. B16: audit-log review.
   - Ops page /ops/access-review (ops_admin only): phi_access_log filtered by date range, clinic, actor, actor role, resource type and action; flags for review: access outside 6am-10pm clinic local time (use UTC if no clinic timezone exists, say so), one actor viewing more than N distinct patients in an hour (N=30, a constant), access by deactivated users, access to a patient with no order or proposal in that clinic. Export CSV (ops only, the export itself is logged).
   - "Mark reviewed" per period: if an existing table can record review sign-off, use it; otherwise do NOT migrate, show the page without sign-off and report the design.
   - docs/compliance/audit-log-review-procedure.md: who reviews, how often (weekly), what to look at, what to do on a finding, retention of evidence.
2. B13: emergency access (break-glass).
   - docs/compliance/emergency-access-procedure.md: who may invoke it, how (a named ops_admin account with MFA, sealed credentials held by Sam), what is logged, post-event review within 24 hours.
   - Code: if an ops "break-glass" read path is needed beyond ops_admin's existing access, do NOT build new privilege; instead require a reason text on any ops view of a patient record outside the normal ops screens and log it with the access. If ops already sees everything it needs, just add the reason prompt where ops opens patient-level detail, and log reason.
No database migrations (report designs instead).
Tests: jest for the filters and flags, the role gate, the CSV export logging, and the reason prompt.
Gates: lint (0 warnings), tsc, jest, next build. Push audit-review-breakglass (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
