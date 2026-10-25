task-id: C-2026-10-25-01
status: ready
---
Thanks for C-2026-10-24-08 (H1 split, #267 merged; proposals opened as #268).

Next: dead code and unused dependencies, found by D and A today.

Branch: `git fetch origin && git checkout -b remove-dead-code origin/main`.

1. Unused packages: D found that nothing imports react-hook-form or @hookform/resolvers. Confirm (grep src, scripts, e2e, config files, dynamic imports) and remove them from package.json and the lockfile (keep the lockfile minimal and keep the libc markers). Run a tool like `npx depcheck` or `npx knip` to find any other unused dependencies or devDependencies; remove only those you prove unused, list the rest with why they stay (e.g. used by config, CLI, types).
2. Unused files and exports: A found PharmacySearchForm (new-prescription) is imported nowhere. Use knip (or ts-prune) to list unused files and exports across src. Remove what is provably dead (no import, no dynamic route usage, no test-only reliance that matters). Do NOT remove Next route files (page.tsx, route.ts, layout.tsx, etc.), anything referenced from next.config, middleware/proxy, crons in vercel.json, scripts run by package.json or CI, or e2e fixtures. If a test only exists to test dead code, remove it with the code and say so.
3. Do not change behaviour. `npm run lint` (0 warnings), tsc, Jest, build must pass. Report bundle size before/after if next build prints it.
4. Push remove-dead-code (normal push, no PR). Full report in the final commit body: every package and file removed with the proof, things left and why, local results, head SHA.

Do not touch the production database, Vercel, Stripe or secrets.
