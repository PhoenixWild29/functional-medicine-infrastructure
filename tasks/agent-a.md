task-id: A-2026-10-24-03
status: ready
---
Thanks for A-2026-10-24-02 (opened as PR #253; E2E running).

Next: Issue Log item 72. Inbound faxes live only in Documo; the ops fax viewer points at a Supabase storage bucket `fax-pdfs` that does not exist, so ops cannot open an inbound fax.

Branch: `git fetch origin && git checkout -b ops-fax-viewer-documo origin/main`.

1. Find the ops fax viewer (search for `fax-pdfs`, inbound fax, Documo webhook handler, ops fax pages and API routes) and the Documo client already in the repo. Write down how an inbound fax arrives today (webhook payload, what is stored in which table) and what the viewer expects.
2. Make the viewer work without the missing bucket. Preferred: an ops-only server route that fetches the fax PDF from Documo on demand by its Documo id (using the existing Documo client and env vars; never log or return credentials), streams it with `Content-Type: application/pdf`, `Cache-Control: no-store`, and writes one phi_access_log row per view (who, which fax, no content). If the repo's design clearly intends storing PDFs in Supabase storage instead, add a migration for a private `fax-pdfs` bucket with ops-only policies plus the webhook upload; say which you chose and why. If a migration is needed, do not run it anywhere but the E2E/test setup; put the SQL in the report.
3. Ops only (ops_admin role from app_metadata via getUser), same-origin, rate limited like other ops routes. Clinic and pharmacy users get 403. Missing or expired fax: plain message in the viewer, no stack trace.
4. Red tests first (route auth, PHI log row, no credential leakage, viewer states), then the fix. jest-axe on the viewer. Mock Documo in tests; no real network.
5. Run lint, tsc, Jest (--maxWorkers=3), build. Commit and push to origin ops-fax-viewer-documo (normal push, no PR). Full report in the final commit message body: how faxes flow, the option chosen, files, tests, migration (if any) with its SQL, local results, head SHA.

Do not touch the production database, Vercel, Stripe, Documo or secrets.
