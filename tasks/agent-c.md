task-id: C-2026-10-26-04
status: ready
---
Thanks for C-2026-10-26-03 (password-flows fix verification, 380a96d). The order-transmission verification follows when A pushes.

Next: fix B's review of your phi-access-log-coverage (origin/review-hipaa-fixes, docs/qa/review-2026-10-26-hipaa-fixes.md, L1-L10). Read it first.
`git checkout phi-access-log-coverage && git pull`.
In B's recommended order:
1. L1 High: writes must not commit when the log write fails. Log first and answer 503 on failure (or log in the same transaction where the write is a single DB call). Signing paths first: batch-sign, proposal sign; then join, the Keragon webhook, favorites, order create/PATCH/DELETE, patient create and import, allergies, patient phases, checkout link, group link, group-and-send, reassign. If logging first would leave a log row for a write that then fails, mark it (outcome field or a follow-up row) using existing columns; no migration.
2. L6: a log call with no resolvable actor reports a failure (reportLogFailure('no_actor')) and /ops/fax does not render signed fax URLs when the actor cannot be resolved.
3. L3: import 422 and /validate: log the disclosure of the echoed rows (bounded) before answering.
4. L4: the dashboard chosen-plan queue: include those patients in the logged set (and check whether a provider should see other providers' patients there at all; if RLS allows it by design, keep it and say so).
5. L2: logPhiDisclosure before every Twilio messages.create.
6. L5: deduplicate list-view logging per actor, patient and resource per 15 minutes (in memory per instance is not enough on Vercel; use an existing table/cache if one fits, else a conservative in-request dedupe plus bounded queries, and say what remains); one array insert for the ops fax queue; bound the dashboard orders query.
7. Lows L7-L10 and the favorites raw error.message in 500 bodies (replace with generic messages, log the detail server-side without PHI).
No migration. Tests: jest for each (log fails -> write does not happen; dedupe; no_actor alert; Twilio disclosure row).
Gates: lint (0 warnings), tsc, jest, next build. Push phi-access-log-coverage (normal push, no PR). Report in the commit body. D will re-merge it into bundle-hipaa.

Do not touch the production database, Vercel, Stripe or secrets.
