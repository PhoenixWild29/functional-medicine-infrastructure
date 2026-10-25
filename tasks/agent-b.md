task-id: B-2026-10-25-08
status: ready
---
Thanks for B-2026-10-25-07 (settings-notifications, c1d9e76).

Next: C's independent review (origin/review-high-risk, docs/qa/review-2026-10-25-high-risk.md) found your state-machine-enforcement branch mergeable with two lows and one pre-merge check. Fix them.

Branch: `git checkout state-machine-enforcement && git pull`.
1. The DRAFT->CANCELLED writers in proposals (expire, propose, sign-choice) bypass casTransition. Route them through casTransition with the right actorRole (system for the expiry cron, the caller's role otherwise), keeping their batch semantics and tests.
2. The refused-then-reread race in cas-transition.ts (~162-214): if the re-read finds the order still in the expected status with all required fields now present, retry the CAS once instead of reporting "already transitioned". Test it.
3. Write a READ-ONLY SQL check at scripts/checks/2026-10-25-drafts-missing-snapshots.sql: count of DRAFT orders on prod missing any field batch sign now requires (the 6 snapshots), grouped by clinic, with order ids for Sunrise. SELECT only, no writes, safe to run as any role that can read orders. I will hand it to Sam at the right moment; do not run it anywhere but your local/E2E DB.
Gates: lint (0 warnings), tsc, jest, next build. Push state-machine-enforcement (normal push, no PR). Report in the commit body, including the SQL file's content.

Do not touch the production database, Vercel, Stripe or secrets.
