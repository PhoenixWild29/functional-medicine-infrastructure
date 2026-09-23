# Phase 21 — Practitioner Feedback Round 1 (Gina Rooks, 2026-09-11)

**Status:** Work orders defined, ready for build
**Source:** Product Run Thru meeting 2026-09-11 (Gina Rooks NP, Lauren Perkins, Anila Coniku-Nicklos) + Gina's follow-up email. Both are now committed verbatim under [`docs/practitioner-feedback/`](practitioner-feedback/README.md) — the [email](practitioner-feedback/2026-09-11-gina-rooks-email.md) and the [transcript](practitioner-feedback/2026-09-11-product-run-thru-transcript.md). **Check every requirement here against those files.** A requirement that cannot quote its source is a proposal, and must say so.
**Owner:** Sam Shamber
**Build order:** WO-96 → WO-107 as listed, then WO-108 (raised from production verification of WO-106, not from the feedback session). Dependencies noted per WO.

> **This file is the canonical copy: `docs/phase21-practitioner-feedback-workorders.md` in this repository.** Copies exist in the OneDrive folder and in older worktrees; they are stale, they disagree with this one, and they are not to be edited. Amend this file.

---

## Rules for every WO in this phase (every agent must follow)

1. **No new step in the prescription flow.** It stays Patient & Provider → Add Prescriptions → Review & Send.
2. **No new required field without a default.** If a rule makes a field required (controlled substance → diagnosis; GLP-1 → clinical difference), the field is pre-filled with the most common value and the provider confirms.
3. **Nothing on screen the app could have computed.** Days supply, dispense quantity, mg equivalents, vial suggestion, titration totals are derived and shown, not typed.
4. **Store once, attach everywhere.** Patient-level data (allergies) lives on the patient. Pharmacy-level data (shipping, cold chain) lives on the pharmacy. Formulation-level defaults (syringe kit, temp-sensitive, clinical difference options) live on the formulation.
5. **Terminology:** "provider" or "clinician," never "doctor," in UI copy.
6. **Every WO ships with:** migration (if any) applied to E2E first and serially, jest/Playwright coverage for the AC, and the POC demo doc updated if a demo step changed.
7. **Migrations merge serially.** Two open PRs with migrations must not both merge; the second rebases after the first lands.
8. A WO that violates 1–4 is returned, not merged.

---

## WO-96: Rx Detail Fields (derived + defaulted)

**Phase:** 21
**Blocked by:** Nothing
**Status:** ready

### Description
Add the prescription fields a compounding pharmacy needs to fill an order, without adding a step or a required-blank field. Fields are split into derived (computed, shown, overridable), defaulted (pre-selected per formulation), and optional (collapsed).

### Schema
Add to `orders` (nullable unless noted):
- `days_supply int` — derived
- `dispense_quantity numeric` + `dispense_unit text` — derived
- `refills int NOT NULL DEFAULT 0`
- `substitution_allowed boolean NOT NULL DEFAULT true` (DAW = false)
- `syringe_option text` — enum: `sc_kit | im_kit | insulin_syringe | none` — defaulted from formulation
- `shipping_type text` — enum: `standard | cold_chain` — defaulted from formulation
- `clinical_difference text` — picklist value or free text
- `diagnosis_code text`, `diagnosis_text text`
- `special_instructions text`

Add to `formulations`:
- `default_syringe_option text`, `default_shipping_type text`, `clinical_difference_options text[]`, `requires_clinical_difference boolean DEFAULT false`

Seed defaults: injectables → `sc_kit`; GLP-1s → `cold_chain` + `requires_clinical_difference = true` with Strive's standard reasons as options; everything else → `none` / `standard`.

### UI
- On the margin/sig page: **Days supply** and **Dispense** appear as computed read-only values next to the sig (from dose × frequency × quantity). Click to override.
- On the Review card, one collapsed row per Rx: **Rx details** → refills (default 0), substitution OK (default on), syringe option (pre-selected), shipping (pre-selected), clinical difference (pre-selected when required), diagnosis (optional), special instructions (optional).
- Row auto-expands only when a rule requires confirmation (controlled substance → diagnosis; `requires_clinical_difference` → clinical difference).
- All fields flow to the Rx PDF and the pharmacy submission payload for every tier (API/portal/hybrid/fax).

### Acceptance Criteria
- [ ] Semaglutide 10 units weekly, qty 1 vial 5 mg/mL → days supply and dispense computed and shown without typing.
- [ ] Review card shows "Rx details" collapsed; expanding shows all fields pre-filled.
- [ ] Testosterone Cypionate cannot be sent without a diagnosis; row auto-expands with diagnosis focused.
- [ ] Semaglutide cannot be sent without a clinical difference; picklist pre-selected with first option.
- [ ] BPC-157 (non-GLP-1, non-controlled) sends with zero interaction with the Rx details row.
- [ ] Rx PDF and fax/API payload include all new fields.
- [ ] No new page or step added to the flow.

### Notes
Gina's list items 1, 2, 4, 5, 6, 7, 9, 10. Item 3 (vial size) is WO-101, item 8 (allergies) is WO-97.

---

## WO-97: Patient Allergies / NKDA

**Phase:** 21
**Blocked by:** Nothing to build; **merge after WO-96** (both carry migrations)
**Status:** ready

