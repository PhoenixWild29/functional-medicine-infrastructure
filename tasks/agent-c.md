task-id: C-2026-10-26-06
status: ready
---
Thanks for C-2026-10-26-05 (dry run 2, 5bb3a7c). Very useful.

Next: clear two orphans from D's branch inventory (origin/branch-inventory, docs/qa/branch-inventory-2026-10-26.md).
1. Dependabot PR #272 (dependabot/npm_and_yarn/npm_and_yarn-e7c415db2f, c8b0864b): what does it bump, from and to, and why (advisory ids)? Is it safe with the planned bundles (check package.json/lock on bundle-ci, which has the libc fix)? If safe and worthwhile, apply the same bump on bundle-ci (you may push to bundle-ci; A built it but is on other work; keep the 20 libc markers, never regenerate the lockfile on Windows) with gates green, and say so; then #272 can be closed after bundle-ci merges.
2. request-access (a7f9f083): confirm it is fully superseded by self-serve sign-up on main (compare what access_requests would have stored with what self_serve_signup stores). If superseded, say so; if anything is missing, list it.
Report in a commit on a new branch `orphans-review` from origin/main at docs/qa/orphans-review-2026-10-26.md, push (normal push, no PR), summary in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
