task-id: D-2026-10-25-13
status: ready
---
Thanks for D-2026-10-25-12 (checklist v2, 674e1e2).

Next: close the rest of coverage gap 6. The NP asked for clinical difference statements "like Strive's list". Today the GLP-1 statement is required and auto-expanded, but patient-specific statements must be typed each time and cannot be saved. Sam has not decided pre-selection, so do NOT pre-select anything.

Branch: `git fetch origin && git checkout -b clinical-difference-saved origin/bundle-features` if it is pushed, else origin/main (say which).
- Let a provider save a statement they typed as a reusable statement, scoped to the practice (default) or to one patient, for that formulation (or ingredient group, if that is how statements are keyed today; read the code).
- At the clinical difference step, show saved statements for that formulation (patient-scoped ones first when a patient is in context) as one-click choices next to the standard list. Choosing one fills the field; the provider can still edit. Nothing is chosen automatically.
- The chosen statement prints on the Rx/fax exactly as today.
- Storage: if an existing table or jsonb column fits cleanly (e.g. favorites or a clinic settings jsonb), use it with no migration and say why it fits. If it needs a new table, write migration 20261024000009_saved_clinical_statements.sql with its down file, RLS scoped to the clinic (follow the patterns in 000002 treatment_proposals: policies, grants, apply_pharmacy_admin_scope if the convention requires it), and confirm 000009 is the next free number across all origin branches. A migration branch is PREPARED only; it merges after perf-indexes.
- Server: zod-validated, role-gated (providers and clinic admins save; MAs can use but not save, unless the code's existing rules for favorites say otherwise; follow favorites), clinic-scoped, length-bounded.
Tests: jest for save, scoping (no cross-clinic, patient-only visible only for that patient), the picker, and the printed Rx. No E2E changes that need new seed tables unless the migration exists.
Gates: lint (0 warnings), tsc, jest, next build. Push clinical-difference-saved (normal push, no PR). Report in the commit body (include the migration SQL if any).

Do not touch the production database, Vercel, Stripe or secrets.
