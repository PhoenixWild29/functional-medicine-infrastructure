task-id: C-2026-10-24-08
status: ready
---
Thanks for C-2026-10-24-07 (proposals PR 5, b072771, with the integration fixes). The five proposal PRs will go to main as one PR from proposals-pr5-e2e.

Two parts.

PART 1. Split D's H1 change out of security-review-oct24, so the migration PR can merge now.
Background: security-review-oct24 (D, head f9f6904) carries migration 20261024000001_rls_hardening (Sam already ran it on prod) plus code fixes, including H1: lib/clinics/demo-payouts.ts demoPayoutsOnApproval() returns false with a live Stripe key (sk_live_/rk_live_). Sam has not decided H1 yet (on Oct 23 he decided new clinics order right after approval using the demo payout account; prod keys are live). The migration must merge before 20261024000002/3/4 so the E2E database migration history stays in order.
- `git fetch origin && git checkout -b security-review-oct24-no-h1 origin/security-review-oct24`.
- Revert only the H1 behaviour (the live-key check in demoPayoutsOnApproval and its tests) with a normal commit, so demo payouts on approval behave exactly as on main. Keep everything else D did (C1 migration, L1-L4, M1, approval row counts, npm audit fix).
- `git merge origin/main` (main now has #261 eslint-config-next 16.4.3 and #264), fix any lint finding (0 warnings), tsc, Jest, build. Push security-review-oct24-no-h1 (normal push).
- Then a separate branch with only H1: `git checkout -b demo-payouts-live-key-guard origin/main`, re-apply just the H1 change and its tests (cherry-pick D's H1 commit or rewrite it), lint/tsc/Jest, push. It stays unmerged until Sam decides.
- Report in each branch's final commit body: what was reverted/kept (files), local results, head SHA.

PART 2. Bring proposals-pr5-e2e up to date with main.
- After part 1 is pushed: `git checkout -B proposals-pr5-e2e origin/proposals-pr5-e2e && git merge origin/security-review-oct24-no-h1` (so the branch carries 000001 before its 000002, matching the order main will have), then `git merge origin/main`. Resolve conflicts, lint 0 warnings (eslint-config-next 16.4.3 is on main now: fix any react-hooks 7.1 findings in the proposals code properly), tsc, Jest, build. Push proposals-pr5-e2e. Report in the merge commit body.

Do not touch the production database, Vercel, Stripe or secrets.
