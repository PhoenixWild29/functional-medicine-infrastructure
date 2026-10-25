task-id: A-2026-10-25-06
status: ready
---
Thanks for A-2026-10-25-05 (rate-limit-db, 3c4791c). PR in turn.

Next: CI hygiene. Every CI run warns: "Node.js 20 is deprecated... actions/cache@v4, actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4 are being forced to run on Node.js 24" and "ubuntu-latest will migrate to Ubuntu 26 beginning October 19, 2026".

Branch: `git fetch origin && git checkout -b ci-actions-node24 origin/main`.
1. Bump every action in .github/workflows/*.yml to the current major that runs on Node 24 (checkout, setup-node, cache, upload-artifact, download-artifact, any others), reading each action's release notes for breaking changes (e.g. upload-artifact v4->v5 behaviour, cache key changes) and adjusting inputs.
2. Pin the runner image explicitly where a job depends on OS packages (the E2E job: Playwright OS deps, supabase CLI binary) so the Ubuntu 26 migration cannot silently change it: e.g. ubuntu-24.04 now, with a comment on when to move. If your ci-playwright-container branch (container image) merges first, keep that consistent.
3. Keep deploy.yml / rollback.yml behaviour identical (supabase/setup-cli pin etc.).
4. You cannot run Actions locally: validate YAML (actionlint via npx if available) and say what the first PR run must confirm.
5. Push ci-actions-node24 (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe, repository settings or secrets.
