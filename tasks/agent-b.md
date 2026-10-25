task-id: B-2026-10-25-09
status: ready
---
Thanks for B-2026-10-25-08 (state-machine lows + drafts SQL, b0bd60f).

Next: build bundle-features, the last bundle PR. Read A's dry-run report first (origin/dry-run-report, docs/qa/merge-dry-run-2026-10-25.md): it records how each conflict resolves.

`git fetch origin && git checkout -b bundle-features origin/bundle-security` (the feature branches conflict with the three bulk route-handler branches, which are in bundle-security; basing on it avoids redoing those resolutions. bundle-features merges after bundle-security).
Merge with `git merge --no-ff`, in this order:
1. origin/state-machine-enforcement (b0bd60f)
2. origin/rx-quantity-shipping (9e2b075)
3. origin/rx-allergies-required (080519a)
4. origin/favorites-frequent (76a6964)
5. origin/settings-notifications (c1d9e76)
Use the latest origin heads; if a head differs from the SHA above, use it and say so.
Fix the combination problems from A's report that apply here: favorites recent->frequent rename vs the tests added by api-input-validation and security-followups-3 (the tests must target the new route, sign in with a proper app_role and use uuid ids), the withApiErrors label on the renamed route, unused imports (e.g. computeBundleShipping), duplicate same-module imports.
Do NOT merge any of the five migration branches.
Gates: npm ci, lint (0 warnings), tsc, jest, next build, all green. Push bundle-features (normal push, no PR). Report in the last commit body: heads merged, conflicts and resolutions, combination fixes, gate results.

Do not touch the production database, Vercel, Stripe or secrets.
