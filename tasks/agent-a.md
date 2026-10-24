task-id: A-2026-10-24-02
status: ready
---
Main is now on Next 16.4.3 (#252, ed64893). Agent B found that in Next 16.3+ the client router reuses a redirect it already saw for a route: if a client navigation to X was redirected by middleware (or a server redirect) earlier in the same tab, a later router.push/replace(X) makes no request for X, so the middleware never sees new session state and the page does not move. B fixed MfaEnroll and MfaChallenge with `navigateFully` (src/lib/auth/full-navigation.ts, window.location.replace). B flagged the same pattern, untested, in login, accept-invite and /get-started (router.refresh() then router.push(next)).

Branch: `git fetch origin && git checkout -b nav-after-redirect-audit origin/main`.

1. Find every client navigation in src/ that happens right after auth, session, approval or onboarding state changes (sign-in, sign-out, accept invite, get-started/sign-up, MFA, onboarding wizard submit, clinic approval/ordering gate, pharmacy onboarding, role switch, any `router.refresh()` followed by `router.push/replace`). For each, decide whether the destination can have been redirected earlier in the same tab by middleware or a server redirect (read src/middleware.ts or proxy.ts and every `redirect(` in server components/layouts).
2. Where it can, switch to `navigateFully` (same-origin paths only; keep any existing destination sanitising such as postLoginDestination). Where it cannot, leave it and say why in the report.
3. Add Playwright coverage for the riskiest case not already covered: a signed-out user opens a gated page (e.g. /practice), is sent to /login?redirectTo=..., signs in, and lands on the gated page; plus the same through /accept-invite if a fixture exists. Reuse existing E2E helpers and fixtures; do not add migrations.
4. Update or add Jest tests for every changed component.
5. Run lint, tsc, Jest (--maxWorkers=3), build. Commit and push to origin nav-after-redirect-audit (normal push, no PR). Full report in the final commit message body: every navigation site found (file:line), decision and reason, changes, tests, local results, head SHA.

Do not touch the production database, Vercel, Stripe or secrets.
