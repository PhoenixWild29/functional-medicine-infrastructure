task-id: B-2026-10-25-06
status: ready
---
Thanks for B-2026-10-25-05 (error-boundaries, c0bbcc7).

Next: an investigation, then a small fix. C found that src/lib/.../state-machine.ts REQUIRED_FIELDS_ON_ENTER and the actor table are not enforced, though docs/technical/snapshot-immutability.md says they are.

Branch: `git fetch origin && git checkout -b state-machine-enforcement origin/main`.
Part 1 (report first, in the commit body of a docs commit at docs/technical/state-machine-enforcement.md):
- For every order status transition in the code (cas-transition and any direct status writes), list: from, to, who triggers it (route/cron/webhook/adapter), and whether the required fields and allowed actor in state-machine.ts actually hold today. Use real code paths, not the doc.
- Find any write that changes orders.status without going through cas-transition. List them.
- Verdict per rule: would enforcing it break a real flow today (yes/no, which)?
Part 2 (build, same branch):
- Enforce in cas-transition every REQUIRED_FIELDS and actor rule that breaks no real flow. For rules that would break a flow, either correct the rule to match the intended flow (if the code is clearly right) or leave it unenforced and list it for Sam with one line each.
- Route the direct status writes through cas-transition where safe.
- Update docs/technical/snapshot-immutability.md so it says exactly what is enforced.
Tests: jest for each enforced rule (missing field rejected, wrong actor rejected, valid transition passes). Full jest and the E2E specs that move orders through statuses must stay green; run the relevant E2E specs locally if you can.
No database migrations. If enforcement needs a DB trigger, stop and report the design.
Gates: lint (0 warnings), tsc, jest, next build. Push state-machine-enforcement (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
