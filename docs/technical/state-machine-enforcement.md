# Order state machine: what is enforced (investigation, 2026-10-25)

`src/lib/orders/state-machine.ts` declares three things:

1. `VALID_TRANSITIONS`: which status may follow which.
2. `TRANSITION_RULES`: which actor (clinic_admin, provider,
   medical_assistant, ops_admin, system) may make each transition.
3. `REQUIRED_FIELDS_ON_ENTER`: columns that must be set before an order
   enters a status.

`docs/technical/snapshot-immutability.md` said all three were enforced.
Read from the code on origin/main (2696ff2), only (1) was. `casTransition`
(`src/lib/orders/cas-transition.ts`) called `canTransition` and nothing
else. Its `actor` was a free-text label for the history row, and nothing
read `TRANSITION_RULES` or `REQUIRED_FIELDS_ON_ENTER` outside tests.

This file lists every real status write, then gives a verdict for each
rule.

## 1. Every order status write

### 1a. Through casTransition

| From | To | Who triggers it (code path) | Actor today | Actor rule holds? | Required fields hold? |
|---|---|---|---|---|---|
| AWAITING_PAYMENT | PAID_PROCESSING | Stripe `payment_intent.succeeded`, solo (`webhooks/stripe/route.ts` handleSoloPaymentSucceeded) | `stripe_webhook` (system) | yes | yes: the order is found BY `stripe_payment_intent_id` |
| AWAITING_PAYMENT | PAID_PROCESSING | Stripe, bundle (`webhooks/stripe/handle-group.ts`) | `stripe_webhook_group` (system) | yes | yes: the PI is stamped on every member before the CAS (line 158) |
| PAID_PROCESSING, REROUTE_PENDING | SUBMISSION_PENDING | routing engine claim (`lib/adapters/routing-engine.ts` routeOrder). Called by the Stripe webhook, cron `submit-paid-orders`, `api/adapters/route-order` and the ops reroute | `routing_engine` (system) | yes | **no**: `submission_tier` and `adapter_submission_id` are set AFTER the claim. The claim comes first on purpose (exactly-once submission). |
| SUBMISSION_PENDING | SUBMISSION_FAILED, FAX_QUEUED, PHARMACY_ACKNOWLEDGED, REROUTE_PENDING | routing engine (failSubmission, Tier 4 cascade, Tier 1 ack, reroute) | `routing_engine` (system) | yes | n/a |
| SUBMISSION_PENDING | FAX_QUEUED | cron `sla-check` (adapter ack timed out) | `sla_check_cascade` (system) | yes | n/a |
| PAID_PROCESSING | FAX_QUEUED | `lib/adapters/tier4-fax.ts` (legacy path; a no-op once the routing engine has claimed) | `tier4_fax_adapter` (system) | yes | n/a |
| FAX_QUEUED | FAX_DELIVERED, FAX_FAILED | Documo webhook (`webhooks/documo/route.ts`) | `documo_webhook` (system) | yes | n/a |
| FAX_QUEUED | FAX_FAILED | routing engine (fax send failed) | `routing_engine` (system) | yes | n/a |
| FAX_DELIVERED | PHARMACY_ACKNOWLEDGED, PHARMACY_REJECTED | ops fax triage (`api/ops/fax/[faxId]/action`) | the ops user's email (ops_admin) | yes | n/a |
| SUBMISSION_PENDING | PHARMACY_ACKNOWLEDGED | pharmacy webhook `order.confirmed` | `pharmacy_webhook` (system) | yes | n/a |
| PHARMACY_ACKNOWLEDGED | PHARMACY_COMPOUNDING | pharmacy webhook (`order.compounding`, and on the way to shipped) | `pharmacy_webhook` (system) | yes | n/a |
| PHARMACY_COMPOUNDING, PHARMACY_PROCESSING | READY_TO_SHIP | pharmacy webhook (on the way to shipped) | `pharmacy_webhook` (system) | yes | n/a |
| READY_TO_SHIP | SHIPPED | pharmacy webhook `order.shipped` | `pharmacy_webhook` (system) | yes | **no**: the webhook writes tracking and carrier only if the pharmacy sent them, and ships anyway, with a warning |
| ACK, COMPOUNDING, PROCESSING | PHARMACY_REJECTED | pharmacy webhook `order.rejected` | `pharmacy_webhook` (system) | yes | n/a |
| PHARMACY_ACKNOWLEDGED | PHARMACY_PROCESSING (and illegal targets, see 1c) | cron `portal-status-poll` (Tier 2) | `portal_status_poll` (system) | yes | n/a |
| READY_TO_SHIP | SHIPPED | ops "Add tracking" (`api/ops/orders/[orderId]/action` add_tracking) | `ops:<email>` (ops_admin) | yes | yes: tracking and carrier are required in the request and written first |
| any non-terminal | CANCELLED | ops cancel (cancel_refund, nothing paid) | `ops:<email>` (ops_admin) | **no for DRAFT**: the rule allows clinic_admin and provider only. From AWAITING_PAYMENT, PAYMENT_EXPIRED and the error and failed states it holds. | n/a |
| any non-terminal | REFUND_PENDING | ops cancel (cancel_refund, paid) | `ops:<email>` (ops_admin) | yes | n/a |
| REFUND_PENDING | REFUNDED | ops cancel, when Stripe refunds at once | `ops:<email>` (ops_admin) | **no**: the rule allows system only | n/a |
| REFUND_PENDING | REFUNDED | cron `refund-retry`; Stripe `charge.refunded` | `cron:refund-retry`, `stripe_webhook` (system) | yes | n/a |
| SUBMISSION_FAILED | REROUTE_PENDING | ops "Retry submission" (claim, then routeOrder) | `ops:<email>` (ops_admin) | yes | n/a |
| SUBMISSION_FAILED, FAX_FAILED, REROUTE_PENDING | FAX_QUEUED | ops "Send by fax" | `ops:<email>` (ops_admin) | yes | n/a |

