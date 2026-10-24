task-id: B-2026-10-24-04
status: ready
---
Thanks for B-2026-10-24-03 (opened as PR #254; CI running). Next: the two real bugs you found during the lint work.

Branch: `git fetch origin && git checkout -b ops-pipeline-tier-filter origin/main`. (Main does not yet have #254; keep this branch independent of it. If #254 merges while you work, `git merge origin/main` before pushing; with #254 in, lint must stay at 0 warnings.)

1. Ops pipeline reads a `tier` filter but never applies it (REQ-OPV-002). Find the requirement in the repo docs/specs, then make the filter actually filter: UI control, URL param, server query (or client filter if the list is client-side), counts that match the filtered rows, and a clear "Clear filters". Red tests first (Jest for the filter logic and the view; extend an existing ops pipeline E2E if one exists, with an assertion that only the chosen tier shows).
2. The formulations case ignores `ingredient_id`. Find where (you noted it), work out what the caller expects (filter formulations by ingredient), fix it, red test first. Check every caller still gets what it expects.
3. While in the ops pipeline, check the other filters (status, pharmacy, date) actually apply; fix any that do not, with tests.
4. Run lint (0 warnings), tsc, Jest (--maxWorkers=3), build. Commit and push to origin ops-pipeline-tier-filter (normal push, no PR). Full report in the final commit message body: the requirement text, root causes, fixes, files, tests, local results, head SHA.

Do not touch the production database, Vercel, Stripe or secrets.
