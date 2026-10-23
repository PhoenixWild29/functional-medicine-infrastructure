task-id: B-2026-10-23-05
status: ready
---
PR #248 (Agent C's branch `lauren-polish-oct23`, head 296e18c) fails one E2E test because C changed the app copy but missed one E2E expectation. C is not responding, so you fix it on C's branch.

1. `git fetch origin && git checkout -B lauren-polish-oct23 origin/lauren-polish-oct23` (head must be 296e18c82641eb7aced467370a558bdc48443996).
2. In `e2e/clinic-app.spec.ts` line 2167 the expected text still has an em dash: `$220.00) — $11.00 more overall, so it is not suggested.` The app (src/lib/orders/reroute.ts line ~279, see its unit test src/lib/orders/__tests__/wo102-reroute.test.ts:109) now renders `$220.00): $11.00 more overall, so it is not suggested.` Change only that expectation so it matches the app: replace `) — $11.00` with `): $11.00`. Do not change app code.
3. Check no other `toHaveText`/`getByText` expectation in e2e/ still contains an em dash that the app no longer renders (test titles and comments are fine).
4. Run lint and tsc (Jest unaffected). Commit on lauren-polish-oct23 and push to origin lauren-polish-oct23 (normal push, no force). Put the report (new head SHA, the changed line) in the commit message body. Do not open a PR (it exists, #248).
