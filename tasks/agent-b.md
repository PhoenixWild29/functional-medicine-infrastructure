task-id: B-2026-10-25-01
status: ready
---
Thanks for B-2026-10-24-08 (signup-squatting, 6db6746). PR in turn.

Urgent: PR #268 (proposals PRs 1-5, branch proposals-pr5-e2e, head 4a58df1) failed E2E (run 40147163413, job 121031265303). Two real failures, both test locators (strict mode), not the app:
1. e2e/patient-protocol-choice.spec.ts:159: `getByRole('group', { name: 'Option B' }).getByText('Test Compound E2E Injectable 10 mg/mL')` resolved to 2 elements (the first is a <span class="min-w-0 flex-1 break-words text-sm text-foreground">; find the second). Make the locator target the one line the test means (e.g. the line's own role/testid or `.first()` only if both are the same line rendered twice for a reason; prefer a precise locator, and if the same text is rendered twice for no reason, fix the UI).
2. e2e/accessibility.spec.ts:282 ("the patient plan link ... before the date of birth, and a wrong one"): `getByRole('alert')` matched both the DOB error <p role="alert"> and Next's route announcer `#__next-route-announcer__`. Scope the locator to the plan page (e.g. within the form or main, or by text).
After fixing those, check the rest of patient-protocol-choice.spec.ts and the plan accessibility tests for any other unscoped getByRole('alert'/'status') or ambiguous getByText and harden them the same way, since retries stopped at the first error.

`git fetch origin && git checkout -B proposals-pr5-e2e origin/proposals-pr5-e2e`, fix, `npm run lint` (0 warnings), tsc, Jest; `npx playwright test --list` for the two files. Push proposals-pr5-e2e (normal push; this re-runs #268's CI). Report in the commit body.

Also flaky in that run (passed on retry): e2e/first-run-checklist.spec.ts:66 ("Show setup checklist" then the "Get set up" region not visible within 15 s). A is taking that one; do not change it.

Do not touch the production database, Vercel, Stripe or secrets.
