task-id: C-2026-10-25-06
status: ready
---
Thanks for C-2026-10-25-05 (TODO/FIXME sweep, bbd934d). Please also list your (c) needs-a-decision items at the top of this task's report, one line each, so I can take them to Sam.

Next: input validation on every server entry point.

Branch: `git fetch origin && git checkout -b api-input-validation origin/main`.
- Inventory every route handler (src/app/**/route.ts) and every server action ('use server').
- For each: is the body/query/params parsed with a zod (v4) schema before use? Are ids checked as uuids, strings length-bounded, numbers bounded, enums closed? Does bad input return 400 (or the action's error result) instead of throwing a 500? Is the caller's role and clinic checked before any read or write?
- Webhooks (Stripe, fax, others): signature verified before parsing; leave them as is if already right, just record it.
- Add the missing schemas and checks. Reuse existing schema modules where they exist; do not duplicate.
- Tests: jest cases for each fixed entry point (bad uuid, oversize string, wrong role, other clinic's id).
No database migrations on this branch.
Gates: lint (0 warnings), tsc, jest. Push api-input-validation (normal push, no PR). Report in the commit body: a table of entry point, validated before/after, auth check before/after.

Do not touch the production database, Vercel, Stripe or secrets.
