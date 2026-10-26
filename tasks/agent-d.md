task-id: D-2026-10-26-02
status: ready
---
Thanks for D-2026-10-26-01 (access review fixes, 7ef4590).

Next: build bundle-hipaa, the bundle PR for the HIPAA fixes and Help. It merges after bundle-features.

`git fetch origin && git checkout -b bundle-hipaa origin/bundle-features`.
Merge with `git merge --no-ff`, latest origin heads, in this order:
1. origin/clinic-help
2. origin/password-flows (B's fixes on top of yours)
3. origin/auth-monitoring (C's fixes on top of B's)
4. origin/audit-review-breakglass (already contains phi-access-log-coverage; confirm origin/phi-access-log-coverage has nothing newer than what you merged; if it does, merge it too)
5. origin/order-transmission-integrity ONLY after A pushes its T1-T7 fixes (A is on them now). If they are not pushed when items 1-4 are done and gated, push bundle-hipaa without it, say so, and merge it in a follow-up commit when A pushes.
Do NOT merge any migration branch (clinical-difference-saved 000009, signed-order-freeze 000010, perf-indexes 000008, or the five queued ones).
phi-access.ts and the auth routes are edited by several branches: keep every side's change; resolve once; list each resolution.
Gates: npm ci, lint (0 warnings), tsc, jest, next build, all green. Push bundle-hipaa (normal push, no PR). Report in the last commit body: heads merged, conflicts and resolutions, gate results, and every new env var the bundle needs in production (names only: e.g. PHI_ACCESS_LOG_HASH_SECRET, RX_BINDING_SECRET, POC_* for demo only), with what happens if each is missing.

Do not touch the production database, Vercel, Stripe or secrets.
