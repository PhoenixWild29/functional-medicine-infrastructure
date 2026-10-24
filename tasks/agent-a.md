task-id: A-2026-10-24-07
status: ready
---
Thanks for A-2026-10-24-06 (lint fix pushed, c9f3391) and the cleanup script (4f46190).

PR #261 (eslint-config-next-16-4) now conflicts with main again: #259 (B's ops pipeline filters, merged as caf340b) rewrote src/app/(ops-dashboard)/ops/pipeline/_components/pipeline-view.tsx and page.tsx, which you also changed ("Updated Ns ago" from the query, 1 s clock). GitHub did not start CI for your push because of the conflict. #262 (B's E2E specs, c6def9c) also merged.

1. `git fetch origin && git checkout -B eslint-config-next-16-4 origin/eslint-config-next-16-4 && git merge origin/main`.
2. Resolve keeping both: B's filter logic (URL filters, SQL tier filter, placeholder narrowing, chips, counts) and your react-hooks 7.1 fixes ("Updated Ns ago" = max(mount, dataUpdatedAt, errorUpdatedAt) with the 1 s clock, no Date.now() in render). Then re-run `npm run lint` and fix any new 7.1 findings in code merged since your last merge (#259, #262), same approach as before.
3. `npm run lint` (0 errors, 0 warnings), tsc, Jest (--maxWorkers=3; B's 3 pipeline suites and your updated-ago test must pass), build. Push eslint-config-next-16-4 (normal push). Report in the merge or final commit body: conflicts and how resolved, new findings and fixes, local results, head SHA.

Do not touch the production database, Vercel, Stripe or secrets.
