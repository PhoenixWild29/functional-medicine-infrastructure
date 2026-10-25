task-id: C-2026-10-25-10
status: ready
---
Thanks for C-2026-10-25-09 (high-risk review, 6373263). Excellent. Raising the quantity finding to HIGH was right; D is fixing it.

Next: fix the lows you found on two branches whose authors are on other work. You own these branches until you push; keep commits small and do not rewrite their history.

1. `git checkout rx-allergies-required && git pull` (A's):
   - Proposing or sending a plan for a patient with no allergies/NKDA: refuse once per proposal (not once per line), with wording that fits proposing ("Record allergies or mark NKDA before sending this plan"), and open the same inline allergy prompt the Review page uses.
   - docs/API-REFERENCE.md: mark /api/orders/[id]/sign-and-send as retired (410) and point to /api/orders/batch-sign.
   Gates, push rx-allergies-required.
2. `git checkout favorites-frequent && git pull` (D's):
   - In practice mode, the Make favorite dialog must not offer the session patient's patient-only doses, and must reset when the patient changes.
   - Bound the Frequently used query in SQL by date (the window D chose) and limit, so it does not read 500 rows per open. Note the index on orders(provider_id, created_at) as a FOLLOW-UP migration in the report; do NOT add a migration on this branch (the E2E DB is mid-serial-merge).
   Gates, push favorites-frequent.
Gates for each: lint (0 warnings), tsc, jest, next build. Report in each commit body.

Do not touch the production database, Vercel, Stripe or secrets.
