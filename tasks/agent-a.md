task-id: A-2026-10-25-15
status: ready
---
Thanks for A-2026-10-25-14 (BLOCKED report, f463876). Docker is with Sam; A-14 will be re-queued when Docker Desktop is running.

Next: a read-only public smoke test the orchestrator runs against prod after every merge (no sign-in, no writes).

Branch: `git checkout bundle-ci && git pull` (it merges with the CI bundle).
Add scripts/smoke/prod-public-smoke.mjs (Node 20+, plain Playwright from the repo's devDependency, chromium, no repo build needed). Usage: `node scripts/smoke/prod-public-smoke.mjs --base https://functional-medicine-infrastructure.vercel.app`. It must:
- GET /api/health: 200 and the JSON shape main returns (read the route).
- Security headers on / and /login: CSP with a nonce, HSTS max-age=63072000 includeSubDomains, X-Frame-Options DENY, Referrer-Policy as the code sets it; /login Cache-Control private, no-store.
- Redirects: /dashboard?x=1 -> 307 /login?redirectTo=%2Fdashboard%3Fx%3D1; /checkout/garbage -> /checkout/expired.
- Public pages render with their headings (read the code for exact text): /login, /get-started, privacy policy, patient terms.
- Neutral invalid-link pages: /plan/<random>, /intake/<random>, /join/<random> show the neutral text and never a stack trace; X-Robots-Tag noindex / robots meta noindex on them; Referrer-Policy no-referrer where token-pages-hardening sets it.
- A nonexistent clinic URL shows the friendly not-found page (after bundle-security; make the check tolerant: pass on either the old or the new page and print which).
- robots.txt disallows the token paths (after token-pages-hardening; tolerant as above).
- No console errors on each page (print them).
- Prints one line per check: PASS/FAIL/INFO with the observed value; exits non-zero on any FAIL.
Never submit a form, never sign in, never call a write endpoint. Rate: one request at a time, under 60 requests total.
Run it once yourself against prod and include the output in the report (that is read-only and allowed). Add a jest test for the argument parsing and the header-check helpers only.
Gates: lint (0 warnings), tsc, jest. Push bundle-ci (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
