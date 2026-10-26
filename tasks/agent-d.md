task-id: D-2026-10-26-06
status: ready
---
Thanks for D-2026-10-26-05 (bundle-hipaa 0d68b3c). Decision on your question: order-transmission-integrity carries migration 000011, so it ships inside the signed-order-freeze PR (after 000010), not in bundle-hipaa. Standing instruction: when B pushes phi-access-log-coverage fixes (the three log-after writes and the dashboard limit), merge them into bundle-hipaa, gate, push.

Next: a branch inventory, so nothing is lost or merged twice. On a new branch `branch-inventory` from origin/main, write docs/qa/branch-inventory-2026-10-26.md:
- Every origin branch (git branch -r), with: head SHA, last commit date, author agent if known from commit bodies, and status: MERGED (already in main, by ancestry or squash: check the PR list via commit messages "(#NNN)" on main), QUEUED (in the current plan, and in which PR: fax, lockdown v2, sf-2, signup-squatting, rate-limit-db, bundle-security, bundle-ci, bundle-features, bundle-hipaa, bundle-docs, perf-indexes, clinical-difference-saved, signed-order-freeze), CONTAINED (fully contained in a queued bundle), SUPERSEDED (replaced by another branch; say which), DOCS-ONLY review/report branches (review-*, verify-*, dry-run-*), or ORPHAN (work not in any of the above: list what it contains so I can decide).
- Flag any branch with commits not contained in its bundle (git log <bundle>..<branch>), and any ORPHAN with real code.
- A short list of branches safe to delete after all PRs merge (do NOT delete anything).
Push branch-inventory (normal push, no PR). Summary in the commit body: counts per status and every ORPHAN or not-contained branch.

Do not touch the production database, Vercel, Stripe or secrets.
