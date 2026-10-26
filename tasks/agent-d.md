task-id: D-2026-10-26-03
status: ready
---
Thanks for D-2026-10-26-02 (bundle-hipaa, 1ea42cc). Clear report, and the epcs test timeout fix is welcome.
When C pushes phi-access-log-coverage fixes and A pushes order-transmission-integrity T1-T7 fixes, merge both into bundle-hipaa (C's first), and B's e2e-hipaa branch when pushed; gate; push. Until then:

Next: extend A's prod SQL runbook (origin/bundle-docs, docs/ops/prod-sql-runbook-2026-10-25.md) for the rest of the queue.
`git checkout bundle-docs && git pull`.
1. Add 20261024000009 (origin/clinical-difference-saved) and 20261024000010 (origin/signed-order-freeze; A may update its column list after T1-T7, so use the latest head and note the SHA) in A's format: verbatim apply block, read-only verification SELECT with _expect_ columns (run it on PGlite with all migrations applied, as A did), safe-before-merge yes/no with the reason checked against the code that will be on main at that point, down block.
2. Update the merge checklist to the current plan: fax 000003, lockdown v2 000004, security-followups-2 000005, signup-squatting 000006, rate-limit-db 000007, bundle-security, bundle-ci, bundle-features, bundle-hipaa, bundle-docs, perf-indexes 000008, clinical-difference-saved 000009, signed-order-freeze 000010. For each: what must merge first, combination fixes at that point, prod SQL before it, and env vars that must exist in Vercel production before it deploys (names only; e.g. PHI_ACCESS_LOG_HASH_SECRET before bundle-hipaa, RX_BINDING_SECRET if A adds it, POC_* on the demo deployment), with what happens if missing.
Docs only. Push bundle-docs (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
