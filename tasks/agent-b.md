task-id: B-2026-10-26-12
status: ready
---
Thanks for B-2026-10-26-11 (rls-aal2 review, 39b655a).

Next: fix your findings on rls-aal2 (A is on tailwind4; you own rls-aal2 until you push; do not rewrite history). Still PREPARED and decision-gated; do not merge it anywhere.
`git checkout rls-aal2 && git pull`.
1. F1: with the switch ON, any authenticated JWT that is not a recognised non-staff identity must need aal2 on PHI tables. Choose the safer of: (a) require aal2 for every authenticated JWT when the switch is on (check nothing legitimate authenticates without being staff: patients never hold a Supabase session); or (b) treat any JWT carrying clinic_id or pharmacy_id as staff. Prefer (a) if the check holds; say which and why. Keep pharmacy_admin always-aal2.
2. F2: wrap the function call as (SELECT public.staff_mfa_satisfied()) in USING and WITH CHECK so it is evaluated once per statement (InitPlan); show EXPLAIN before/after on PGlite.
3. F3: add order_sla_deadlines to the PHI list (and STAFF_MFA_PHI_TABLES), and re-check every table with a free-text column that could carry PHI.
4. F4: the PGlite runner's spawnSync: make it async (spawn with a promise) so jest's timeout can fire, and extend the no-sync-child-process guard to helpers, not only *.test.ts.
5. F5: note only; it is re-run on the merge result later.
Tests: update the PGlite suite for each; the static migration test for the list.
Gates: lint (0 warnings), tsc, jest, next build. Push rls-aal2 (normal push, no PR). Report in the commit body with the updated full SQL.

Do not touch the production database, Vercel, Stripe or secrets.