### Description
Allergies live on the patient record, entered once, attached to every Rx automatically.

### Schema
Add to `patients`: `allergies text[]`, `nkda boolean NOT NULL DEFAULT false`, `allergies_updated_at timestamptz`.

### UI
- Patient selector card shows a small chip: **NKDA** or **Allergies: penicillin, sulfa** or **Allergies: not recorded** (amber).
- Session banner carries the same chip.
- Clicking the chip opens an inline editor (no page). Save writes to the patient.
- If allergies are not recorded, Review & Send shows an amber notice; the provider may confirm "NKDA" inline or proceed. Not blocking.
- Allergies print on the Rx PDF and go in the pharmacy payload.

### Acceptance Criteria
- [ ] Seed: Alex Demo NKDA, Jordan Rivera "sulfa", others not recorded.
- [ ] Chip visible on patient selection and session banner for all three states.
- [ ] Editing allergies from the banner updates the patient and every subsequent Rx.
- [ ] Rx PDF shows allergies line.
- [ ] Not-recorded state shows notice but does not block send.

---

## WO-98: Edit at Review, Edit Draft, Add to Draft

**Phase:** 21
**Blocked by:** Nothing
**Status:** ready

### Description
Every Rx card on the Review page and every draft order gets an Edit action that reopens the existing builder for that line. No new screens.

### Behavior
- Review page: each Rx card has **Edit** (next to Remove). Edit loads that Rx into the search/margin pages with current values; saving returns to Review with the line updated in place.
- **Back** on Review returns to the search page with the session intact.
- Draft order detail (provider view): **Edit** on each line (same mechanism) and **+ Add prescription** which opens the builder with the draft's patient/provider pinned and appends to the draft.
- Editing a draft keeps the draft id and order id; audit row written per edit.
- MA can edit drafts they created; provider can edit any draft for their clinic.

### Acceptance Criteria
- [ ] Change Semaglutide dose from 10 to 15 units at Review; card updates in place; totals recompute.
- [ ] Back from Review lands on search with both Rx still in session.
- [ ] Provider opens a draft, edits the dose, adds BPC-157, saves; draft now has 2 lines, same order id.
- [ ] Audit log shows edit events with actor and diff.
- [ ] Removed lines from a draft are soft-deleted, not hard-deleted.

---

## WO-99: Batch Sign as the Default Draft Path (+ closes the draft-sign 2FA gap)

**Phase:** 21
**Blocked by:** WO-98
**Status:** ready

### Description
Provider signs all pending drafts for a patient (or all their drafts) with one signature. The existing batch review path (`batch-review-form.tsx`, which already has `EpcsTotpGate`) becomes the only signing path. `/new-prescription/sign/[orderId]` is removed or redirected to the batch path.

### Behavior
- Dashboard Drafts tab: **Sign all (N)** button, plus per-row checkboxes for a subset.
- Batch review page lists each Rx with its Rx details row (WO-96) collapsed, one signature pad at the bottom, one **Sign & Send**.
- If any Rx in the batch is a controlled substance, the EPCS TOTP modal fires once for the batch and the audit record references every controlled order id.
- Signature threshold: lower to a stroke-count + bounding-box rule (≥ 3 strokes, ≥ 40% pad width) instead of the 5000-char data-URL heuristic.
- One signature record per order (legal requirement), all referencing the same signature image and timestamp.

### Acceptance Criteria
- [ ] Two drafts for Alex Demo → Sign all → one pad, one click → both Awaiting Payment.
- [ ] Add a Testosterone draft to the batch → TOTP modal appears once; cancel leaves all three unsigned.
- [ ] Direct navigation to `/new-prescription/sign/<id>` redirects to the batch page with that order pre-selected.
- [ ] Signing a Schedule 3 order without TOTP is impossible via any route (Playwright test).
- [ ] A small but real signature (3 strokes across the pad) is accepted; a single dot is rejected.

---

## WO-100: Provider Defaults to Self + Draft Reassignment

**Phase:** 21
**Blocked by:** Nothing
**Status:** ready

### Description
When a provider starts a prescription, the provider step is skipped: they are the provider. MAs keep the selector. A provider can take over a draft assigned to another provider and sign it under their own name.

### Behavior
- Provider role: Patient & Provider step shows patient selector only; session banner shows the logged-in provider. Step label becomes "Patient".
- MA / clinic admin: unchanged (patient + provider).
- Draft detail: **Sign as me** action for providers when `draft.provider_id != me`. Reassigns provider on all lines, writes audit row, then proceeds to WO-99 batch sign.
- Dashboard default view remains **My patients**; **All clinic orders** toggle unchanged.

### Acceptance Criteria
- [ ] Dr. Chen → + New Prescription → no provider list; banner shows Sarah Chen.
- [ ] MA → + New Prescription → provider list present.
- [ ] MA creates draft for Dr. Patel; Dr. Chen opens it, clicks Sign as me, signs; order shows provider = Chen, audit shows reassignment from Patel.
- [ ] Server rejects a provider creating an order with a different `provider_id` (403).

---

## WO-101: Package / Vial Size on Pharmacy Formulations + Auto-Suggest

**Phase:** 21
**Blocked by:** WO-96
**Status:** ready

