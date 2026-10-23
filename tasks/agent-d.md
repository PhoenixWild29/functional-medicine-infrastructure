task-id: D-2026-10-23-02
status: ready
---
Sam's instruction: run your reviewed demo refresh SQL on the PRODUCTION Supabase database (project ref rhrgtwmeowicohclkxlz). Sam reviewed it and approved running it.

1. Use the file exactly as merged on main (PR #245): `git fetch origin main` and use `origin/main:scripts/demo/2026-10-23-sunrise-refresh.sql`. Confirm its blob SHA is 3378c04b90ada4a5f264fd5722985f37575f53f7 before running. Do not edit it.
2. Run it against project rhrgtwmeowicohclkxlz only, with a connection already available on this machine (Supabase CLI linked to that project, or a database URL already in your local env). Before running, confirm the target project ref is rhrgtwmeowicohclkxlz (not the E2E project). Never print, log or commit any password, key or connection string.
3. If no connection to that project is available on this machine, do not create one, do not ask for credentials: stop and report "no prod connection available".
4. Run it once. It is one transaction ending in COMMIT, followed by a check query.
5. Report the check query's result rows exactly (part, check_name, result). Expected: 67, 11, 0, 1, 4, 3, 16, 9, 0, 3 (the first two may be lower if an order already had app-written history). If it errored, report the error text; it rolls back.
6. No code changes, no branch, no PR. Put the report in a commit on a new branch `report/d-2026-10-23-02` containing only an empty commit (`git commit --allow-empty`) with the full report in the message body, and push that branch.
