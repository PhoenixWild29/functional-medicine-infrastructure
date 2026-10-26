task-id: D-2026-10-26-09
status: ready
---
If D-2026-10-26-08 (items 4 and 1) is not finished, finish it first, then do this.

Next: merge into bundle-hipaa, in order, latest origin heads, `git merge --no-ff`:
1. origin/mfa-gate-payment-group (A, 35b8cd0): the MFA gate for POST /api/checkout/payment-group. Based on bundle-hipaa ef421bb, so it should merge cleanly.
2. origin/jest-timing (B) when pushed: test-only timing fixes. If not pushed when you finish item 1, push bundle-hipaa without it and merge it in a follow-up when it lands.
Gates: npm ci, lint (0 warnings), tsc, jest, next build. Push bundle-hipaa (normal push, no PR). Report in the commit body: heads merged, gates, and wall time of the jest run.

Do not touch the production database, Vercel, Stripe or secrets.
