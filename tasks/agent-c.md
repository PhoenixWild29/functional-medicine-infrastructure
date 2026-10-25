task-id: C-2026-10-25-14
status: ready
---
Thanks for C-2026-10-25-13 (bundle-features review, e219681: nothing lost).

Next: security review of two new branches you have not seen.
1. origin/clinical-difference-saved (D, 3bd6713), including PREPARED migration supabase/migrations/20261024000009_saved_clinical_statements.sql and its down file.
   - Migration: RLS enabled; policies scoped to the caller's clinic (and patient scope enforced); grants match the repo's lockdown direction (compare with rls-user-write-lockdown-v2 000004: if 000004 revokes user writes on tables, this new table must follow the same rule and be written only through the server); apply_pharmacy_admin_scope convention; indexes for the read path; length checks; FKs and ON DELETE behaviour; it applies cleanly AFTER 000003-000008 (check the shared migration-order test).
   - Server: zod, role gate (who can save vs use), clinic scoping, patient-scoped statements visible only for that patient, no PHI in logs.
   - Rx/fax print unchanged except the chosen text.
2. origin/clinic-help (D, when pushed; 2cd8d9b is local so far): no PHI, no secrets or internal URLs in help text, labels match the code, route is behind clinic auth, no external links.
Confirm each finding before reporting (read the path end to end or a throwaway test). Append to docs/qa/review-2026-10-25-high-risk.md on your review-high-risk branch (or a new section on bundle-review; say which), push (normal push, no PR), summary in the commit body. Do NOT push to D's branches.

Do not touch the production database, Vercel, Stripe or secrets.