### Description
Pharmacies price injectables by vial size. Add a package dimension to `pharmacy_formulations` and have the builder suggest the package from dose × frequency × days supply. The provider sees the suggestion and the price; they can change it.

### Schema
- New table `pharmacy_formulation_packages`: `id`, `pharmacy_formulation_id`, `package_label` (e.g. "2.5 mL vial"), `package_qty numeric`, `package_unit text`, `wholesale_price numeric`, `is_default boolean`, `active boolean`.
- `pharmacy_formulations.wholesale_price` becomes the price of the default package (backward compatible).
- `orders`: add `package_id` (nullable FK), `package_label` snapshot.
- Importer (`scripts/import-catalog-v3.ts`) reads an optional `packages` column; rows without it get one default package equal to today's price. Deterministic ids: `pkg:<pharmacy_formulation_id>:<label>`.

### UI
- Margin page: under the formulation line, **Package: 2.5 mL vial (suggested for 28 days)** with price. Dropdown to change. Only shown when the pharmacy has > 1 package for the formulation; otherwise silent.
- Suggestion = smallest package whose `package_qty` ≥ dispense quantity for the days supply. Retail and margin recompute on change.

### Acceptance Criteria
- [ ] Seed Strive Semaglutide 5 mg/mL with 1 mL / 2.5 mL / 5 mL packages at three prices.
- [ ] 10 units weekly × 28 days → suggests 1 mL; 40 units weekly × 28 days → suggests 2.5 mL.
- [ ] Formulation with a single package shows no package control.
- [ ] Changing package updates wholesale, retail, fee, and margin.
- [ ] Existing orders and seed data unaffected (all have a default package).
- [ ] Importer round-trips: import → export produces identical package rows.

---

## WO-102: Shipping Cost per Pharmacy + Multi-Pharmacy Warning

**Phase:** 21
**Blocked by:** WO-96
**Status:** ready

### Description
Shipping is a real cost that currently doesn't exist in the app. It lives on the pharmacy and appears wherever price appears.

### Schema
- `pharmacies`: `shipping_fee_standard numeric DEFAULT 0`, `shipping_fee_cold_chain numeric DEFAULT 0`, `free_shipping_threshold numeric NULL`.
- `orders`: `shipping_fee numeric` snapshot. `order_groups` (bundles): `shipping_total numeric`.

### Behavior
- Shipping fee = pharmacy fee by `orders.shipping_type` (WO-96), applied **once per pharmacy per bundle**, not per Rx.
- Margin page: shipping shown as a line under wholesale, outside the margin calc (passed through to patient at cost by default; clinic setting to absorb it).
- Review page: totals show Subtotal, Shipping (by pharmacy), Platform fee, Clinic payout, Patient total.
- Checkout page: Shipping line item.
- Review page: if the session spans > 1 pharmacy, a notice: "2 pharmacies → 2 shipping charges ($X). Route all to Strive to save $Y" with a one-click re-route when every item is available there and licensed.

### Acceptance Criteria
- [ ] Seed: Quick Rx $12 standard / $25 cold; Strive $9 / $22.
- [ ] Semaglutide via Quick Rx (cold) + BPC-157 via Strive (standard) → shipping $25 + $9, shown on review and checkout.
- [ ] Both via Strive → shipping $22 once (cold covers both).
- [ ] Multi-pharmacy notice appears with correct savings and re-route works.
- [ ] Platform fee is not charged on shipping.
- [ ] Payment intent amount = subtotal + shipping.

---

## WO-103: Search Bar to Top + Favorites/Protocols as Buttons + Save-as-Favorite + mg Display

**Phase:** 21
**Blocked by:** Nothing
**Status:** ready

### Description
Four small UI items from the meeting that were already committed to.

### Behavior
- Search page: medication search input is the first element under the session banner. Favorites and Protocols become two buttons beside it that open a panel; each panel has a **+ New** action.
- Review card and margin page: **☆ Save as favorite** on each Rx (name defaults to "<Drug> <dose> <freq>"). Saved favorites are editable (name, dose, pharmacy) from the Favorites panel.
- Favorites list items show units and mg: "10 units (0.5 mg) weekly".
- Provider favorites are clinic-wide (existing behavior) with a "mine" filter.

### Acceptance Criteria
- [ ] Search input visible without scrolling at 1366×768.
- [ ] Favorites (10) and Protocols (3) open as panels; counts still shown.
- [ ] Save Semaglutide 10 units from Review → appears in Favorites as "Semaglutide 10 units (0.5 mg) weekly".
- [ ] Edit that favorite's dose to 20 units → list shows "(1.0 mg)".
- [ ] Delete favorite removes it clinic-wide with a confirm.

---

## WO-104: Favorites Model: Drug → Common Doses; Sorting; Recent

**Phase:** 21
**Blocked by:** WO-103
**Status:** ready

### Description
A favorite is a drug + formulation + pharmacy. Under it, the clinic's common doses as chips. This replaces one-row-per-dose and keeps the list short. A favorite is saved for the practice (clinic-wide, the existing behaviour) or pinned to one patient (2026-09-11 meeting: a clinic saves its standard doses for the practice AND a favorite for a specific patient).

