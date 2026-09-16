# Phase 21 — Practitioner Feedback Round 1 (Gina Rooks, 2026-09-11)

**Status:** Work orders defined, ready for build
**Source:** Product Run Thru meeting 2026-09-11 (Gina Rooks NP, Lauren Perkins, Anila Coniku-Nicklos) + Gina's follow-up email. Both are now committed verbatim under [`docs/practitioner-feedback/`](practitioner-feedback/README.md) — the [email](practitioner-feedback/2026-09-11-gina-rooks-email.md) and the [transcript](practitioner-feedback/2026-09-11-product-run-thru-transcript.md). **Check every requirement here against those files.** A requirement that cannot quote its source is a proposal, and must say so.
**Owner:** Sam Shamber
**Build order:** WO-96 → WO-107 as listed. Dependencies noted per WO.

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

### Description
Refill copies an existing order into a new draft with everything pre-filled, lets the provider change dose or quantity, and signs. Dashboard exposes the three actions providers actually take.

### Behavior
- Order detail and dashboard row menu: **Refill**. Creates a draft with the same patient, provider (or self per WO-100), formulation, pharmacy, package, sig, Rx details; `refills` decremented on the source if > 0; `refill_of_order_id` set.
- Refill opens at Review (not search) with the card in edit-ready state.
- Dashboard header: **+ New Prescription**, **+ New Protocol**, **Refill** (opens a patient search filtered to patients with prior orders). Kanban view renamed **Board**. KPI cards clickable → filter table (Pending Payment card → Pending Payment tab, etc.).
- Provider view default stays My patients.

### Acceptance Criteria
- [ ] Refill on a delivered Semaglutide order → draft at Review with identical lines; change dose to 20 units; sign → new order with `refill_of_order_id` set.
- [ ] Source order `refills` decremented; refill blocked with message when `refills = 0` and source is a controlled substance older than the state's limit (config value; default 6 months).
- [ ] Dashboard shows three actions; "Kanban" label gone.
- [ ] Clicking Pending Payment KPI selects the Pending Payment tab.

---

## WO-107: Clinic Practice Dashboard (Clinic Admin)

**Phase:** 21
**Blocked by:** WO-102
**Status:** ready

### Description
The ops dashboard scoped to one clinic, for the practice owner/manager. Script volume, billed, margin captured, by day/week/month, with admin control over who sees it.

### Behavior
- New route `/practice` for `clinic_admin` (and providers when `clinic_settings.practice_dashboard_visible_to_providers = true`).
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
            └── WO-106 (refill)
WO-100 (provider = self)
WO-103 (search/favorites UI) ── WO-104 (favorites model)
```

Parallel start candidates: WO-96, WO-97, WO-98, WO-100, WO-103.
