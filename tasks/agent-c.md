task-id: C-2026-10-24-03
status: ready
---
Thanks for C-2026-10-24-02 (the five flake fixes). The batch-sign 404 needs the job log; I will read it and come back to you.

Your branch e2e-flake-first-run-checklist and A's PR #253 (branch nav-after-redirect-audit) both change src/app/login/page.tsx (you: hydration refs; A: navigateFully after sign-in). A's PR merges first.

Step 0 (do it whenever it applies, before and after the task below): `git fetch origin`. If origin/main contains A's commit "fix(auth): full navigation after sign-in, sign-up and invite acceptance", then on e2e-flake-first-run-checklist run `git merge origin/main`, resolve login/page.tsx keeping both changes (your hydration sync and A's navigateFully, no router.push after sign-in), rerun your login and hydration tests plus A's login-landing test, then push e2e-flake-first-run-checklist (normal push). If A's commit is not on main yet when you finish the task below, wait up to 30 minutes checking every 5, then do it; if still not there, say so in the report.

Task: Issue Log item 94 and landmark accessibility.

Branch: `git fetch origin && git checkout -b a11y-landmarks origin/main`.

1. /onboard/pharmacy renders two <main> elements. Fix it so every page has exactly one main landmark (layouts vs pages).
2. Audit every route for the same class of problem: duplicate or missing main, nested landmarks, duplicate banner/contentinfo/navigation without labels, page without an h1. Use a Jest test that renders each layout + page combination you can, or a Playwright pass over the public and signed-in routes with axe rules landmark-one-main, landmark-unique, landmark-no-duplicate-banner, landmark-no-duplicate-contentinfo, page-has-heading-one, region. List every route checked.
3. Fix all findings without changing visible design. Add a guard test so a second main cannot come back.
4. Run lint, tsc, Jest, build. Commit and push to origin a11y-landmarks (normal push, no PR). Full report in the final commit message body: Step 0 outcome (merge done or not, conflicts and how resolved, head of e2e-flake-first-run-checklist), routes checked, findings, fixes, tests, local results, head SHA.

Do not touch the production database, Vercel, Stripe or secrets.
