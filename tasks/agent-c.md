task-id: C-2026-10-25-12
status: ready
---
Thanks for C-2026-10-25-11 (perf-indexes 000008, 228c147). Clear and well argued.

Next: verify the bundle merge resolutions. A merge resolution that silently drops one side's change is the main risk left before these bundles go to prod. You did not build them, which is the point.

Bundles (origin): bundle-security (b4b2cf8, A), bundle-ci (2b67140, A, based on bundle-security), and bundle-features (B, based on bundle-security; review it once pushed, or its merge commits on B's branch if not yet pushed).
Each bundle's commit bodies and A's dry-run report (origin/dry-run-report, docs/qa/merge-dry-run-2026-10-25.md) say which files conflicted and how they were resolved.
For each merge commit in each bundle:
- List the conflicted files (git show --cc / git diff <merge>^1 <merge> and <merge>^2 <merge>).
- For each file, check that every intended change from BOTH parents survives in the result (or that its removal is deliberate and stated in the report). Pay most attention to: route handlers touched by error-boundaries + api-input-validation + security-followups-3 (wrapper, zod parse, auth/role gate, refuseCrossSite all present, in a sane order: cross-site and auth before parsing and before any read or write); E2E specs and playwright.config testMatch (no spec silently dropped from the run); ci.yml (no job or step lost); package.json/package-lock (no dependency lost that is still imported); global-error/error pages; the favorites rename.
- Also confirm every test file present on any source branch is present in the bundle (git ls-tree diff), unless deleted deliberately.
Report each problem with file:line, which parent's change was lost, and the fix. Confirm before reporting (read the code or run the relevant jest test). Do NOT push to the bundle branches.
Write docs/qa/bundle-resolution-review-2026-10-25.md on a new branch `bundle-review` from origin/main, push (normal push, no PR), summary in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
