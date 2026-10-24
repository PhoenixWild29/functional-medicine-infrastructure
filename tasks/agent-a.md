task-id: A-2026-10-24-04
status: ready
---
Thanks for A-2026-10-24-03 (fax viewer). Its migration 20261024000001 goes to Sam to run on prod before that PR merges; I handle that.

Step 0: main now has #253 and #254 (B: lint 57 warnings to 0, and `npm run lint` is `eslint . --max-warnings=0`, so ANY warning fails CI). `git fetch origin`, check out ops-fax-viewer-documo, `git merge origin/main`, resolve conflicts (B touched fax-triage-queue.tsx: a module-level NO_FAXES constant; keep both changes), then `npm run lint` must show 0 warnings, rerun tsc and the fax tests, push ops-fax-viewer-documo (normal push).

Task: bump eslint-config-next to match next 16.4.3 (D's follow-up). It pulls eslint-plugin-react-hooks 7.0.1 -> 7.1.1, whose React Compiler rules flag 5 sites plus about 16 set-state-in-effect warnings (D's list):
  - dashboard/_components/order-drawer.tsx:314 and :316 react-hooks/immutability (fetchGroupLink / fetchBundlableSiblings declared below the useEffect that calls them)
  - new-prescription/margin/_components/margin-builder-form.tsx:522 (x2) react-hooks/preserve-manual-memoization (wholesaleCents useMemo)
  - margin-builder-form.tsx:810 react-hooks/refs (clearSessionRef.current assigned during render)

Branch: `git checkout -b eslint-config-next-16-4 origin/main`.
1. Bump eslint-config-next (and only what it requires) to 16.4.3. Keep lockfile changes minimal; keep the libc markers on native optional packages.
2. Fix every new error and warning properly in code (move the fetchers above the effect or into useCallback, a ref-updating effect for the latest-ref pattern, fix the memo deps). No rule changes in eslint.config.mjs, no blanket disables; a scoped eslint-disable-next-line with a reason only where a fix would change behaviour, listed in the report.
3. Red tests first for any component whose code you restructure (behaviour unchanged).
4. `npm run lint` (0 errors, 0 warnings), tsc, Jest (--maxWorkers=3), build. Commit and push to origin eslint-config-next-16-4 (normal push, no PR). Full report in the final commit message body: Step 0 outcome and head of ops-fax-viewer-documo, versions before/after, every finding and fix (file:line), disables with reasons, local results, head SHA.

Do not touch the production database, Vercel, Stripe or secrets.
