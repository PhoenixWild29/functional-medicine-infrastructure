task-id: C-2026-10-25-11
status: ready
---
Thanks for C-2026-10-25-10 (allergies and favorites lows, 080519a and 76a6964).

Next: one index migration for hot queries, prepared now, merged after the five queued migrations.

Branch: `git fetch origin && git checkout -b perf-indexes origin/main`.
- Inventory the hottest read paths (dashboard order lists and counts, order drawer, ops pipeline with its filters, Frequently used favorites, proposals by token/clinic, phi_access_log views, rate limit lookups, crons scanning orders by status/time). For each, the query shape (table, WHERE, ORDER BY) and the existing indexes that serve it (read every migration). List the ones with no supporting index.
- Include orders(provider_id, created_at DESC) for Frequently used (from your review), and any others that are clearly needed. No speculative indexes; each one must name the query it serves.
- Write supabase/migrations/20261024000008_perf_indexes.sql and its down file, matching the repo's migration conventions (check the last few migrations and their down files on the five queued branches: ops-fax-viewer-documo 000003, rls-user-write-lockdown-v2 000004, security-followups-2, signup-squatting, rate-limit-db for the numbers 000005-000007; confirm 000008 is the next free number across all branches and say so). Use CREATE INDEX IF NOT EXISTS. Say whether CONCURRENTLY is possible given how this repo applies migrations (transaction or not), and what that means for lock time on prod (table sizes are small: demo data).
- If a jest migration-order test pins the newest migration, update it.
Gates: lint (0 warnings), tsc, jest. Do NOT run it against any shared database. Push perf-indexes (normal push, no PR). Report in the commit body with the full SQL.

Do not touch the production database, Vercel, Stripe or secrets.