> **Spec amendment (2026-09-14, built in WO-104).** The original text said clicking a dose chip "pre-fills the builder and lands on the margin page". That is the free-text sig screen Gina's email asks to get away from: *"On the favorites, when selected, it would be nice to still be able to revert to the Rx builder drop downs rather than editing a free text box."* A chip therefore lands on the **dose step** with the builder dropdowns populated (amount, unit, frequency, timing, duration) and the sig generated from them; the provider then continues to price as normal. No step is added — the dose step is already step 2. Because a favorite now reaches the price step through the builder like every other line, it always carries a structured duration, and the price step's sig-parsing fallback is kept only for legacy saved links. A preset also carries `duration`, which the original shape omitted but the dose step needs.

### Schema
- `provider_favorites`: add `dose_presets jsonb` — array of `{dose, unit, frequency, timing, duration, label}` (builder values: dose unit, frequency / timing codes, duration in days or `ONGOING`); `category text`, derived from the formulation's ingredient `therapeutic_category` (Women's / Men's Health → Hormones, Weight Loss → Weight Management); `patient_id uuid NULL` (NULL = for the practice).
- Migration collapses existing favorites with the same clinic + formulation + pharmacy (+ patient) into one row with multiple presets. The most used row survives (its provider keeps "Mine"), the card is named for the drug, each dose keeps its old name as its label. The rule is a SQL function (`collapse_provider_favorites()`) so the demo and E2E seeds use the same code.

