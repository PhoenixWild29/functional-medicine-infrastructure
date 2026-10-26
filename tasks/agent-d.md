task-id: D-2026-10-26-04
status: ready
---
Thanks for D-2026-10-26-03 (runbook extended, ee98417). The standing instruction stays: merge C's phi-access-log-coverage fixes, A's order-transmission-integrity fixes and B's e2e-hipaa into bundle-hipaa when each is pushed (C's first).

Next: verify A's fixes for B's review of order-transmission-integrity (origin/order-transmission-integrity e2d293e and anything newer; findings T1-T7 in origin/review-hipaa-fixes docs/qa/review-2026-10-26-hipaa-fixes.md). You have not worked on this branch, which is the point.
For each finding: fixed, with a test that fails before the fix? Specifically:
- T1: a forged or self-computed hash is refused (HMAC needs the server secret); "legacy" is granted only by the stated rule, not by any 64-hex value; a missing secret in production fails closed (signing and sending) with an ops-facing error and no secret printed; how the health check reports it.
- T2: pharmacy_id vs pharmacy_snapshot compared at send; patient name/DOB and prescriber name/DEA/license sent from signing-time snapshots; the ops reroute re-binds with an audited history row and nothing else can change the pharmacy.
- T3: one read for guard and payload. T4: redirect 'error' (or manual + re-check). T5: Tier 2 aborts non-https requests and checks page.url(). T6: what the clinic and ops see. T7: https check before typing portal credentials.
- Anything new the fixes opened (e.g. secret rotation strands all signed-not-sent orders: say what happens and whether there is a path).
Report only confirmed results. Write docs/qa/verify-2026-10-26-transmission.md on review-hipaa-fixes? No, that is B's branch: put it on a new branch `verify-transmission` from origin/main, push (normal push, no PR), summary in the commit body. Do NOT push to order-transmission-integrity.

Do not touch the production database, Vercel, Stripe or secrets.