An illegal from/to pair already throws in casTransition (canTransition).

### 1b. Writes to orders.status that do NOT go through casTransition

| Write | From, To | Who | Notes |
|---|---|---|---|
| `src/lib/orders/batch-sign.ts` signBatch | DRAFT to AWAITING_PAYMENT | the signing provider (sign page, sign-and-send, protocol choice sign) | One UPDATE over every line of the batch, with locked_at and the signature hash. A partial sign is treated as critical, so it cannot become per-order CAS calls. The required snapshots hold: every DRAFT is created by POST /api/orders with all six set (patient state and provider NPI are required there). |
| `src/app/api/cron/payment-expiry/route.ts` | AWAITING_PAYMENT to PAYMENT_EXPIRED | cron (system) | Its own CAS predicate and its own history row. Same shape as casTransition. |
| `src/app/api/ops/orders/[orderId]/action/route.ts` reroute | SUBMISSION_FAILED, FAX_FAILED, PHARMACY_REJECTED (its REROUTABLE list) to REROUTE_PENDING | ops | One UPDATE: the status, reroute_count + 1 and the new pharmacy, on purpose (BLK-05), plus its own history row. |
| `src/lib/proposals/expire.ts` | DRAFT to CANCELLED (bulk, a plan's lines) | cron `proposal-expiry` (system) | `.eq('status','DRAFT')`, with history rows. |
| `src/lib/proposals/propose.ts` cancelProposal | DRAFT to CANCELLED (bulk) | the provider or a clinic admin cancelling a plan (a medical assistant is refused) | Same. |
| `src/lib/proposals/sign-choice.ts` | DRAFT to CANCELLED (bulk, the unchosen lines) | the provider signing the patient's choice | Same. |

No SQL function or RPC changes orders.status. Not counted as transitions:
- the INSERT of a new DRAFT (POST /api/orders);
- the POC demo-data refresh (`lib/poc/refresh-demo-data.ts`), which rebuilds demo rows;
- writes to `payment_groups.status` and `adapter_submissions.status`.

### 1c. Found on the way (not changed here)

`cron/portal-status-poll` maps portal text to `PHARMACY_READY`, which is
not a status, and maps "shipped", "rejected", "delivered" and "cancelled"
to transitions that are illegal from PHARMACY_ACKNOWLEDGED. Those
attempts already throw in canTransition. So a Tier 2 order never gets
past PHARMACY_PROCESSING from the poll. This is listed for Sam.

## 2. Verdict per rule: would enforcing it break a real flow today?

### Required fields

| Status | Fields | Breaks a flow? | Decision |
|---|---|---|---|
| AWAITING_PAYMENT | the 6 snapshots + locked_at | no | Enforce. In casTransition (no path reaches it there today), and in batch sign as a pre-check before anything is written. |
| PAID_PROCESSING | stripe_payment_intent_id | no | Enforce in casTransition |
| SUBMISSION_PENDING | submission_tier, adapter_submission_id | **yes**: every submission (the claim precedes the submission row) | The code is right (exactly-once). Correct the rule: nothing is required on entering SUBMISSION_PENDING. |
| SHIPPED | tracking_number, carrier | **yes**: a pharmacy `order.shipped` webhook without tracking | Leave unenforced. For Sam. |

### Actors

| Transition | Breaks a flow? | Decision |
|---|---|---|
| DRAFT to CANCELLED (clinic_admin, provider) | **yes**: ops cancel of a draft (cancel_refund accepts any non-terminal status); the proposal expiry cron (system). A clinic admin or provider cancelling a plan already holds; a medical assistant cannot (propose.ts actorFor 'manage' refuses). | Correct the rule to who really cancels drafts: clinic_admin, provider, ops_admin, system |
| REFUND_PENDING to REFUNDED (system) | **yes**: the ops cancel that refunds at once | Correct the rule: ops_admin or system |
| every other transition in the table | no | Enforce in casTransition |

The actor check needs the actor's role, and casTransition's `actor` is a
history label (`ops:<email>`, `routing_engine`, ...). So callers now pass
`actorRole` explicitly, and the label stays as it is.

## 3. What was done (part 2)

- `casTransition` enforces actors (`actorRole`, now required on every
  call) and `REQUIRED_FIELDS_ON_ENTER`, inside its UPDATE's WHERE clause.
  A refusal throws `CasTransitionRefused` with a code, and writes nothing.
- The rules corrected to the real flows:
  - DRAFT to CANCELLED: clinic_admin, provider, ops_admin, system;
  - REFUND_PENDING to REFUNDED: ops_admin or system;
  - SUBMISSION_PENDING: nothing required on entry.
- SHIPPED's tracking moved to `UNENFORCED_REQUIRED_FIELDS_ON_ENTER`, for
  Sam.
- Routed through `casTransition`:
  - the payment-expiry cron;
  - the ops reroute, with the new `patch` option, so the status,
    reroute_count and pharmacy stay one UPDATE.
- Batch sign stays one UPDATE. `canSign` (the read-only half) now refuses
  a line missing a required snapshot ('missing_snapshot') before anything
  is written.
- The proposal cancels stayed direct in part 2 (several orders in one
  UPDATE, with a clinic predicate). They now go through casTransition: see
  section 4.

## 4. After C's review (B-2026-10-25-08)

- The proposal cancels (expire, cancel, sign-choice) now go through
  `casTransition` too, one line at a time (`lib/proposals/cancel-lines`):
  - the expiry cron as `system`;
  - a cancel as the caller's role;
  - a sign as the signer's role.
  casTransition writes each history row. A line that left DRAFT is a no-op,
  and a refused line is reported without stopping the others. The lines
  are still read for the clinic (expire by the plan's options; cancel with
  the clinic predicate; sign from the lines it loaded for the clinic).
  Batch sign is now the only status write outside casTransition.
- `casTransition` takes an optional `client`, so a caller handed a client
  (and its tests) keeps using it.
- The refused-then-re-read race (`casTransition`):
  - when the UPDATE is refused and the re-read finds the order still in
    the expected status with every required field set (another writer set
    it in between), the UPDATE runs once more;
  - "already transitioned" is reported only when the status really moved;
  - if it is still there, complete, and will not move, it throws
    "kept changing ... Retry".
- `scripts/checks/2026-10-25-drafts-missing-snapshots.sql`: a read-only
  count of active DRAFT orders missing any snapshot batch sign requires,
  per clinic, with the Sunrise order ids.
