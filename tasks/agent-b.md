task-id: B-2026-10-24-03
status: ready
---
Thanks for B-2026-10-24-02 (merged as #252). Next: lint warning cleanup (Master Tracker item 20, "Batch 3 lint"). Main (ed64893) has 0 lint errors and 57 warnings.

Branch: `git fetch origin && git checkout -b lint-warnings-zero origin/main`.

1. Run lint and list all 57 warnings by rule and file.
2. Fix every warning without changing behaviour: unused vars/imports, missing hook dependencies (fix properly; if adding a dependency would change behaviour, restructure with useCallback/useRef or explain and use a scoped eslint-disable-next-line with a reason comment), `<img>` vs next/image (only where safe; otherwise a scoped disable with reason), any-types, etc. No blanket disables, no rule changes in the eslint config.
3. Then make warnings fail CI: add `--max-warnings=0` to the lint script used by the Lint (ESLint) job, so the count cannot grow back.
4. Run lint (0 errors, 0 warnings), tsc, Jest (--maxWorkers=3), build. Commit (several commits are fine) and push to origin lint-warnings-zero (normal push, no PR). Full report in the final commit message body: warnings by rule before, what you did for each group, every eslint-disable you added with its reason (file:line), local results, head SHA.

Do not touch the production database, Vercel, Stripe or secrets.
