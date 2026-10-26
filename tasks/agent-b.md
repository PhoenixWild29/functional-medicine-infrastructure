task-id: B-2026-10-26-10
status: ready
---
Thanks for B-2026-10-26-09 (verify f4b7487, d4e00ce). R1 goes to C now.

Next: CI timing risk before the bundle PRs run. Your phi-log verification saw jest suites take ~2,360 s under load and 6 a11y/UI suites fail on timing only; D raised the epcs test timeout. The bundle PRs will run the full suite in CI once each, so a timing flake costs a whole serial E2E slot.
On origin/bundle-hipaa (the largest bundle; read-only unless stated):
1. Measure: run jest with --maxWorkers matching CI (read .github/workflows/ci.yml) and --logHeapUsage, record the 20 slowest suites and any that pass only when run alone.
2. For each slow or timing-sensitive suite, find the cause (cold dynamic imports of route modules, real timers, large fixtures, axe on big trees) and fix it in the test (mock heavy imports, fake timers, smaller fixtures, per-suite timeouts with a stated reason). No product code changes unless a test reveals a real bug (then report it).
3. Check CI's jest step has a sane timeout and that the slowest suite stays well under it.
Commit the test fixes on a new branch `jest-timing` from origin/bundle-hipaa; D will merge it into bundle-hipaa. Gates: lint (0 warnings), tsc, jest (report before/after wall time). Push jest-timing (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
