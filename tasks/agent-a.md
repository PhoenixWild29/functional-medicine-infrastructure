task-id: A-2026-10-24-06
status: ready
---
If you have not yet finished and pushed A-2026-10-24-05 (the test-data cleanup script on test-data-cleanup-script), finish it and push it first, with its report, exactly as that task said. Then do this.

PR #261 (your branch eslint-config-next-16-4, head 885e4da) failed only the Lint (ESLint) check in CI (run 40131054552, job 120982650522). CI lints the merge with current main, and main has gained code since your base 903186b: #255 (login hydration refs and Show-checklist hydration, team-panel row override), #256 (QR as one path, axe helpers, /api/health on Node), #257 (landmarks), #258 (ci.yml), #260 (face-sheet availability). The react-hooks 7.1 rules most likely flag some of that new code.

1. `git fetch origin && git checkout -B eslint-config-next-16-4 origin/eslint-config-next-16-4 && git merge origin/main`.
2. `npm ci` then `npm run lint`. Fix every finding properly in code, the same way you did the first 24 (render-time state adjustment, readers applied in .then, latest-ref in an effect). No eslint config changes, no blanket disables; a scoped disable with a reason only where a fix would change behaviour (e.g. sessionStorage/localStorage restore after hydration), listed in the report. Characterization tests first for anything you restructure. C's login hydration sync in src/app/login/page.tsx must keep working (its tests: e2e-flake-hydration, login-landing).
3. `npm run lint` (0 errors, 0 warnings), tsc, Jest (--maxWorkers=3), build. Push eslint-config-next-16-4 (normal push). Full report in the final commit body: each new finding (file:line, rule), the fix, disables with reasons, local results, head SHA.

Do not touch the production database, Vercel, Stripe or secrets.
