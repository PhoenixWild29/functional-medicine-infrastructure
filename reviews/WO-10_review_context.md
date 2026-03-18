# WO-10 Review Context: Compare-And-Swap (CAS) Transition Pattern

## Summary
WO-10 implements the CAS (Compare-And-Swap) pattern for all order state transitions, preventing race conditions between concurrent webhooks, cron jobs, and user actions. Pure TypeScript — no new DB schema.

## Files Delivered
| File | Purpose |
|------|---------|
| `src/lib/orders/cas-transition.ts` | CAS transition helper, RPC wrapper, status history write, logging |

## Acceptance Criteria Checklist

### Core CAS Pattern
- [x] `casTransition()` exported — accepts `{ orderId, expectedStatus, newStatus, actor, metadata? }`
- [x] Returns `{ success: boolean, wasAlreadyTransitioned: boolean, orderId: string }`
- [x] CAS UPDATE uses both `.eq('order_id', orderId)` AND `.eq('status', expectedStatus)` — second eq is the CAS predicate
- [x] 0-row result treated as `{ success: true, wasAlreadyTransitioned: true }` — NOT an error
- [x] `canTransition()` from state-machine.ts called before DB update — throws on illegal transitions
- [x] Uses `createServiceClient()` (service role) throughout — not the browser client

### Status History
- [x] `writeStatusHistory()` called ONLY on live transitions — never on no-ops
- [x] Insert includes: `order_id`, `old_status`, `new_status`, `changed_by` (actor), `metadata`
- [x] History write failure is non-fatal — logs error but does not throw (transition already committed)

### Logging
- [x] `[CAS] ... | APPLIED` logged on live transitions
- [x] `[CAS] ... | NO-OP (already transitioned)` logged on no-ops

### RPC Wrapper
- [x] `casTransitionRpc()` exported — accepts `{ orderId, expectedStatus, newStatus, actor, rpcName, rpcArgs? }`
- [x] Forwards `p_order_id`, `p_expected_status`, `p_new_status`, `p_actor` + `rpcArgs` to Postgres function
- [x] Interprets RPC return value `'no-op'` as `wasAlreadyTransitioned: true`

### Race Conditions Documented
- [x] Payment Confirmation Race: `payment_intent.succeeded` webhook vs 72h expiry cron both attempt `AWAITING_PAYMENT → *`
- [x] Duplicate Webhook Race: Stripe/Documo/Pharmacy retry on timeout — CAS is second line of defence after `webhook_events` idempotency check
- [x] Adapter Cascade Race: Tier 1 failure handler + cascade-to-Tier-4 in parallel

## Agent Review Result
**PASS** — All 13 criteria passed clean.

## Commit
`4ca4484` — feat: WO-10 - Compare-And-Swap (CAS) order transition pattern
