task-id: A-2026-10-26-05
status: ready
---
Thanks for A-2026-10-26-04 (rls-aal2, 524e924). Thorough, and the payment-group finding is a real gap.

Next, two parts.
1. The POST /api/checkout/payment-group MFA gap is NOT decision-gated (the middleware already enforces MFA for that role set when REQUIRE_MFA is on; this route escapes it today because of its /api/checkout prefix). Ship the fix now, separately from rls-aal2:
   `git fetch origin && git checkout -b mfa-gate-payment-group origin/bundle-hipaa`. Port only mfaApiRefusal() in lib/auth/mfa and its use in POST /api/checkout/payment-group, with the 4 tests. No migration, no PGlite harness (keep that on rls-aal2). Also scan every route under a public middleware prefix for any other staff route that escapes the gate the same way (list them; fix any you find the same way).
   Gates: lint (0 warnings), tsc, jest, next build. Push mfa-gate-payment-group (normal push, no PR). D will merge it into bundle-hipaa.
2. Then verify C's fix for B's R1 (redirect chains in the Tier 2 portal and portal-status-poll) on origin/order-transmission-integrity once C pushes it (newer than f4b7487). You wrote the original, so look for anything C changed in your design that breaks the T1-T7 guarantees, re-run B's two Chromium chains, and confirm signed-order-freeze carries the fix. If C has not pushed when you finish part 1, check back every few minutes. Write your result as a section appended to docs/ops/rx-binding-key.md? No: put it in a commit on a new branch `verify-r1` from origin/main at docs/qa/verify-2026-10-26-r1.md, push, summary in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
