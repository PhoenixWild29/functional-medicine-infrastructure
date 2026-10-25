task-id: D-2026-10-25-15
status: ready
---
Thanks for D-2026-10-25-14 (clinic-help, 96f74e3).

Next: fix C's review of clinical-difference-saved (origin/review-high-risk, docs/qa/review-2026-10-25-high-risk.md section 5).

`git checkout clinical-difference-saved && git pull && git merge origin/bundle-features` (it must sit on bundle-features so it can use lib/api/input and withApiErrors; resolve the migration-order test conflict as the other migration branches did).
1. MEDIUM: replace strict z.uuid() with the repo's any-hex uuid helper from lib/api/input so seeded demo/E2E ids (a3000000-..., aaaaaaaa-0000-...) work. Test with those ids.
2. MEDIUM: wrap GET/POST/DELETE with withApiErrors, use isClinicStaffRole (or the gate bundle-security uses for clinic routes) and lib/api/input parsing, keeping cross-site, then auth/gate, then parse, then write. The route-error-wrapper and same-origin tests must pass.
3. LOW: a concurrent duplicate save returns the existing row (handle unique violation 23505 by re-reading), not 500.
4. LOW (no change): any clinic role can soft-delete the clinic's statements, matching favorites. Leave it; Sam can narrow later.
Then: `git checkout clinic-help && git merge origin/clinical-difference-saved` only if the help page's saved-statements section needs it; otherwise leave clinic-help as is and say so.
Gates: lint (0 warnings), tsc, jest, next build. Push clinical-difference-saved (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
