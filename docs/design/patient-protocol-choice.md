# Design: patient chooses a protocol before paying

Status: **design only, nothing built.** Task D-2026-10-24-01. Written 2026-10-24 against main `bea7c3b`.

## What we are building, and where it came from

A provider proposes one or more treatment options to a patient (each option usually a protocol, i.e. several prescriptions). The patient opens a secure link on their phone, picks the option they want to start, unticks any optional items they cannot afford yet, and only then is anything signed, paid for or sent to a pharmacy.

The source is the 2026-09-11 product run-through (`docs/practitioner-feedback/2026-09-11-product-run-thru-transcript.md`):

- Lauren, line 2635: the patient gets their protocol and can "uncheck anything that they don't want to pay for", then pays for the rest.
- Lauren, line 1376: let the provider "star like must do" items, so the patient can start with the musts and add the rest later.
- Lauren, line 1357: cash-pay patients may not be able to afford everything at once, so they "pick the things" they will start.
- Gina, line 1323 onward: providers do not screen-share during visits, so the patient needs their own view after the consult.

It was deferred on 2026-09-14 (`docs/phase21-practitioner-feedback-workorders.md:520`): "Patient-facing protocol review: provider marks must-haves, patient unchecks items before paying. Depends on WO-105 and the payment-group model." Both dependencies are now on main.

The sources describe unticking items **within** one protocol. The task adds choosing **between** two or more protocols. This design does both: a proposal has one or more **options**; each option has **required** items (always included) and **optional** items (the patient may untick them).

## How the app works today (facts this design builds on)

- **One DRAFT order per prescription line.** Protocols are loaded into the new-prescription session client-side (`quick-actions-panel.tsx:338-431`). Nothing is stored until Review, which `POST /api/orders` once per line (`batch-review-form.tsx:768-791`), creating DRAFTs with price, medication, state, NPI and pharmacy snapshots. If the line came from a protocol, `resolveProtocolLinkage` links it to a `protocol_instance` (`src/lib/protocols/resolve-instance.ts`).
- **Signing is one all-or-nothing step** (`src/lib/orders/batch-sign.ts`, "the only way an order is signed"):
  1. `checkBatch` runs the checks: prescriber NPI and state license (C4), pharmacy licensure and sterile scope (C5), controlled substances refused outright (C6), compounding status (C8), price moved or below cost, intake pending, and that the allergy and interaction checks can run.
  2. Shipping is allocated.
  3. A payment group is created for 2+ orders, with its Stripe PaymentIntent and fixed amount.
  4. The orders go DRAFT → AWAITING_PAYMENT with `locked_at` and the signature hash, which freezes the snapshots (the `prevent_snapshot_mutation` trigger).
  5. The payment-link SMS goes out.
- **Nothing reaches a pharmacy before payment.** Routing starts only from `payment_intent.succeeded` (AWAITING_PAYMENT → PAID_PROCESSING → `routeOrder`). Unpaid orders expire after 72h (`/api/cron/payment-expiry`).
- **Patient checkout is no-login.** It uses an HS256 JWT checkout token (`src/lib/auth/checkout-token.ts`, verified in `src/middleware.ts:135-180`). The page shows totals and a prescription count but **no medication names** (REQ-GCX-004/008).
- **SMS never names a medication or the clinic.** The payment-link text is `templates.ts:87`, enforced by `opt-in-gate.test.ts`.
- **Intake links are stored, single-use tokens.** They are random, hashed, have a 72h TTL, and a new link revokes the open one (`src/lib/intake/token.ts`, `links.ts`). They are the better precedent for a revocable patient link.

## 1. Provider flow

1. **Build.** The provider builds prescriptions in the new-prescription session exactly as today: protocols, favorites and single lines. One new control on Review groups lines into **options** (Option A, Option B, ...), each with a patient-facing label the provider types, for example "Foundation plan".
   - By default each loaded protocol becomes its own option. A one-option proposal is allowed and is the common case: the "uncheck what you can't afford" flow from the transcript.
   - Each line gets a **Required** star, on by default; the provider turns it off for "nice to have" items.
2. **Check.** Review runs **every signing check except the signature** before the proposal can be sent: C4, C5, C6, C8, price, intake and allergy/interaction. This means `checkBatch` is split into a read-only "would this sign?" function used by both propose and sign. It is already read-only by design; it just needs its own entry point.
   - An item that could not be signed is never offered to the patient. Controlled substances therefore can never appear in a proposal.
3. **Send.** "Send to patient for choice" replaces "Sign & Send" for this path.
   - It stores the proposal and the DRAFT orders, tagged to their option. Nothing is signed and no payment group or PaymentIntent is created.
   - It sends the patient an SMS link (section 2).
   - The dashboard shows the orders under a new **Proposed** state, not under Drafts, with "Awaiting patient choice".
