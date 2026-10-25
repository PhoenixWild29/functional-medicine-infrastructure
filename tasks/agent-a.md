task-id: A-2026-10-25-11
status: ready
---
Thanks for A-2026-10-25-10 (merge dry run, 0508fd3). Exactly what was needed.

Decision (orchestrator): the five migration branches stay separate PRs, in order (ops-fax-viewer-documo, rls-user-write-lockdown-v2, security-followups-2, signup-squatting, rate-limit-db). Everything else merges as a few bundle PRs, so we run 3 or 4 E2E runs instead of 25. Build the bundles now from your dry-run resolutions.

Each bundle: `git fetch origin && git checkout -b <bundle> origin/main`, then `git merge --no-ff origin/<branch>` for each branch in the order given, reusing your recorded resolutions. Do NOT merge the five migration branches into any bundle (main does not have them yet; the bundles will merge main after them). Fix every combination problem from your report that applies within the bundle (problems 1, 3, 4, 5, 6; problem 2 applies only after the fax PR merges, so leave a note in the bundle's report for it).

1. bundle-security: error-boundaries, api-input-validation, security-followups-3, token-pages-hardening, checkout-token-out-of-url.
2. bundle-ci: flake-show-checklist, ci-playwright-container, remove-dead-code, e2e-axe-all-routes, e2e-shard-ready, perf-bundles, test-data-cleanup-script, ci-actions-node24 (bump the e2e-sharded-trial job's actions too), todo-sweep, patient-pages-mobile. Base it on bundle-security instead of main if that removes conflicts (say which you did; if based on it, it merges after it).
3. bundle-docs: docs-oct25, docs-prod-clickthrough, docs-requirements-coverage, docs-run-sheet-v3, review-high-risk, dry-run-report. Docs only; confirm no non-docs file changes (it must skip E2E).
The feature branches (rx-quantity-shipping, rx-allergies-required, favorites-frequent, state-machine-enforcement, settings-notifications) are still being fixed by B, C and D. Do NOT include them yet; I will queue bundle-features when they are pushed.

For each bundle: gates (npm ci, lint 0 warnings, tsc, jest, next build) green. Push each bundle (normal push, no PR). Report in each bundle's last commit body: branches merged with their head SHAs, conflicts resolved, combination fixes made, gate results. Keep your integration-dry-run branch local.

Do not touch the production database, Vercel, Stripe or secrets.
