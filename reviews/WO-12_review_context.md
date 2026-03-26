# WO-12 Review Context: Order Status History Audit Trail

## Summary
WO-12 implements the automatic `log_status_change()` trigger that captures every order status transition into `order_status_history`. It also corrects the `changed_by` column type (UUID → TEXT) and adds a timeline index. The `order_status_history` table itself was created in `20260317000002_create_v1_tables.sql`; the append-only RLS policies (DENY UPDATE/DELETE) were applied in `20260317000004_create_rls_and_triggers.sql`.

## Files Delivered
| File | Purpose |
|------|---------|
| `supabase/migrations/20260318000001_order_status_history_trigger.sql` | Column type fix, index, trigger function, trigger attachment |

## Acceptance Criteria Checklist

### Column Type Fix
- [x] `changed_by` altered from UUID to TEXT (`ALTER COLUMN changed_by TYPE TEXT USING changed_by::TEXT`) — accepts user UUIDs, webhook names (`stripe_webhook`), cron IDs (`sla-check-cron`), adapter IDs (`tier1-adapter`)

### Index
- [x] `idx_order_status_history_order_created` on `(order_id, created_at DESC)` — supports `WHERE order_id = X ORDER BY created_at DESC` timeline queries

### Trigger Function
- [x] `log_status_change()` created with `CREATE OR REPLACE FUNCTION`
- [x] Fires `AFTER UPDATE` on `orders` (safety net for direct DB updates that bypass `casTransition`)
- [x] Guards with `IF OLD.status IS DISTINCT FROM NEW.status` — no-op UPDATEs do not create spurious history rows
- [x] Inserts `order_id`, `old_status`, `new_status`, `changed_by`, `metadata`
- [x] `changed_by` = `current_setting('app.current_user', true)` — returns NULL when not set by application (direct DB ops, migrations)
- [x] `metadata` = NULL — rich metadata (`submission_id`, `tier`, `cascade_reason`, `webhook_event_id`) is written by `casTransition.writeStatusHistory()` in the application layer

### Trigger Attachment
- [x] `log_order_status_changes` trigger attached `AFTER UPDATE ON orders FOR EACH ROW`

### Dual-Write Design (intentional)
- [x] `casTransition.writeStatusHistory()` is the primary writer — provides rich metadata and actor from the application layer
- [x] `log_status_change()` trigger is the safety-net backstop — catches any direct `UPDATE orders SET status = ...` that bypasses `casTransition`
- [x] Both writers produce append-only rows; duplicate audit rows on a single transition are acceptable for HIPAA compliance

## Notable Deviation from Blueprint Spec
The blueprint trigger spec shows `NEW.metadata` in the trigger INSERT. The implementation uses `NULL` instead. Rationale: the trigger is a safety net for code paths that bypass `casTransition`; it cannot know the rich adapter metadata. Using `NULL` correctly signals "written by trigger, not by application layer." This is a correct and intentional deviation.

## Agent Review Result
**PASS** — All criteria met. Column type fix correct, index present, trigger guards against no-op UPDATEs, dual-write design well-reasoned for HIPAA compliance.

## Migration Reference
`supabase/migrations/20260318000001_order_status_history_trigger.sql`

## Commit
`9a2ea01` — feat: WO-12 - Order status history audit trail trigger