4. **The patient chooses** (section 2). The provider gets "Jordan chose Foundation plan (3 of 4 items)" in the existing signature queue (WO-77), and the clinic gets an in-app notification.
5. **Sign.** The provider opens the chosen lines and signs them with the existing batch sign. That is the first and only signature.
   - Batch sign runs every check again, allocates shipping, creates the payment group (2+ items) and sends the existing payment-link SMS.
   - Unchosen items go DRAFT → CANCELLED, which the state machine already allows; they are never signed.
   - From here the flow is exactly today's: pay → PAID_PROCESSING → pharmacy.

What is signed, and when: **only the items the patient chose, by the provider, after the choice.** The proposal itself is not a prescription and carries no signature.

What can never happen:
- A pharmacy gets nothing before the patient chooses and pays, because routing still starts only from `payment_intent.succeeded`.
- No order is signed that the patient did not choose.

## 2. Patient flow (phone, no login)

1. **The text.** The SMS follows the C1 rules: first name, provider's last name, link, nothing else. For example: "Hi Jordan, Dr. Chen has a treatment plan ready for you to review: {{link}} Reply STOP to opt out."
   - No medication, no clinic name, no "prescription". It gets a new template beside `templates.ts:87`, under the same test.
2. **The link.** `/plan/{token}` uses an intake-style token: 32 random bytes, only the SHA-256 stored, a TTL, revocable.
   - A stored token rather than a JWT, because the provider must be able to revoke it (edit or cancel the proposal), it must die once the choice is signed, and it carries a choice, not just a view.
   - Re-sending revokes the previous link.
3. **The identity check.** This page names medications, which the checkout page deliberately does not. So the page asks for **date of birth** before showing anything. Five wrong tries lock the link, and the clinic sees "locked".
   - Before the check, the page shows only "Your provider has a plan ready" and the clinic logo.
4. **What they see.** One card per option, showing:
   - its label;
   - each item as medication name, form and strength, a plain-language direction (the sig), the quantity / days' supply, and its price;
   - required items locked on, with an "Included: your provider marked this as essential" note;
   - optional items as checkboxes, ticked by default as in the transcript.

   A running total updates as they untick: subtotal + shipping (once per pharmacy, using the same `computeBundleShipping`) = total. It reads "estimate: final price confirmed when your provider approves" (see open question 6).
5. **The choice.** The patient taps **"Choose this plan"**, sees a confirmation of the items and total, and confirms. The confirmation page reads: "Sent to Dr. Chen for final approval. You'll get a text with a secure payment link, usually the same day."
   - They can come back and change the choice until the provider signs. After signing the link shows "Approved, check your texts for the payment link".
   - "None of these / I want to talk to my clinic" records a decline and notifies the clinic.
6. **Payment.** Payment is today's `/checkout/{token}`, unchanged. It shows no medication names, and the payment link expires in 72h.

PHI rules:
- No medication names in any SMS, email subject or Stripe field.
- Medication names only on the plan page, and only after the DOB check.
- The page and API use the service role scoped to the proposal's clinic, as the intake page does.
- Nothing about the plan goes to Slack beyond ids and counts.

## 3. Data model: a migration is needed

The proposal is shared state between the provider, the patient link and the signature queue, so it must be stored. One migration, merged alone (rule 7), adds:

- **`treatment_proposals`**: `proposal_id`, `clinic_id`, `patient_id`, `provider_id`, `created_by`, `status`, `token_hash`, `expires_at`, `sent_at`, `first_viewed_at`, `chosen_option_id`, `chosen_at`, `signed_at`, `dob_failures`, `locked_at`, `created_at`, `updated_at`.
  - `status` is one of draft, sent, chosen, signed, declined, expired, cancelled.
  - The token is unique and only its hash is stored.
- **`treatment_proposal_options`**: `option_id`, `proposal_id`, `label` (≤ 80 chars), `position`, `protocol_id` (nullable, FK to `protocol_templates`).
- **`orders`**: two nullable columns, `proposal_option_id` (FK) and `proposal_required` (boolean). The proposal's items stay ordinary DRAFT orders, so editing, pricing, snapshots and batch sign all keep working unchanged.
- **`proposal_choice_items`**, or a JSONB `chosen_order_ids` on the proposal: which optional items the patient kept. A small table is preferred, because it is append-only and easy to audit.
- **`treatment_proposal_events`** (append-only): sent, viewed, dob_failed, chosen, rechosen, declined, signed, expired, cancelled. Each row carries actor and time, no PHI.

The migration also needs:
- RLS on every new table, reading `app_metadata` (claims.ts): clinic users of that clinic read; ops_admin reads; service-role writes.
- `SELECT apply_pharmacy_admin_scope();` as the last statement before COMMIT.
- Append-only triggers on the events table.
- The new tables added to the retention never-delete list.

A **Proposed** state comes from a DRAFT order with `proposal_option_id` set and its proposal `sent` or `chosen`. **No new order status is needed**, so the order state machine, the SLA crons and the ops pipeline are untouched.

## 4. How it fits payment groups and checkout

**No change to payment groups or checkout.** The choice only decides which DRAFTs reach batch sign. After that:
- 2+ chosen items → `createPaymentGroup` (bundle shipping, one PaymentIntent, group checkout token).
- 1 item → the solo checkout.

Patient choice adds no new money path, and nothing changes in the Stripe webhook, the ledger or reconciliation.

