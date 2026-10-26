task-id: A-2026-10-26-01
status: ready
---
Thanks for A-2026-10-25-17 (order-transmission-integrity, 2b9b69a).

Next: gap B5 from C's HIPAA evidence map (origin/review-high-risk, docs/compliance/technical-safeguards-evidence-2026-10-25.md): the signed-order freeze misses sig_text, quantity, refills, dispense and the other clinical columns. Read that section and the existing freeze (trigger or code) first.

Branch: `git fetch origin && git checkout -b signed-order-freeze origin/clinical-difference-saved` (it carries 000009; this migration is 000010 and merges after it). Then `git merge origin/order-transmission-integrity` so the freeze and the content hash agree on the same clinical column list (one shared list in code; the migration's column list must match it, and a jest test must assert they match).
- Migration supabase/migrations/20261024000010_signed_order_freeze.sql and its down file: extend the freeze so that once an order is signed (locked_at set), every clinical column the signature hash covers cannot change (raise with a clear message), except through the transitions that legitimately change them (list them from the code; e.g. none, or ops reroute changes pharmacy only before transmission? read the code and say). Status, tracking, payment and timestamps stay updatable.
- Confirm 000010 is the next free number across all origin branches.
- Follow the repo's migration conventions (BEGIN/COMMIT, comments, down file, apply_pharmacy_admin_scope if required).
- Check every code path that updates a signed order still works (ops reroute, refunds, status webhooks, retention nulling of payloads, Rx PDF regeneration). Run the full jest; list any path the trigger would now refuse.
PREPARED only: do NOT run it against any shared database. It merges after perf-indexes and clinical-difference-saved.
Tests: jest static test for the migration (columns match the shared list) and unit tests for any code changes.
Gates: lint (0 warnings), tsc, jest, next build. Push signed-order-freeze (normal push, no PR). Report in the commit body with the full SQL.

Do not touch the production database, Vercel, Stripe or secrets.
