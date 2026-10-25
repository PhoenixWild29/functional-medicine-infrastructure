task-id: A-2026-10-25-01
status: ready
---
Thanks for A-2026-10-24-08 (security-followups-2, ad64b44).

Two small tasks, two branches.

PART 1. Confirm the Documo fax download endpoint (your fax viewer, ops-fax-viewer-documo, uses GET https://api.documo.com/v2/accounts/{account}/faxes/{id}/download, unconfirmed).
- Read Documo's public API documentation (docs.documo.com or their developer site) from this machine if the network allows; do not call Documo's API and do not use any key. Find the documented way to download an inbound fax's PDF (path, method, auth header name, Accept, response type) and how inbound webhook payloads identify the fax.
- If the docs differ from what downloadFaxPdf does, fix it on ops-fax-viewer-documo (`git fetch origin && git checkout -B ops-fax-viewer-documo origin/ops-fax-viewer-documo`, merge origin/main first), update the URL/header assertions in download-fax.test.ts, lint 0 warnings, tsc, fax tests, push. If they match, push nothing to that branch.
- If the docs cannot be reached, say so; do not guess.
- Report (with doc URLs and quoted endpoint lines) in the commit body, or, if nothing changed, in a commit on a new branch documo-endpoint-check containing only a short note file docs/integrations/documo-fax-download.md.

PART 2. E2E job on the official Playwright container image (D's idea in the CI report d25b0ce): saves the ~31 s install-deps step and removes the apt-mirror hang risk.
- Branch `git checkout -b ci-playwright-container origin/main`.
- In .github/workflows/ci.yml E2E job only: `container: mcr.microsoft.com/playwright:v<exact @playwright/test version from package-lock>-noble` (or the matching tag), drop the browser cache and install-deps steps, keep everything else (schema sync via npx supabase@2.120.0, build, test, artifact upload). Check what breaks inside a container: node version (match setup-node), npm ci cache, git safe.directory, HOME, the supabase CLI binary (linux-x64), env vars, permissions on the workspace.
- Add a guard so the image tag must equal the installed @playwright/test version (a tiny script or a step that fails with a clear message), so a Playwright bump cannot silently use the wrong browsers.
- You cannot run the workflow locally; reason carefully and say what the first PR run must confirm.
- Push ci-playwright-container (normal push, no PR). Report in the final commit body.

Do not touch the production database, Vercel, Stripe, Documo or secrets.