The plan page's total is computed with the same `bundleTotals` / `computeBundleShipping` helpers as Review. It is a quote, not a charge: the charged amount is fixed only at signing, as today.

## 5. Compliance

- **The prescriber signs only what is dispensed.** The provider signs after the choice, and only the chosen items. Unchosen DRAFTs are cancelled without a signature. The proposal itself is an offer, not a prescription.
- **Every signing check runs twice:** at propose, so the patient is never offered something that cannot be signed, and again at sign, because licenses, prices or compounding status can change in between.
- **Controlled substances stay blocked.** C6 refuses any schedule ≥1, or an unknown schedule, at both points. A controlled item can never be proposed, chosen or signed.
- **Compounding (C8):** a blocked ingredient cannot be proposed. A "pending FDA evaluation" warning is shown to the provider as today, never to the patient.
- **Patient choice is not prescribing.** The patient can only remove optional items or pick between options the provider prepared. They cannot change dose, quantity, pharmacy or directions.
- **Audit:** every step is in `treatment_proposal_events` and `order_status_history`.
- **PHI:** see section 2.

## 6. PR breakdown and test plan

Each PR is red tests first, then the fix, and the full gate: tsc, lint 0 errors, Jest, next build.

| PR | Scope | Tests |
|---|---|---|
| 1. Data model | Migration (+ down): the tables, the two `orders` columns, RLS, scope call, append-only trigger, retention entries. `src/lib/proposals/` types, token (hash, TTL, revoke) and the status machine. | Migration static test (tables, RLS via app_metadata, scope call last, triggers, down drops all). Token tests copied from intake. Status-transition table tests. Retention never-list test. |
| 2. Provider: propose | `checkBatch` split into a read-only `canSign(lines)` used by propose and sign. Review: options and Required stars. `POST /api/proposals` creates the proposal and tags the DRAFTs. Dashboard **Proposed** tab. Edit / cancel / re-send (revokes the link). | Every C4/C5/C6/C8/price refusal blocks propose, with the same messages as sign (table-driven). Controlled item never proposable. Proposed DRAFTs hidden from Drafts. Cancel → DRAFT→CANCELLED. Role tests (provider sends; MA cannot). |
| 3. Patient page | `/plan/[token]` + `GET/POST /api/plan/[token]` (resolve, DOB verify with lockout, choose / re-choose / decline). Middleware public route. SMS template. | No medication name in the SMS (the opt-in-gate test pattern). Nothing shown before DOB; 5 failures lock. Required items cannot be unticked server-side (not just in the UI). Choice limited to one option's items. Revoked / expired / signed link states. axe on every state. |
| 4. Sign the choice | Signature-queue entry and notification. Sign only the chosen DRAFTs through batch sign; cancel the rest. Proposal → signed; link shows "approved". Proposal expiry cron (sent and unchosen past TTL → expired, DRAFTs cancelled). | Batch sign called with exactly the chosen ids. Unchosen never get a signature hash. A check that fails at sign (license lapsed) stops signing and tells the provider. Payment group for 2+, solo for 1. Expiry cron idempotent. |
| 5. End to end | Playwright: provider proposes two options → patient (phone viewport) passes DOB, unticks one optional item, chooses → provider signs → checkout. Demo doc steps. | The e2e itself, plus `e2e/accessibility.spec.ts` entries for `/plan/[token]`. |

## 7. Open questions for Sam (with my recommendation)

1. **Sign before or after the patient chooses?**
   Recommend **after**: it is the only way the prescriber signs only what is dispensed. It costs the patient a second text (the payment link) after the provider approves. A Stripe card hold at choice time with capture at signing (one patient visit) is possible later, but it changes the live payment path; not in v1.
2. **May the plan page show medication names?**
   Recommend **yes, only after a date-of-birth check**: a patient cannot choose between treatments they cannot see. SMS and checkout stay name-free as today.
3. **Can the patient untick optional items, or only pick an option?**
   Recommend **both**: pick one option, untick optional items within it; required items are fixed. This matches the Phase 22 note.
4. **Can the patient mix items from different options?**
   Recommend **no** in v1: options are the provider's clinical packages. If they want a mix, the provider makes it an option.
5. **How long does a proposal link last?**
   Recommend **7 days**, with one reminder at 48h (name-free). After signing, the existing 72h payment window applies.
6. **What if a price changes between proposal and signing?**
   Recommend the existing repricing step (WO-108) at signing, with the provider seeing it. The payment page shows the final total. If the total rose, the patient's payment text says "updated total", and they can still decline by not paying.
7. **Who can send a proposal?**
   Recommend the **provider**, or a **clinic admin on the provider's behalf**; an MA can prepare it but not send it. Only the provider signs.
8. **Should choosing count as a protocol "start" (`protocol_instances`)?**
   Recommend creating or advancing the protocol instance **at signing**, not at proposal: unchosen protocols should not appear as started.
9. **Do unchosen items stay visible to the clinic?**
   Recommend **yes**, as cancelled lines on the proposal, so the provider can offer them later ("add as I go", line 1376).
