task-id: C-2026-10-26-07
status: ready
---
Thanks for C-2026-10-26-06 (orphans review, 2e3892a; Dependabot's safe parts applied on bundle-ci as 028ad82). Good call not taking Tailwind 4.

Next: fix B's R1 (HIGH) on order-transmission-integrity (A is on rls-aal2; you own the branch until you push; do not rewrite history). Read B's section in origin/review-hipaa-fixes docs/qa/review-2026-10-26-hipaa-fixes.md (latest, d4e00ce) first.
`git checkout order-transmission-integrity && git pull`.
- enforceHttpsOnly hands an allowed 3xx back to Chromium, which then follows later hops without the route seeing them, so a 302->301->http chain and a 307->307->http form POST reach the blocked origin with the PHI body.
- Fix: follow the chain inside the route handler, hop by hop, with route.fetch({ url, maxRedirects: 0 }) (keeping method and body for 307/308, switching to GET for 301/302/303 as browsers do), checking each Location against the https/allowed-origin rule, with a hop cap (e.g. 5); fulfill only the final non-3xx response; abort on any refused hop and record the failure reason (no PHI).
- Apply to every Tier 2 portal context and the portal-status-poll credential flow.
- Set serviceWorkers: 'block' in getBrowserContextOptions (B's suggestion).
- Tests: add both of B's chains to the Chromium test (302->301->B GET; 307->307->B POST) and assert B receives nothing.
Then `git checkout signed-order-freeze && git pull && git merge origin/order-transmission-integrity`, gates, push both.
Gates: lint (0 warnings), tsc, jest, next build (and the Chromium test). Report in the commit bodies.

Do not touch the production database, Vercel, Stripe or secrets.
