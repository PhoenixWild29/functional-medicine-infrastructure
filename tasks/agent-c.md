task-id: C-2026-10-25-07
status: ready
---
Thanks for C-2026-10-25-06 (api-input-validation, 26f1c9a). Your recommendations are approved; build them.

Branch: `git fetch origin && git checkout -b security-followups-3 origin/api-input-validation` (it builds on your validation work; keep the two branches mergeable in order).
1. patient-phases POST: record advanced_by from the signed-in provider, never from the body. Reject a body provider_id that differs from the caller (or ignore it; say which and why).
2. POST /api/epcs: verify patient_id and order_id belong to the caller's clinic (one scoped read each) before writing the audit row; 404 otherwise.
3. One constant-time compare helper (crypto.timingSafeEqual on equal-length buffers, false on length mismatch) used for every internal-token and cron-secret comparison: lib/cron/auth.ts, adapters route-order and submit, spec/v1/webhooks/register, and any others you find.
4. Add refuseCrossSite to the ops write routes that lack it: adapters action, catalog/item, catalog/rollback, catalog/sync, ingredients compounding, payables/mark, sla/acknowledge, onboarding/invites/[inviteId], plus any other state-changing route you find without it (list them).
5. Routes that check clinic_id only: add an explicit app_role gate matching who uses them today (no behaviour change for current users).
6. TIER_3_HYBRID: the adapter is not built. Make the tier unselectable in ops pharmacy setup (shown disabled with "Not available yet"), and keep the submit API's 501 as a backstop. Do not change existing pharmacy rows.
Tests: jest for each item (wrong provider id, other clinic's ids, compare helper incl. length mismatch, cross-site refusal, role gate, tier disabled).
No database migrations on this branch.
Gates: lint (0 warnings), tsc, jest, next build. Push security-followups-3 (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
