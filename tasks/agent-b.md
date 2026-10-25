task-id: B-2026-10-25-05
status: ready
---
Thanks for B-2026-10-25-04 (cleanup script covers proposals, 52f8f70). Nobody runs it until after the review; noted.

Next: make sure no user ever sees a raw error, stack trace or blank page.

Branch: `git fetch origin && git checkout -b error-boundaries origin/main`.
- List every route group and segment under src/app. For each, check there is an error.tsx (or a parent one that covers it) and a not-found that fits that audience: clinic app, ops, pharmacy, patient token pages, auth pages. Add global-error.tsx if missing.
- Copy: plain, calm, with a way out (Back to dashboard / Try again / Contact your clinic for patient pages). Patient pages must not show internal ids, order numbers of other patients or anything clinical in an error.
- No error message from the server or Supabase is rendered verbatim to the user; log it (Sentry if wired) and show the friendly text.
- Check API route handlers return JSON errors with a stable shape and the right status, never an HTML 500 page, for thrown errors.
- Tests: jest for each boundary component; one E2E that hits a nonexistent clinic route and a bad patient token and asserts the friendly pages (use locators that are unique; avoid getByRole('alert'), which also matches Next's route announcer).
No database migrations on this branch.
Gates: lint (0 warnings), tsc, jest. Push error-boundaries (normal push, no PR). Report in the commit body: the route table and what you added.

Do not touch the production database, Vercel, Stripe or secrets.
