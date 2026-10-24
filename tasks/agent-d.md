task-id: D-2026-10-24-06
status: ready
---
Thanks for D-2026-10-24-05. C1 is the most important find today. Its migration goes to Sam first. H1 waits for Sam's decision (he decided on Oct 23 that new clinics order right after approval using the demo payout account, and prod Stripe keys are live; your H1 fix turns that off). Do NOT change H1 further.

Four parts, in order. Push each branch when its part is done.

PART 1. Unblock PR #259 (B's ops-pipeline-tier-filter). It conflicts with main (#257 added an sr-only h1 to the ops pipeline page and made the ops layout wrapper the single <main>; B rewrote pipeline page.tsx and pipeline-view.tsx). `git fetch origin && git checkout -B ops-pipeline-tier-filter origin/ops-pipeline-tier-filter && git merge origin/main`. Resolve keeping both: B's filters (URL, SQL tier filter, chips) and C's landmarks (the sr-only h1 "Pipeline" before the page root, no <main> in the page). Run `npm run lint` (0 warnings), tsc, the pipeline tests (B's 3 suites), C's landmarks-static-guard test, build. Push ops-pipeline-tier-filter (normal push). Report in the merge commit body.

PART 2. Migration numbering. Three branches now use 20261024 timestamps: yours 20261024000001_rls_hardening (security-review-oct24), C's 20261024000002_treatment_proposals (proposals-pr1-data-model), A's 20261024000001_phi_access_log_fax_id (ops-fax-viewer-documo). Two are 000001. Final order: rls_hardening 20261024000001 (first, critical), treatment_proposals 20261024000002, phi_access_log_fax_id becomes 20261024000003. On ops-fax-viewer-documo: `git checkout -B ops-fax-viewer-documo origin/ops-fax-viewer-documo`, git mv the migration and its down file to 20261024000003, update every test or comment that names the old file (A's fax-pdf-migration-and-viewer-wiring test), `git merge origin/main`, lint 0 warnings, tsc, fax tests, push ops-fax-viewer-documo. Report the new file names in the commit body.

PART 3. On security-review-oct24: `git merge origin/main`, lint/tsc/Jest, push. No other change.

PART 4. Your low-risk recommendations, new branch `git checkout -b security-followups-oct24 origin/main`, red tests first for each:
- M1 remainder: GET /api/protocols (protocols/route.ts:52, 94, 135, 136, 160, 234) returns no raw DB text; log it, answer a plain message.
- L6: one shared helper that refuses anything but Sec-Fetch-Site same-origin or none (or a missing header), used by every write route you listed as F(L6). Keep the existing 403 wording.
- L9: pharmacy license document type by magic bytes (reuse face-sheet's sniff()).
- L10: failure-reason returns only known codes (unknown -> null code, generic reason).
- L11: the 409 POSSIBLE_DUPLICATE path writes phi_access_log rows (logPhiAccessMany) for the patients it reveals.
- L13: protocol create: created_by derived from the caller when the caller is a provider; an MA may not attribute to another provider (403). Clinic admin unchanged.
- L14: ops catalog upload enforces MAX_CATALOG_ROWS server-side.
Do NOT do in this branch: L5 policy drops, L7 shared rate-limit store, L8, L12, M2, M3, zod 4, instrumentation.ts (server-side Sentry stays off by Sam's Oct 6 decision until a Sentry BAA). List them as still open.
`npm run lint` (0 warnings), tsc, Jest, build. Push security-followups-oct24 (normal push, no PR). Full report in the final commit body.

Do not touch the production database, Vercel, Stripe or secrets.
