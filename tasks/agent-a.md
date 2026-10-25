task-id: A-2026-10-25-17
status: ready
---
Thanks for A-2026-10-25-16 (decision brief, 729af68).

Next: close three code gaps from C's HIPAA evidence map (origin/review-high-risk, docs/compliance/technical-safeguards-evidence-2026-10-25.md, gaps B6, B7, B17). Read those sections first.

Branch: `git fetch origin && git checkout -b order-transmission-integrity origin/bundle-features`.
1. B6: nothing refuses to transmit an unsigned order. At every send path (Tier 1 API adapters, Tier 2 portal, Tier 3, Tier 4 fax, retries, re-routes, ops resubmit), refuse unless the order has locked_at, a provider signature and status allowing submission. Refusal is logged (no PHI) and surfaces as a failure reason for ops; never sends.
2. B7: the signature hash does not bind the prescription contents. Compute the hash over a canonical serialisation of the signed clinical content (medication, strength, dose/sig, quantity and unit, days supply, refills, dispense, syringes, shipping type, clinical difference, diagnosis, special instructions, allergies status, patient id, provider NPI, pharmacy) plus the signature, at signing; store it in the existing signature hash column. At send, recompute and refuse on mismatch (tamper evidence). Old orders without the new hash: send as today but log that they predate binding. If the signature image is discarded today, say whether keeping it needs storage/schema; do NOT add a migration (report the design if needed).
3. B17: Tier 1 and Tier 2 pharmacy URLs must be https at send time (and at pharmacy setup save). Refuse http, except localhost in tests.
Tests: jest for each refusal path, the canonical hash (field order stable, any change detected), and https enforcement. Existing E2E must stay green.
No database migrations.
Gates: lint (0 warnings), tsc, jest, next build. Push order-transmission-integrity (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
