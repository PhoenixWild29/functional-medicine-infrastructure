task-id: D-2026-10-26-10
status: ready
---
Thanks for D-2026-10-26-09 (bundle-hipaa dcd6b60, all green; items 4 and 1 done).

Next: bring the two operational docs up to the final plan, so merge day has one correct source.
1. `git checkout bundle-docs && git pull`, docs/ops/prod-sql-runbook-2026-10-25.md:
   - Merge order (final): fax 000003, lockdown v2 000004, security-followups-2 000005, signup-squatting 000006, rate-limit-db 000007, bundle-security, bundle-ci, bundle-features, bundle-hipaa, bundle-docs, perf-indexes 000008, clinical-difference-saved 000009, signed-order-freeze 000010 + 000011. Not in the plan: rls-aal2 000012 (decision-gated), tailwind4 (prepared, Sam to agree), middleware-to-proxy #266 (hold), demo-payouts-live-key-guard H1 (Sam).
   - Add 000011 (order_signing_snapshots) in A's format if missing, from origin/signed-order-freeze's latest head (note the SHA); add 000012 as an appendix marked DECISION-GATED with its switch statement.
   - Env vars table (names only), with where (Production / Preview / demo deployment), before which PR, and what happens if missing: PHI_ACCESS_LOG_HASH_SECRET, RX_BINDING_SECRET, RX_LEGACY_CUTOFF, RX_BINDING_SECRET_PREVIOUS (rotation only), POC_* (demo deployment), REQUIRE_MFA (decision).
   - The combination fixes from C's dry run 2 that remain, per PR, marking which are already pre-resolved (items 1, 3, 4 per your reports).
   - The Supabase dashboard settings from docs/ops/session-timeout.md (rls-aal2 branch) as a post-merge checklist item for Sam.
2. `git checkout docs-run-sheet-v3 && git pull`: in docs/qa/whats-new-since-oct5-source.md, add the payment-link sign-in gap fix and the faster, more reliable test runs (one line each, plain words), and note the two-step sign-in database change is ready pending Sam's decision.
Docs only. Push both (normal push, no PR). Report in the commit bodies; I will re-merge docs-run-sheet-v3 into bundle-docs at merge time.

Do not touch the production database, Vercel, Stripe or secrets.
