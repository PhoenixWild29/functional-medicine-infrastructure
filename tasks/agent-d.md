task-id: D-2026-10-24-02
status: ready
---
Thanks for the patient protocol choice design (D-2026-10-24-01); Sam is answering the 9 questions, the build waits for that.

Next: Next 16.4.3 upgrade follow-through. Main (ed64893) now runs next 16.4.3 and sharp 0.35.5 (#252). B fixed the MFA navigation regression; A is auditing client navigation after redirects (do not touch that area: router.push/replace after auth or gate changes).

Branch: `git fetch origin && git checkout -b next-16-4-followthrough origin/main`.

1. Read the Next 16.3 and 16.4 upgrade notes and changelogs (node_modules/next and the release notes) and list every deprecation or behaviour change that applies to this codebase: middleware vs proxy.ts naming, caching/revalidation defaults, cookies()/headers() async APIs, Image Optimization config (remotePatterns, SVG, sharp 0.35), server actions, route handler defaults, `experimental` flags in next.config, Turbopack build differences, React version requirements.
2. Run `next build` and `next lint`/tsc and collect every warning or deprecation notice. Check the Vercel preview build log is not needed: use the local build.
3. Fix what applies (no behaviour change unless the old behaviour is now broken). For anything risky, do not change it; describe it in the report with file:line and a recommendation.
4. Jest stability: B saw jsdom/axe suites (signup-link, new-patient, face-sheet-fill, team-panel) hit the 5 s per-test timeout under default workers locally. Find why those suites are slow (axe on large trees, unmocked timers, real network) and make them fast; do not just raise the timeout. CI's Jest job must stay green.
5. Run lint, tsc, Jest (default workers and --maxWorkers=3), build. Commit and push to origin next-16-4-followthrough (normal push, no PR). Full report in the final commit message body: each applicable change from step 1 with what you did, build warnings before/after, Jest timings before/after for those suites, local results, head SHA.

Do not touch the production database, Vercel, Stripe or secrets.