### UI
- Favorites panel: grouped by category in a fixed order (Peptides, Hormones, Weight Management…; others A–Z, Other last), A–Z within group. The selected patient's own favorites come first; favorites pinned to another patient are not shown. **Recent** strip at top: last 8 formulations prescribed by this provider. The "Mine" filter still applies.
- Each favorite card: name, formulation, pharmacy, then dose chips (10 units (0.5 mg) weekly · 20 units (1.0 mg) weekly · 40 units (2.0 mg) weekly · Custom). Clicking a chip opens the **dose step** with the formulation, pharmacy and every dose dropdown populated from the preset. Custom lands on the dose step with the formulation (and pharmacy) pre-selected and the dose fields empty.
- Dose chips also appear on the dose step for any formulation that has presets (from the clinic's favorites), with free entry still available. (`sig_templates` is not used: the table has no clinic scope and nothing writes it.)
- **Make favorite** on any Recent item. ☆ Save as favorite (builder, price step, Review card) adds the dose to the existing card for that drug + pharmacy, or creates one; it offers "For the practice" (default) or "Only for <patient>".

### Acceptance Criteria
- [ ] Migrated seed: Semaglutide favorites collapse to one card with presets 10/20/40 units.
- [ ] Clicking "20 units" chip → dose step with amount 20, units, once weekly, timing and duration populated; Continue → margin page with sig "Inject 20 units (0.20mL / 1.00mg) subcutaneous once weekly…" and dose "20 units (1.0 mg)".
- [ ] Custom chip → dose step, formulation pre-selected, dropdowns live.
- [ ] Recent strip shows last prescribed formulations; Make favorite creates a card.
- [ ] Groups sorted A–Z, categories in fixed order.
- [ ] A favorite saved "Only for <patient>" appears first when that patient is selected, and not for other patients.
- [ ] A favorite never goes through sig parsing (timing / duration are structured end to end).

---

## WO-105: Titration Builder → Structured Steps + Summed Quantity

**Phase:** 21
**Blocked by:** WO-96, WO-101
**Status:** ready

> **Spec amendment (2026-09-15, this is what gets built).** The original WO specified sequential monthly orders, a `scheduled` order state with a `release_at` date released by "the existing cron", and linkage via `protocol_instance_id` + `cycle_number`. **All three are struck.** None appears in either primary source; `cycle_number` numbers repeat runs of a protocol for a patient (`UNIQUE (patient_id, protocol_id, cycle_number)`, migration 20260816000001), not months within a titration; and there is no `scheduled` status in `order_status_enum` and no release cron. The original also cited Gina's email, which says nothing about titration: the request is verbal, from the 2026-09-11 meeting. What is built is **one order, structured steps, summed quantity, schedule printed for the pharmacy and the patient** — see "What she asked for" below, then Scope.
>
> Sequential monthly orders ("Phase B") stay open as a later, additive change if Gina wants monthly billing. It is not built now because it charges shipping once per order, and shipping charged more than once is a problem she raised in writing: *"You might get better pricing but you then you pay shipping more than once, so would want that built in as well."* The open question behind Phase B — whether the patient pays once up front or monthly — is hers to answer, and nothing in Phase A forecloses it.

### What she asked for
From the [2026-09-11 transcript](practitioner-feedback/2026-09-11-product-run-thru-transcript.md). Gina, at 00:56:14, on the titration mode as it shipped:

> "I see that there's some this says titration. So I was thinking there was going to be more to it, but it looks like it's just giving directions for the next few days later. Um because I had said to you before, you know, with drugs that you titrate, it would be nice to have like do this for the first four weeks, do this for the next four weeks."

At 00:57:56, on the shape and on why free text fails:

> "I would see the titration as like at least a different box for like each next step. um that could then be you know like this is your first it would almost be like separate prescriptions that would be triaged at separate points. Um some[ph]armacies don't really like you to send things like free text written like this because it's like too vague for them with titrations. So sometimes you get a lot of push back with something like this."

At 00:59:00, on the workaround this replaces:

> "I'm not going to say that I don't do that sometimes too and make it easier, but it can get confusing for the patient as well and it's definitely not best practice. So if like there was a way to actually put the titration in so that it's like this is your first month, this is your second month, that would be so much more ideal because I know that's definitely something that frustrates the provider that you have to put in like a fake prescription, then you have to tell the patient separately like do this and then they might get confused and they might mess it up."

At 01:01:35, on entering it once:

> "you order a medication, you want them to take it like that for a month and then you want the next month, but you don't want to go in every single month and put it in because it's just extra work. It's a pain in the butt."

The summed total is Lauren's, at 00:59:49:

> "we can build the titration schedule like it's a protocol, but then the technology can just sum up how much medicine you need to actually like execute that. So, it could still go to the pharmacy with it, but then there's like at the very top and then you could even resum it at the bottom just because sometimes[ph] are dense, but like this is the total amount, here's like the titration schedule and just recapping it. So it's like for both the patient and the pharmacy."

Phase A serves both of her problems: the pharmacy gets structured steps instead of "Titrate up by 0.1mL every 3-4 days as tolerated", and the provider enters the whole schedule once instead of re-entering it monthly or writing a fake maximum-dose script.

### Schema
One migration, merged alone:
- `orders.sig_mode text` — `standard | titration | cycling`, so the mode round-trips into reopen (WO-98), refill (WO-106) and favorites. Orders carry no mode today; a titration is recoverable only from words in `sig_text`.
- `orders.titration_steps jsonb` — `[{dose, unit, frequency, weeks}]`, a snapshot on the order in the manner of `medication_snapshot`. No `titration_schedules` table and no `order_id` pointer to a "first" order: nothing makes one order special.
- `provider_favorites.titration_steps jsonb` — so a titration favorite is a real titration (see Scope).

### Scope
- **Step table** in the dose step: dose, unit, frequency, weeks per step, with **Add step** and **Remove step**. Per-step quantity, total quantity and total days are derived and read-only (phase rule 3).
- **`computeTitrationDispense(steps, formulation)`** sums per step and returns total days supply, total quantity and the per-step breakdown. `suggestPackage` takes the summed quantity. The `/titrate/` bail-out in `durationDaysFromSig` stays, for legacy rows only.
- **Sig**: a generated summary sentence is kept, because Tier 4 is a fax and text is the transport — but it is backed by the structured steps, which render as a **table on the Rx PDF** and as **fields in the Tier 1 / 2 / 3 payloads**.
- **Patient-facing schedule** in plain language at checkout, with the total restated at the bottom (Lauren's "resum it at the bottom").
- **Fix the titration favorite.** "LDN Starter — Titration" loads as a *standard* sig today and silently drops the increment, interval and target, because `applyPreset` forces standard mode. With `provider_favorites.titration_steps` a titration favorite loads as a titration. Reseed it.
- **Multi-strength titrations are out of scope and must fail loudly.** Two capsule strengths are two formulations at two prices, so one order line cannot represent that titration. If the steps cross formulations the builder says so and requires a second line. It must never silently produce a single wrong quantity.
- **Cycling is not touched.** Its on-days / off-days quantity math is wrong today (a 5-on/2-off week is 5/7 doses per day, which `dosesPerDay` does not model) and gets its own work order. Cycling shares `computeDispense` with titration, so Phase A must leave its behaviour byte-identical, pinned by a test.

### Why one dose per order no longer holds
WO-96, WO-101, WO-101a and WO-102 all assume one dose for the whole duration: `computeDispense` takes a single dose + frequency + duration, and `suggestPackage` covers a single product. A titration is *n* segments, so the quantity is Σ over steps of doses(step) × dose(step). Semaglutide 5 mg/mL weekly, 10u×4w → 20u×4w → 40u×4w, is 0.4 + 0.8 + 1.6 = **2.8 mL over 84 days**; the single-dose math at the target dose returns 4.8 mL, a 71% overshoot — which is precisely the "script through for like the maximum" workaround, encoded in our arithmetic.

### Acceptance Criteria
- [ ] Semaglutide steps 10u×4w, 20u×4w, 40u×4w → one order, per-step quantities 0.4 / 0.8 / 1.6 mL, total 2.8 mL, total days 84, package suggested for the summed quantity per WO-101.
- [ ] The step table adds and removes steps; per-step quantity, total quantity and total days are shown and cannot be typed into.
- [ ] `orders.sig_mode = 'titration'` and `orders.titration_steps` are stored, and reopening the draft (WO-98) restores the step table.
- [ ] Rx PDF shows the step table and the summed dispense; Tier 1 / 2 / 3 payloads carry the steps as fields; the fax sig still reads as a sentence.
- [ ] Patient checkout shows the schedule in plain language with the total restated at the bottom.
- [ ] "LDN Starter — Titration" loads as a titration with its steps, not as a standard sig.
- [ ] Steps that cross formulations (ketotifen 0.1 mg capsule → 0.5 mg capsule) are refused with a message telling the provider to add a second line; no quantity is computed.
- [ ] Cycling behaviour is unchanged, pinned by a test.
- [ ] Free-text "titrate up by…" is no longer generated when Titrate is on.

---

## WO-106: Refill Action + Dashboard Primary Actions

**Phase:** 21
**Blocked by:** WO-98
**Status:** ready

> **Spec amendment (2026-09-17, this is what gets built).** The original WO attributed all of this to the phase's practitioner feedback. Checked against the primary sources, most of it is Lauren's and Anila's, one line is Gina's, and four items are in neither source. Struck:
>
> - **The controlled-substance refill rule** — *"refill blocked … when the source is a controlled substance older than the state's limit (config value; default 6 months)"*. Nobody said this. There is no state-rules infrastructure in this codebase, and "default 6 months" was invented. A fabricated compliance rule in a prescribing app is worse than no rule: it either blocks lawful refills or implies a guarantee the product cannot make. A real rule needs regulatory input and its own work order. **Out of Phase 21.** Blocking at the authorized refill count is kept — that needs no legal opinion.
> - **`refills` decremented on the source** — replaced by deriving the count (see Schema). Orders are append-only snapshots; mutating a signed order to track something the app can count is the wrong shape, and a decrement strands a refill the patient never received when the refill is cancelled or refunded.
> - **"Refill opens at Review (not search)"** as a stated requirement — it is a design decision, not feedback, and is recorded as one below.
> - **"Kanban view renamed Board"** — "Board" is an invention and still jargon. See UI.
>
> Added, because it is in the sources and the WO omitted it: **refilling multiples**. It is also the shipping fix — see Why multiples matter.
>
> **"Action needed"** (Lauren, 01:46:30: *"are there any orders that require attention right like action like an action needed one"*) is deliberately **routed to WO-107**, whose "Needs attention" queue already covers it. Not built twice.

### What was asked, and by whom
From the [2026-09-11 transcript](practitioner-feedback/2026-09-11-product-run-thru-transcript.md). Gina's [email](practitioner-feedback/2026-09-11-gina-rooks-email.md) does not mention refills as an action, the dashboard buttons, the view naming or the KPI cards; its only refill line is *"4) How many refills are authorized."*, which is the Rx field built in WO-96.

**Gina Rooks, 00:32:29** — the one refill ask that is hers, and the reason this WO exists:

> "So you'd want to have like your usual standards and then obviously you want to be able to tweak it if you need to. But then yes, from a specific patient perspective, like reordering, you want it to be as fast as possible, you know, not re-entering it every time."

**Lauren Perkins, 00:45:42** — a refill whose dose can be edited:

> "you should be able to check out or you know do refills and even if that refill is like oh I'm going to change the dose or I want to you know like in my last appointment with Dr. Mitchell he was like oh let's titrate up your LDN… And so it's a a refill, but you get to edit the actual, you know, dose and how much you're you're ordering"

**Lauren Perkins, 01:34:34 and 01:38:27** — the three dashboard actions:

> "there should be like new prescription, new protocol, and then there probably needs to be a button for refill or you know what I mean?"

> "those three actions and the dashboard should have that."

**Lauren Perkins, 01:35:48** — one-off and multiple:

> "they definitely are going to need to do refills, whether that's a oneoff refill or whether that's refilling multiples. So, think through like what does that look like in terms of those are the key actions that they're going to take."

**Lauren Perkins, 01:33:41** — the view label:

> "Most people Sam I don't think are going to know canban. I wonder if we should call it like visual or like you know like some like if we should try to call it something that like cuz like can bin is like a technology term."

**Anila Coniku-Nicklos, 01:32:09** — the clickable KPI cards:

> "in the table version I would think like I was going to click under the total orders. the total orders and get there or the revenue or the the pending payments in conban or canban. … It takes you right there already does that. It just takes you into those categories."

Also recorded, not built here: Lauren proposed watching Gina do a refill the old way before designing the flow (*"we can have Gina screen share and like use me as the practice patients and be like what's the old school way of doing it"*). Worth doing — it would tell us whether a refill is usually one drug or a whole protocol.

### Schema
One migration, merged alone:
- `orders.refill_of_order_id uuid NULL REFERENCES orders(order_id)`, indexed. Set on the new order when it is created from a refill.

Nothing else. **Refills used is derived**: `count(orders WHERE refill_of_order_id = <source> AND status NOT IN (cancelled/refunded states))`, compared against the source's `refills`. No decrement, no `refills_used` column. A cancelled or refunded refill correctly frees the authorization again, which a decrement cannot do without a compensating write on an order that is already signed.

### Behavior
- **Refill, single.** Primary action in the order drawer and a row action in the orders table. Opens the prescription session pre-loaded with patient, provider (self per WO-100), formulation, pharmacy, package, Rx details and the structured sig inputs. The dose is editable, per Lauren 00:45:42. The new order carries `refill_of_order_id`.
- **Refill, multiple.** From a patient's order list, select several past orders and refill them into **one session as sibling drafts**, so the WO-102 bundle charges shipping once per pharmacy.
- **Blocked at the authorization.** When the derived refill count is at or above the source's `refills`, Refill is unavailable with a message pointing at a new prescription. No other block.
- **Titration refill defaults to the maintenance dose.** A refill of a line with `sig_mode = 'titration'` becomes a **standard** line at the final step's dose and frequency, duration defaulted to the last step's length, with the reason on screen: *"Refilling at the maintenance dose, 40 units weekly. Change it if the patient is still titrating."* Copying the schedule verbatim re-prescribes a ramp the patient has completed and under-dispenses — the WO-105 overshoot in reverse. Flagged for Gina to confirm; the safe default ships now.
- **Multi-vial refill re-prices.** The package on the source is a snapshot. A refill re-runs the WO-101 suggestion against the pharmacy's **active** packages today and shows the delta when the price moved — *"2 × 5 mL vials, $310, was $285 on 12 Aug"*. Never silently re-price, and never resend a stale `packageId` and let the server reject it with an internal error.

### UI
- Dashboard header: **+ New Prescription**, **+ New Protocol**, **Refill**. Refill opens a patient picker limited to patients with prior orders.
- View toggle becomes **Table / Cards**. Not "Board": that is an invention and still jargon. Lauren's word was "visual" and she was thinking aloud, so neither is settled — "Cards" describes what the user sees. **Lauren gets final say on the word.**
- All four KPI cards clickable to their tab, keyboard accessible (real buttons, Enter/Space, focus ring).
- **Pending Payment count fixed.** It counts month-to-date, but the tab it will link to shows all open links regardless of month, so the number and its destination disagree the moment the card becomes clickable. The card counts what the tab shows.
- Provider view default stays My patients (unchanged; restated only because the original WO listed it).

### Why multiples matter
Each new order gets its own shipping at creation (`applyBundleShipping`, single-order bundle → full pharmacy fee). Refilling three medications one at a time therefore pays shipping three times, which is the thing Gina raised in writing: *"you then you pay shipping more than once, so would want that built in as well."* Refilling multiples into one session is not a convenience — it is what keeps a refill from costing the patient two extra shipping fees.

### Design decisions (recorded as decisions, not requirements)
- A refill lands at **Review** in edit-ready state rather than at search, because everything is already known and Review is where the provider changes a dose and signs.
- A refill creates a **new order**, never reuses the source. Orders are append-only snapshots (medication, pharmacy, provider NPI, prices) and the audit trail and pharmacy submissions key off `order_id`; reusing the source would corrupt the history of the original fill.

### Acceptance Criteria
- [ ] Refill on a delivered Semaglutide order → session at Review with the line pre-filled; change dose to 20 units; sign → new order with `refill_of_order_id` set to the source.
- [ ] Refills used is derived from `refill_of_order_id`, never stored: a source with `refills = 2` allows two refills, a third is blocked with a message pointing at a new prescription, and cancelling one of the two frees it again.
- [ ] Refilling three past orders for one patient lands three sibling drafts in one session, and shipping is charged once per pharmacy across them (WO-102).
- [ ] Refill of a titration order produces a standard line at the final step's dose and frequency, with the maintenance-dose explanation shown; the step table is not reproduced.
- [ ] Refill of a multi-vial line re-suggests from today's active packages and shows the price delta when it changed; a package the pharmacy no longer prices is replaced by the current suggestion, with the change visible.
- [ ] Dashboard shows three actions; "Kanban" label gone; toggle reads Table / Cards.
- [ ] Each KPI card is a real button, reachable by keyboard, and selects its tab; Pending Payment's number equals the row count of the tab it opens.

---

## WO-107: Clinic Practice Dashboard (Clinic Admin)

**Phase:** 21
**Blocked by:** WO-102
**Status:** ready

### Description
The ops dashboard scoped to one clinic, for the practice owner/manager. Script volume, billed, margin captured, by day/week/month, with admin control over who sees it.

### Behavior
- New route `/practice` for `clinic_admin` (and providers when `clinics.practice_dashboard_visible_to_providers = true`). The toggle is a column on `clinics`, beside the clinic's other settings (`absorb_shipping`, `default_markup_pct`); there is no `clinic_settings` table. Migration `20260923000001`, default `false`, merged alone (rule 7).
- Cards: Scripts (period), Patient revenue, Clinic payout, Platform fees, Shipping passed through, Avg margin %. Period selector: Today / 7d / 30d / MTD / custom.
- Table: by provider, by pharmacy, by medication. Export CSV.
- **Needs attention** queue: awaiting payment > 72h, submission failed, unmatched fax for this clinic, drafts older than 48h.
- Settings → Clinic Profile: toggle for provider visibility. Also fix the markup help text ("Example: 150 = 150% of wholesale (1.5× markup)" contradicts the stored 40 → 1.4×).

### Acceptance Criteria
- [ ] Clinic admin sees `/practice`; provider gets Access Denied until the toggle is on.
- [ ] Numbers reconcile to the ops pipeline filtered to the clinic (Playwright asserts equality on seed).
- [ ] Needs attention lists the seeded failed order and any awaiting-payment > 72h.
- [ ] CSV export matches the on-screen table.
- [ ] Ops role still cannot access `/practice` for a clinic (RBAC both directions preserved).
- [ ] Markup help text reads "Example: 40 = 40% markup (1.4× wholesale)".

---

## WO-108: Reprice a Refill When the Package Price Has Moved

**Phase:** 21
**Blocked by:** WO-106
**Status:** ready

**Source:** NOT from the 2026-09-11 practitioner feedback. This comes from Sam's production verification at `cdd0565`, where a refill showed retail $133.00 against wholesale $165.00 — margin −$32.00, clinic payout −$32.00, patient total $155.00. Per the phase rule on sources, this WO is a proposal grounded in that observation and the decisions recorded with it, not in Gina's or Lauren's words.

### Description
A refill carries the source order's retail forward while taking the pharmacy's CURRENT wholesale. When the package price has moved, the line is mispriced: the clinic absorbs the whole move, silently, and when the price rose far enough the line falls below cost. WO-106 stopped a below-cost line from being sent (#161). This WO decides what a refill should DO about a moved price.

### Decision
Interrupt and let the provider choose, with the preserved-margin number pre-filled. Carrying the old retail and showing the loss was rejected: `POST /api/orders` and the DB CHECK from `20260319000006` both refuse `retail < wholesale`, and that constraint stays.

### Behavior
- **Trigger: the package's wholesale price has moved since the source order — in either direction, by any amount.** No tolerance threshold. That is the moment a choice exists between the clinic's margin and the patient's price. Today nothing interrupts and the patient's price never changes, which is precisely the defect: the clinic absorbs the move without being asked.
- **Scope:** lines whose wholesale has not moved go straight to Review, exactly as today. Only moved lines stop.
- **Where:** the existing price step, `/new-prescription/margin?…&editId=<lineId>`, which already saves back to a session line (the WO-98 edit-at-review mechanism). **Not a new step** (rule 1) — the step that already exists, reached only when there is a real decision.
- **Pre-fill:** `newRetail = round(newWholesale × oldRetail / oldWholesale)`, preserving the original margin percentage. Both snapshots are on the source order, so no number is invented (rule 3). It is a default the provider can overtype, so no new required field (rule 2).
- **Reason on screen:** the existing price note (`2.5 mL vial, $95.00, was $50.00 on 12 Aug.`) renders on the price step. The reason for the interruption belongs where the decision is made.
- **Several moved lines:** sequence through the builder one line at a time, in the order they appear on Review. No new screen.
- **After the last moved line:** Review, with every line confirmed.

### Mechanism
- `/api/orders/refill` returns, per line, `sourceRetailCents` and `suggestedRetailCents` (preserved margin) alongside the existing `priceNote`.
- The session line carries `repriceRequired`, set when the source's wholesale differs from today's.
- The refill picker replaces the session as it does now, then pushes to the first flagged line's price step, or to Review when nothing is flagged.
- Saving on the price step clears that line's flag and moves to the next flagged line, or to Review.
- **Backstop:** a line still flagged when Review renders is unsendable, reusing WO-106's `sendBlock`, so a deep link to Review cannot skip the decision.

### Edge cases (specified, never silent)
- **The original margin cannot be meaningfully preserved** — the source order has no wholesale snapshot, or the source was itself priced below cost. One rule for both: pre-fill `clinics.default_markup_pct` and say on screen why the original margin could not be used. Preserving a negative margin is meaningless, and a zero-margin default is a number no clinic would choose.
- **Provider leaves mid-sequence:** the flags persist in the session and the Review backstop holds.
- **Titration refill:** the maintenance dose is resolved first (WO-106), then the same repricing path. The two do not interact.

### Acceptance Criteria
- [ ] Refill whose package wholesale rose → lands on the price step, not Review, with the preserved-margin retail pre-filled and the price note visible.
- [ ] Refill whose package wholesale fell → also lands on the price step.
- [ ] Refill whose wholesale is unchanged → lands on Review directly, with no interruption.
- [ ] Two moved lines → the price step twice, in Review order, then Review.
- [ ] A mix of moved and unmoved lines → only the moved ones stop.
- [ ] The provider types their own number → that number is used, not the suggestion.
- [ ] Arithmetic pinned: $50 → $95 wholesale with $60 retail gives $114 retail; margin 20% before and after.
- [ ] Source with no wholesale snapshot, and source already below cost → both pre-fill `default_markup_pct`, with the reason on screen.
- [ ] A flagged line reached by deep link to Review is unsendable.
- [ ] POC demo doc updated: the refill walkthrough now includes the price step when the price has moved (rule 6).

### Not in scope
Repricing anything other than a refill. Changing the DB CHECK or the 422 — below cost stays refused. Repricing automatically without the provider seeing it, which was considered and rejected: a patient's price must not rise without a provider looking at it.

### Migration
None expected. Old retail and old wholesale are already on the source order, and `repriceRequired` is session state, not storage. If a column proves necessary it merges alone (rule 7).

---

## Deferred to Phase 22 (recorded, not built now)

- Patient-facing protocol review: provider marks must-haves, patient unchecks items before paying. Depends on WO-105 and the payment-group model.
- First-run onboarding walkthrough.
- Competitor demos (Vital, Scripts) — research, not build.

## Dependency chain

```
WO-96 (Rx fields) ──┬── WO-101 (packages) ──┐
                    ├── WO-102 (shipping) ──┼── WO-105 (titration)
WO-97 (allergies)   │                       │
WO-98 (edit) ── WO-99 (batch sign)          └── WO-107 (practice dashboard, needs WO-102)
            └── WO-106 (refill) ── WO-108 (reprice a moved package price)
WO-100 (provider = self)
WO-103 (search/favorites UI) ── WO-104 (favorites model)
```

Parallel start candidates: WO-96, WO-97, WO-98, WO-100, WO-103.
