task-id: A-2026-10-25-07
status: ready
---
Thanks for A-2026-10-25-06 (Actions on Node 24 majors, 45e7211).

Next: harden the patient token pages so a token can never leak or be indexed.

Branch: `git fetch origin && git checkout -b token-pages-hardening origin/main`.
Scope: every route that takes a patient-facing token (at least /plan/[token] and /checkout/[token], and any others you find; list them all).
For each, check and fix on main's code:
- Referrer-Policy: no-referrer (so the token URL is never sent to third parties via Referer). Stripe on checkout is expected; confirm the token is not passed to it in any URL or metadata beyond what checkout needs.
- X-Robots-Tag: noindex, nofollow and a robots meta noindex; robots.txt disallows the token paths.
- Cache-Control: private, no-store on the page and its API calls.
- The token never appears in server logs, Sentry breadcrumbs/URLs, analytics events or error messages (scrub it if it does).
- An invalid, expired or used token shows a neutral page that does not reveal whether the token ever existed.
- The /plan DOB gate: confirm attempts are rate limited and lock after repeated failures; if not, report it (do NOT add a migration; if the fix needs one, stop and report the design).
Add jest tests for headers and scrubbing, and extend an existing E2E spec only if it needs no new seed tables.
No database migrations on this branch (the shared E2E DB is mid-serial-merge).
Gates: lint (0 warnings), tsc, jest. Push token-pages-hardening (normal push, no PR). Report in the commit body: routes found, what was already right, what you changed.

Do not touch the production database, Vercel, Stripe or secrets.
