# CompoundIQ POC Demo — Detailed Walkthrough

**Version:** 2.19 | **Date:** September 15, 2026
**Application:** https://functional-medicine-infrastructure.vercel.app
**Duration:** 30–45 minutes (with discussion)

> **What's new in v2.19 (2026-09-15):** **WO-101a — the vial suggestion also says how many.** When no single vial holds the prescription, the app no longer prices one vial and leaves the provider to count: it suggests the vial that needs the fewest units and how many of it, priced as vial price × count. Example: Semaglutide 5 mg/mL, **80 units weekly for 90 days** = 12 doses × 0.8 mL = **9.6 mL** → **"Package: 2 × 5 mL vials (suggested for 90 days) · $570.00"**. (a) **Pharmacy & Pricing (step 30)** — the suggested vial under the price reads "2 × 5 mL vials" and the price is the total. (b) **Margin page (step 33)** — a small **number box** sits beside the Package dropdown; changing the vial or the count recomputes wholesale, retail, platform fee and clinic margin. With one vial (the scripted 10 units for 30 days) the Package line reads exactly as in v2.18 and the box shows 1. (c) **Review (step 40) and the Rx PDF** state the total and the packaging — **"Dispense: 9.6 mL (2 × 5 mL vials)"** — and every pharmacy payload carries the package label and count. (d) Migration `20260915000001` adds `orders.package_count` (default 1, at most 20). Scripted numbers unchanged. Step 33 updated.

> **What's new in v2.18 (2026-09-14):** **WO-101 — Vial size is suggested from the Rx, and priced per vial** (Phase 21, Gina Rooks' 2026-09-11 item 3: *select vial size, cost varies by size, auto-select the size from the Rx*). Still three steps, no new screen, nothing new to type. (a) **Pharmacy & Pricing (step 30)** — a pharmacy that sells the formulation in more than one priced vial shows the **suggested vial under its price** and every vial with its own price: Strive's Semaglutide 5 mg/mL row reads **$95.00 · 1 mL vial** and **"1 mL vial $95.00 · 2.5 mL vial $165.00 · 5 mL vial $285.00"**. The suggestion is the smallest vial that holds the dispense quantity for the selected duration (10 units weekly for 30 days = 0.4 mL → 1 mL; 40 units weekly for 30 days = 1.6 mL → 2.5 mL). (b) **Step 31** — for that pharmacy the old Quantity dropdown is gone (the vial *is* the quantity); only Refills remains. Pharmacies with a single package keep the Quantity dropdown exactly as in v2.17. (c) **Margin page (step 33)** — under the pharmacy line: **"Package: 1 mL vial (suggested for 30 days) · $95.00"** and a **Package** dropdown. Picking another vial changes the locked wholesale, and retail keeps the same markup, so platform fee and clinic margin recompute on the spot; the order stores the vial chosen (`orders.package_id` / `package_label`) and is priced from it server-side. The control is hidden when the pharmacy has only one package. (d) **Data** — migration `20260914000001` adds `pharmacy_formulation_packages`, gives every existing pharmacy formulation one default package at today's price (so every existing order, price and seed row reads the same), and seeds Strive's Semaglutide 5 mg/mL with 1 mL **$95** (default) / 2.5 mL **$165** / 5 mL **$285**. The catalog importer reads an optional `packages` column and `npm run export:catalog-packages` writes it back out. The scripted numbers ($95 wholesale, $133 / $190 retail) are unchanged because the 1 mL vial is both the suggestion and the default. Steps 30, 31 and 33 updated.

> **What's new in v2.17 (2026-09-13):** Phase 21, practitioner feedback round 1 — WO-97, WO-98, WO-100, WO-103 and a WO-96 fix. Still three steps, no new screen.
>
> **WO-97 — Patient allergies / NKDA.** Allergies are entered once on the patient and attached to every prescription automatically — no per-Rx typing, no new step. (a) **Patient selector (step 8)** — every patient card carries a small chip: **NKDA** (green), **Allergies: sulfa** (red), or **Allergies: not recorded** (amber). The seed is deliberate: **Alex Demo reads NKDA**, **Jordan Rivera reads "Allergies: sulfa"**, every other patient reads **not recorded**. On the selected-patient card the chip is clickable and opens an **inline editor** (comma-separated list or an NKDA checkbox — the two are mutually exclusive); Save writes to the patient record. (b) **Session banner (step 11)** — the same chip sits under the patient's name on every page of the flow, and editing it there updates the patient and everything you add afterwards. (c) **Review page (step 40)** — when nothing is recorded, an **amber notice** offers a one-click **Confirm NKDA**; it never blocks Sign & Send or Save as Draft. Alex Demo and Jordan Rivera never show it. (d) The Rx PDF now prints an **Allergies:** line in the PATIENT block (NKDA / the list / "Not recorded") and every pharmacy submission payload carries the same value. (e) Migration `20260912000002` must be applied before the chip can render — it lands with the WO-97 PR, after WO-96.
>
> **WO-98 — Edit at Review, Edit Draft, Add to Draft.** (a) **Review page (step 40)** — every prescription card now has **Edit** next to Remove. Edit reopens the *existing* builder (search page) with that line's medication, formulation, pharmacy, dose, frequency and quantity already selected; change the dose, continue, and the margin page shows the line's price and a single **"Save Changes — Back to Review"** button. The card updates **in place** (same position, same card) and the totals recompute. A **Back** button next to "+ Add Another Prescription" returns to the search page with the session intact. (b) **Draft detail (step 54, provider)** — the sign page lists the **draft lines** for this patient/provider (an N-prescription session is still N draft orders): each line has **Edit** and **Remove**, and **"+ Add prescription"** opens the builder with the draft's patient and provider pinned and appends a new draft line. Editing keeps the draft's order id; **Remove** is a soft delete (the row stays, `deleted_at` set). The order drawer's amber draft box (step 52) carries the same **Edit prescription / + Add prescription** buttons for the MA. (c) **Audit** — every draft edit and removal writes a row to the order's status timeline (visible in the drawer as "Draft edited · changed dose, sig" with the actor). (d) **Who may edit** — the provider can edit any draft in the clinic; the MA / clinic admin only drafts they created (the server returns 403 otherwise).
>
> **WO-100 — Provider defaults to self + draft reassignment.** Two role-specific changes, still three steps, nothing new to type. (a) **A provider is the provider.** When **Dr. Chen** (or any provider login) clicks **+ New Prescription**, step 1 is labelled **Patient** and shows the patient selector only — no provider list — and the subtitle reads **"Prescribing as Sarah Chen."** The pinned session banner shows her name from the start. The scripted Part 3 is run as the **MA**, whose screen is **unchanged** (patient + provider, step labelled **Patient & Provider**, four provider cards as in 3B) — so steps 6–10 do not move. If you improvise a prescription as Dr. Chen, expect the shorter step 1; see the new box in Part 3B. (b) **Sign as me.** When a provider opens a draft that the MA saved under a *different* provider (e.g. Dr. Patel), the sign page shows an amber **"This draft is assigned to Marcus Patel"** panel with a **Sign as me** button instead of the signature pad. One click moves every line of that draft to the signed-in provider, records the reassignment in the audit trail (`order_status_history`, actor `provider_reassign_to_self`, from → to provider ids), and the same page re-renders as the normal signing form under their name. The scripted 3H drafts are already Dr. Chen's, so the panel does not appear in the script — see the new optional beat after step 56. (c) **Server guard:** a provider login that tries to create an order under another provider's id is refused (**403**); MA and clinic-admin sessions still choose the provider. Dashboard default view stays **My patients**; the **All clinic orders** toggle is unchanged.
>
> **WO-103 — Search bar to top, Favorites/Protocols buttons, Save as favorite, mg display.** (a) **Configure page (Part 3C/3D)** — the **medication search box is now the first thing under the session banner**, visible without scrolling on a 1366×768 laptop. The old two-tab Quick Actions panel is gone; in its place, **two buttons beside the search box — "Favorites (10)" and "Protocols (3)"** — each open a panel below it, and each panel has a **+ New** action (Favorites → puts you in the search box to build one; Protocols → saves the prescriptions already in the session as a new clinic protocol). (b) **Favorites list shows units and mg** — every card carries a dose line such as **"10 units (0.5 mg) weekly"**; the mg is computed from the syringe units and the formulation's mg/mL concentration, never typed. The list stays clinic-wide with a **Mine** checkbox to narrow it to the selected provider. (c) **Favorites are editable in place** — a pencil icon opens name, dose, frequency and pharmacy; change 10 units to 20 and the card reads **(1.0 mg)**. Delete keeps the two-step confirm and removes the favorite for the whole clinic. (d) **☆ Save as favorite** now also appears on the **margin page (step 33)** and on **every Review card (step 40)**, with the name pre-filled as **"<Drug> <dose> <freq>"**. (e) The margin page and Review card show the **mg equivalent next to the dose** — "Injectable Solution · 10 units (0.5 mg)". Steps 12–14, 18, 22, 31, 33 and 40 updated.
>
> **WO-96 fix — Days supply and Dispense are computed, never "—".** Verified broken on prod against Gina Rooks' 2026-09-11 items 1–2: with no quantity picked, both read "—". Now (a) **Days supply is the duration picked on the dose step** — "For 30 days" means 30 — and **Dispense is doses in that many days × the dose** in the formulation's unit (Semaglutide 5 mg/mL, 10 units once weekly for 30 days → 4 doses → **0.4 mL**); "Ongoing" or no duration falls back to dose × frequency × quantity. (b) **Quantity is pre-selected**, not "Select quantity": the smallest package the pharmacy lists that covers the computed dispense, or "1" when it lists none. (c) **Override** still works and is what gets sent. (d) A draft saved from Review now keeps its quantity when reopened, and the order drawer's timeline names who edited a draft instead of showing an id.

> **What's new in v2.16 (2026-09-12):** **WO-96 — Rx detail fields, derived and defaulted (Phase 21, practitioner feedback round 1).** The prescription flow still has the same three steps, but two screens gained content. (a) **Margin page (step 33)** — under the sig, **Days supply** and **Dispense** now appear as computed read-only values, derived from dose × frequency × the quantity chosen in step 31 (Semaglutide 10 units weekly from a 5 mL vial reads **350 days · 5 mL**; the number is the arithmetic, not a clinical recommendation, and an **Override** link lets the provider change it). Selecting a quantity in step 31 is therefore no longer optional if you want the derived values to show. (b) **Review page (step 40)** — every prescription card carries a collapsed **Rx details** row: refills (0), substitution (allowed), syringe option and shipping (pre-selected per formulation — Semaglutide ships **cold chain**), clinical difference, diagnosis, special instructions. The row **opens by itself only when a rule needs confirmation**: **Semaglutide** opens with the 503A clinical-difference picklist **already set to its first option** (nothing to type), and **Testosterone Cypionate** opens asking for a **diagnosis** and **keeps "Save as Draft" disabled until one is entered** — see the new box after step 42. BPC-157 and the other non-controlled, non-GLP-1 items never open the row. (c) All of these fields flow to the Rx PDF and to every pharmacy submission payload. (d) The prescriber line on the Rx PDF and all new copy say **provider**, never "doctor".

> **What's new in v2.15 (2026-09-11):** **Root cause of the recurring mid-demo silent logout found and fixed.** The every-10-minutes `poc-credential-sync` Vercel cron re-set the four POC account passwords via the Supabase admin API on every fire, and an admin user update that includes a password revokes every existing session for that user, even when the password value is unchanged. The cron is removed and the credential sync is now metadata-only unless passwords are explicitly reset. Sessions now persist for the full token lifetime. The cron count in the tech overview drops from **10 to 9**. The **Reset Demo Credentials** button on `/ops/demo-tools` still resets passwords but now warns that it signs out every demo user, including the presenter. Do not press it during a demo. Docs only otherwise.

> **What's new in v2.14 (2026-09-10):** **Accuracy correction** — the Part 7 Q&A answer about signing three prescriptions no longer asserts that a "sign all" button was deliberately not built (an unverified design-intent claim); it now states the observed behaviour and tells the presenter to treat batch signing as roadmap/feedback. The same unverified-intent wording was softened in the post-save KPI note after step 44.

> **What's new in v2.13 (2026-09-10):** **The draft-save behaviour is now pinned down: a session of N prescriptions saves as N separate draft orders, and the provider signs each one.** Verified in a live prod dry run signed in as `ma@sunrise-clinic.com` on 2026-09-10. (a) **Step 43 and Part 3H** — v2.12 deliberately hedged ("the two prescriptions may appear as one draft or two… sign whatever is in the Drafts tab"). They appear as **two**. The hedge is replaced with the verified rule and the exact count this script produces, so the presenter knows how many times they are about to sign. (b) **Protocol quick-load may not auto-advance** — after clicking "Load N Medications into Session" the app sometimes stays on `/new-prescription/search` with the session banner showing; the presenter clicks **Review & Send** to continue (Part 3C, step 16). (c) **Verified post-save dashboard state added** — Total Orders rises by one per draft, **Revenue does not move** (drafts are excluded from revenue until signed and paid), and the **Drafts tab materializes**. (d) **GAP-3 confirmed in the database** — protocol-sourced orders share a `protocol_instance_id` and `protocol_version_id`, which is what makes the pilot's reuse, clarification-rate, and 90-day-retention metrics measurable. **The stated baseline is unchanged: the dashboard still starts at 11 orders · $819 · no Drafts tab.**

> **What's new in v2.12 (2026-09-10):** **Production runs on live Stripe keys, so the demo no longer enters a card; Part 3 is now run as the medical assistant; three missing beats added; and every number in the doc was re-verified against prod.**
>
> **(a) SAFETY — no card is ever entered.** Prod is on **live** Stripe keys. The old Pre-Demo item 3 told the presenter to type `4242 4242 4242 4242` into the real checkout page in Part 4B — on live keys that hard-declines on stage, and substituting a real card would put through a **real ~$286.00 charge with a real Connect payout split**. Every instruction to enter a card number has been removed from this document and from `POC-DEMO-QUICKSTART.md`. Pre-Demo item 3 is now a warning box. **Part 4B is "render and narrate"** with a scripted line that makes stopping look deliberate. **Part 4C** (`/checkout/success`) is unreachable without paying and is now marked **describe-only, not shown live**.
>
> **(b) Part 3 is performed as the medical assistant.** Previous versions narrated "the MA" while the presenter was signed in as `admin@sunrise-clinic.com` (clinic_admin). The prescribing flow now runs signed in as **`ma@sunrise-clinic.com`**, which is both honest and better theatre: the MA reaches Review and there is **no Sign & Send button** — only **"Save as Draft — Provider Signs Later"** — so the draft handoff to Dr. Chen is a genuine role switch rather than the same person logging out and back in. Clinic admin is retained for the work that is actually admin work (the new `/settings` stop).
>
> **(c) Three new beats.** **3G — Role Boundaries in Practice**: a clinic user navigating to `/ops/pipeline` lands on `/unauthorized`, pairing with the existing ops→clinic denial in Part 2; and **the MA cannot reach the signing route at all** — `/new-prescription/sign/<order-id>` bounces to `/unauthorized` in about a second, enforced in middleware rather than hidden in the UI. **3K — Clinic Settings**: a 60-second stop at `/settings`, which no prior version ever visited despite citing the clinic's default markup five times.
>
> **(d) Accuracy pass.** Catalog counts corrected to **77 Ingredients · 57 Salt Forms · 167 Formulations · 1,336 Pharmacy Offerings** (plus 6 legacy price-list items), replacing "166 formulations across 79 ingredients". DEMO-1012 (Ruby Sandoval, Blue Cedar) is **PAYMENT_EXPIRED**, not Awaiting Payment. Verified dashboard baseline added (**11 orders · $819 revenue · Pending Payment "—" · 4 completed**; tabs **All 11 / Processing 4 / Shipped 6**), with an explicit note that the **Drafts tab does not exist until a draft is saved**. Ops pipeline reads **16 of 16 orders**. Weight Loss Protocol totals **$270.20** for Alex Demo (TX). **Part 5B rewritten**: the SLA page shows **"0 SLA deadlines — All SLAs are on track or resolved"** and has no breach cards, countdown timers, escalation-tier indicators, or Acknowledge button; the empty state is now the point. Part 5A's "overdue orders show in red" claim softened to match a queue with no overdue rows.
>
> **(e) Structure.** Three consecutive sections all headed `### 3F` are renumbered **3F / 3H / 3I**; Part 3 and Part 5 step numbers are renumbered with no skips or reuse; a "confirm the session banner" checkpoint closes the Jordan-Rivera/Alex-Demo ambiguity after Part 3C-1; and the undescribed post-send "progress screen" instruction is gone.

> **What's new in v2.11 (2026-09-10):** **A "Before You Present" checklist now sits at the top of this document, and the Ops catalog screen no longer contradicts the product-count claim.** (a) New **Before You Present** section — five items to run in the five minutes before the audience joins: warm the routes (a cold serverless route measured **~37 seconds** on first hit after a deploy vs **2–5 seconds** warm), confirm all four logins, create any live prescription *during* the demo because payment links expire, don't deploy on demo day, and keep the demo tab in the foreground (a backgrounded Chrome tab does not fire `requestAnimationFrame`, which stalls React's reveal of streamed content and makes a healthy page look hung). (b) **Part 5E rewritten** — `/ops/catalog` now leads with a read-only **Product Catalog** block showing live ingredient / salt-form / formulation / pharmacy-offering counts from the hierarchical catalog the prescription builder actually uses, and the CSV uploader below it is retitled **"Legacy Pharmacy Price List (CSV upload)"** with its own item count. Previously the page read "Catalog Management — 6 items," where the 6 were rows in the legacy flat price-list table — a prospect clicking Ops → Catalog after hearing "167 products" saw an apparent contradiction.

> **What's new in v2.10 (2026-09-09):** **The state-licensure guard is now a scripted feature beat, and the partial-load behavior it produces has been corrected in the product.** (a) New **Part 3C-1** turns the per-state pharmacy licensure check into a headline selling point, run with **Jordan Rivera (CA)** against the Favorites tab, with the full pharmacy license matrix for reference. (b) New **safe-path warning box** at the top of Part 3: the scripted path uses **Alex Demo (TX)** because TX is the only state where all five pharmacies are licensed — improvising onto another patient can partially load or fully block a protocol, and the box names the specific traps. (c) **Partial protocol loads now advance.** Previously a protocol containing an item pinned to an unlicensed pharmacy loaded the licensed lines and then stranded the user on the quick-actions panel behind a red error. It now navigates to Review and carries a non-blocking **amber** notice naming each skipped medication and why; re-loading the same protocol no longer duplicates lines. (d) **Favorites and Protocols counts refreshed** — the Favorites tab reads **Favorites (10)** because `/api/favorites` is clinic-wide, and Protocols reads **Protocols (3)**. (e) **Post-#119 bundle wording** — the order drawer flips to the bundle panel in place the moment Combine succeeds; steps 37d/37e no longer tell the presenter to reopen the drawer. (f) **Table count corrected** from 33 to the verified **47 tables + 6 views** (PR #118 / GAP-3 added `protocol_template_versions`, `protocol_instances`, `order_clarifications` and three gate views).

> **What's new in v2.9 (2026-08-15):** **Demo data expansion: multi-provider, multi-state patients, lifecycle orders, second clinic** (`scripts/demo-expansion-seed.sql`, run against prod). Sunrise now has 4 providers (Dr. Chen remains the only login/signer; Dr. Marcus Patel, Dr. Elena Rodriguez, and Jamie Fletcher NP add roster realism and make the F-3 clinic-view toggle + F-5 primary-provider features demonstrable), plus a second clinic — **Blue Cedar Integrative Health** (Dr. Naomi Osei, patient Ruby Sandoval, NM) — for the ops multi-tenant view. 8 new multi-state Sunrise patients (CA/NY/FL/WA/CO/AZ/IL/GA), 17 pharmacy state licenses (every patient state covered; CA has exactly 2 licensed pharmacies for the state-filter beat), and 12 lifecycle orders `DEMO-1001`..`DEMO-1012` across the pipeline (delivered/shipped/processing/failed/payment expired) on new-catalog medications, plus 6 provider favorites and a new **"Menopause Foundation — BHRT"** protocol by Dr. Rodriguez. See the new **Demo Cast & Story Beats** subsection below the seed-data table, and the three new narration beats it introduces. Part 3B updated: the provider is now a real selection (4 providers), not auto-selected.

> **What's new in v2.8 (2026-08-15):** Four updates reflecting the post-catalog-reseed fixes verified live in the R10 walkthrough (PRs #109/#110/#111). (a) **Protocol templates now price live** — loading a protocol pulls each medication's real wholesale price and applies the clinic's default markup, and the Mold/MCAS Support protocol now includes **Ketotifen Capsule 1mg** (see the live-pricing note in Part 3C). (b) **Bundle-link recovery** — after Combine and Send, the order drawer of any bundled order shows a **"Part of a Payment Bundle"** panel with a **Copy Bundle Payment Link** button, so the link is recoverable at any time rather than only from the one-time toast. (c) **Anti-double-pay messaging** — a patient opening an old solo payment link for an order that has since been bundled sees a specific "part of a combined payment bundle" message instead of a payable checkout. (d) **Review & Send affordance** — the send button shows the hint "Sign in the signature box above to enable sending" until the provider draws a signature.

> **What's new in v2.7 (2026-07-07):** Corrected retail-default vs 2× note and Semaglutide formulation count per live R9 walkthrough.

> **What's new in v2.6 (2026-07-07):** Three substantive updates reflecting shipped changes. (a) **Full hierarchical catalog** — the POC seed replaced the prior five-medication seed with the full compounding catalog, so the cascading builder and search steps name specific formulation cards. (The counts quoted in this changelog originally read "166 formulations across 79 ingredients"; they were corrected in v2.12 to the verified **77 Ingredients · 57 Salt Forms · 167 Formulations · 1,336 Pharmacy Offerings**.) (b) **Phase C "Combine and Send"** — sibling prescriptions for the same patient + provider can be merged into a single bundled patient payment link, and the patient checkout renders them as one "Prescription Bundle · 2 prescriptions" instead of two separate links. (c) **Recomputed margin example** — the Semaglutide walkthrough now prices from a $95 wholesale ($95 → 2× → $190 retail; $14.25 platform fee; $80.75 clinic net margin), replacing the prior $150→$300 example.

> **What's new in v2.5 (2026-04-27):** Two minor doc-only updates to match the live app's current state. (a) The Ops detail drawer's SLA tab is rendered with the proper acronym capitalization ("SLA", not "Sla"); the script in Part 5A now matches. (b) The Ops pipeline now seeds demo orders across all four routing tiers (T1 API / T2 Portal / T3 Hybrid / T4 Fax), so the Tier-icon narration in Part 5A reflects the cross-tier diversity the presenter can actually click into. No flow changes; the live-demo script principle from v2.4 still holds.

> **What's new in v2.4 (2026-04-23):** This walkthrough is now a **live-demo script** — the presenter uses the app the way a real user would, and the investor sees whatever the app genuinely produces as a result of those actions. Prior versions asked the presenter to pre-stage specific visual states via a backstage `/ops/demo-tools` page right before the demo started; that pre-staging is gone. The demo no longer depends on clicking refresh buttons, setting timestamps, or forcing any screen into a specific colour state. Where earlier revisions predicted exact card counts, exact colours, or exact timestamp values on the Ops screens, those predictions have been replaced with descriptions of what each screen *is* — the specific state at demo time reflects the real activity the presenter creates during the walkthrough.

---

## Before You Present

> **Run this in the five minutes before the audience joins. Every time.** It is short, it is boring, and it is the difference between a demo that feels instant and a demo that opens with a 37-second spinner.

### 1. Warm the routes (5 minutes before, non-negotiable)

The app runs on Vercel serverless functions. A route that hasn't been hit recently — or that hasn't been hit *at all* since the last deploy — pays a **cold start** on its first request. Measured in production on 2026-09-09/10: the first request to an ops route after a deploy took **~37 seconds**. Once warm, the same routes returned in **2–5 seconds** (`/ops/pipeline` fastest, `/ops/adapters` 4.7s, `/ops/fax` 3.7s, `/ops/catalog` 2.0s).

Visit each of these once, in a tab you then leave open:

- [ ] The clinic dashboard (`/dashboard`)
- [ ] `/new-prescription`
- [ ] `/settings`
- [ ] `/ops/pipeline`
- [ ] `/ops/sla`
- [ ] `/ops/adapters`
- [ ] `/ops/fax`
- [ ] `/ops/catalog`

**If a page does lag mid-demo, say something true and move on:** *"That's a serverless cold start — the function hadn't been called yet, so the platform is spinning one up. It's a first-hit cost, not a per-request cost."* Do not freeze, and do not apologize for it as though it were a bug. It isn't one.

### 2. Confirm all four logins work

Before anyone joins, log in and out once as each of the four roles in the **POC Test Accounts** table below (Ops Admin, Clinic Admin, Provider, Medical Assistant). Use the credentials exactly as listed in that table — do not invent new ones. This doubles as route warming for the clinic app.

> **v2.12 note:** the medical assistant login is now load-bearing, not a spare. Part 3 is run as `ma@sunrise-clinic.com`. Confirm that password works before you start.

### 3. Payment links expire — create the live prescription *during* the demo

Patient payment links are valid for 72 hours, but demo state is refreshed by cron and a link minted hours early can be stale by the time you get to it. **Create the live prescription in Part 3 while the audience is watching**, then copy its link in Part 3I/3J. Do not pre-create it the night before and expect the "Copy Payment Link" beat to work.

### 4. Do not deploy on demo day

A deploy resets **every** route to cold and re-triggers the 30-second-plus first hit — including on routes you warmed ten minutes earlier. Freeze merges to `main` until the demo is over.

### 5. Keep the demo tab in the foreground

A backgrounded Chrome tab does not fire `requestAnimationFrame`. React uses it to reveal streamed content, so a page loading in a background tab can sit on its loading spinner indefinitely and then paint instantly the moment you switch back to it — the page was healthy the whole time. Keep the tab you are demoing in the foreground, and do not "pre-load the next screen in a background tab" while you talk. (This cost a full QA round to re-diagnose. One line here so nobody does it twice.)

---

## Pre-Demo Setup

Three one-time items before demo day — no backstage pages, no state-staging, nothing to click "10 minutes before the demo."

1. **Authenticator app on your phone.** The EPCS-controlled-substance signing step in Part 3H uses standard TOTP two-factor authentication per DEA 21 CFR 1311. The demo provider (Dr. Chen) has a TOTP secret already configured server-side. You need the same secret loaded into a TOTP app on your phone so you can enter the rolling 6-digit code during the signing step. Any TOTP app works (Google Authenticator, 1Password, Authy, Bitwarden). See the **Authenticator Setup** subsection below for the exact secret values.
2. **Open browser tabs.** Prepare 3 tabs so you can switch roles quickly during the demo — one for the clinic app, one for the ops dashboard, one for the patient checkout link.
3. **No payment card. Not a test card, not a real card. Read the box below.**

> ## 🛑 DO NOT ENTER A CARD NUMBER. EVER. THIS DEMO IS ON LIVE STRIPE KEYS.
>
> **Production runs on live Stripe keys.** There is no test mode on this deployment.
>
> - **A Stripe test card (`4242 …`) will hard-decline on stage.** Live keys reject test PANs outright. Earlier versions of this document told you to type one in. That instruction was wrong and has been removed everywhere it appeared.
> - **A real card will actually charge.** Typing a personal or corporate card into the Part 4 checkout puts through a **real ~$286.00 payment**, against a **real Stripe Connect payout split** to the clinic's connected account. That is a real refund, a real reversal, and a real conversation you do not want to have after a sales call.
>
> **The rule for this demo, without exception: we render the checkout page, we narrate it, and we stop.** No card number is typed. No Pay button is clicked. There is nothing to "just try quickly."
>
> This is not a limitation to apologize for — Part 4B below gives you the line to say, and stopping deliberately reads as more professional than paying, not less. The checkout page proves everything worth proving (branding, PHI safety, bundling, trust marks) **before** any button is pressed.
>
> **Optional:** a phone in your other hand to show the checkout page rendering on a real mobile browser. Same rule applies there — render only.

### Authenticator Setup (one-time, before demo day)

Dr. Sarah Chen's EPCS TOTP secret is pre-enrolled server-side so the signing flow skips first-time QR enrollment. To enter the rolling 6-digit code during the demo, load the same secret into a TOTP app on your phone once:

| Field | Value |
|-------|-------|
| Account label | `CompoundIQ Demo — Sarah Chen` |
| Issuer        | `CompoundIQ POC` |
| Secret (Base32) | `KBWXKJSXT4XFKUGUZKI2OYCNNYPUCVBH` |
| Algorithm     | `SHA-1` (default) |
| Digits        | `6` (default) |
| Period        | `30 seconds` (default) |
| `otpauth://` URI | `otpauth://totp/CompoundIQ%20Demo%20-%20Sarah%20Chen?secret=KBWXKJSXT4XFKUGUZKI2OYCNNYPUCVBH&issuer=CompoundIQ%20POC` |

Most authenticator apps accept either a QR scan of the `otpauth://` URI (generate one from a QR generator of your choice) or manual entry of the Base32 secret. Two devices recommended — a primary phone + a desktop TOTP client (e.g. 1Password, Bitwarden) — so a phone battery surprise doesn't block the demo. Verify by comparing codes across apps before the demo starts.

> **Clock drift note:** TOTP codes are clock-sensitive. If your phone's clock drifts more than ~30 seconds from the server, codes will be rejected. Make sure the phone's clock is set to automatic network time.

### POC Test Accounts

| Role | Email | Password | Redirects To | Used in |
|------|-------|----------|-------------|---------|
| Ops Admin | `ops@compoundiq-poc.com` | `POCAdmin2026!` | `/ops/pipeline` | Part 2, Part 5 |
| Clinic Admin | `admin@sunrise-clinic.com` | `POCClinic2026!` | `/dashboard` | Part 2, Part 3K (Settings) |
| Provider | `dr.chen@sunrise-clinic.com` | `POCProvider2026!` | `/dashboard` | Part 3H (signs the drafts) |
| Medical Assistant | `ma@sunrise-clinic.com` | `POCMA2026!` | `/dashboard` | **Part 3A–3G (the whole prescribing flow)** |

> **v2.12 — who you are actually signed in as matters.** Prior versions narrated "the MA does this" while the presenter was signed in as clinic_admin. The whole compliance story in Part 3G depends on genuinely being the medical assistant, so the flow now uses the MA login. Clinic admin still has a job — the `/settings` stop in Part 3K, which is real admin work.

### POC Seed Data (reference — what the app is pre-configured with)

| Entity | Details |
|--------|---------|
| Clinics | 2 — Sunrise Functional Medicine (the demo clinic) + Blue Cedar Integrative Health (second tenant for cross-clinic ops realism) |
| Providers | 5 across 2 clinics — Sarah Chen (NPI 1234567890, TX — the only auth login + signer), Marcus Patel, Elena Rodriguez, Jamie Fletcher NP (all Sunrise), Naomi Osei (Blue Cedar) |
| Patients | 10 — Alex Demo (TX, DOB 1985-06-15, SMS opt-in — the live-checkout patient) + 8 multi-state Sunrise patients (CA/NY/FL/WA/CO/AZ/IL/GA) + Ruby Sandoval (NM, Blue Cedar) |
| Pharmacies | 5 configured across all 4 tiers — Strive (Tier 4 Fax), Quick Rx + Express Digital Rx (Tier 1 API), Portal Plus (Tier 2 Portal), Hybrid Labs (Tier 3 Hybrid) — with 17 state licenses covering every patient state (CA deliberately has exactly 2 licensed pharmacies; TX has all 5) |
| Product catalog | **77 Ingredients · 57 Salt Forms · 167 Formulations · 1,336 Pharmacy Offerings** across 13 therapeutic categories — Women's Health/BHRT, Men's Health, Thyroid, Peptides, Weight Management (GLP-1), Sexual Health, Dermatology, Hair Restoration, LDN, IV Therapy, Longevity, Adrenal, Mental Health. These are the counts the Ops → Catalog page reads back in Part 5E. |
| Legacy price list | **6 price-list items** — a separate, flat CSV-import table, *not* the product catalog above. See the Part 5E narrator cue; this is the number that used to look like a contradiction. |
| Orders | 12 lifecycle demo orders (`DEMO-1001`..`DEMO-1012`) spread over ~3 weeks — 4 Delivered, 2 Shipped (with tracking numbers), 2 Pharmacy Processing, 2 Paid Processing, 1 Submission Failed (the ops triage beat), **1 Payment Expired — `DEMO-1012`, Ruby Sandoval, Blue Cedar** — plus whatever live orders the presenter creates during walkthroughs |

> **Corrected in v2.12 — DEMO-1012 is `PAYMENT_EXPIRED`, not "Awaiting Payment."** Verified in prod 2026-09-10. The cross-clinic isolation beat is unaffected and arguably lands harder: an expired payment link is a real operations story, not a tidy one. Narrate it as *"that's a Blue Cedar order whose 72-hour payment window lapsed — their problem to chase, and it is completely invisible to Sunrise in the clinic app while ops can see it clearly."*

### Demo Cast & Story Beats (v2.9)

The expanded seed gives the presenter named characters to point at. Every row below is real seeded data — pick these patients in the patient selector and the app behaves exactly as narrated.

**Patients**

| Patient | State | Primary Provider | Story beat |
|---------|-------|------------------|------------|
| Jordan Rivera | CA | Dr. Chen | **State-license filter demo** — pick Jordan and the pharmacy list filters down to the exactly 2 CA-licensed pharmacies (Strive + Quick Rx) |
| Maya Thompson | NY | Dr. Chen | East-coast realism; Progesterone order currently in Pharmacy Processing |
| Ethan Brooks | FL | Dr. Patel | **TRT story** — Testosterone Cypionate 200 with Dr. Patel (Schedule 3 → Tier 4 fax routing) |
| Sofia Nguyen | WA | Dr. Rodriguez | **BHRT story** — Estradiol cream delivered, DHEA in flight; pairs with the "Menopause Foundation — BHRT" protocol |
| Liam Carter | CO | Dr. Chen | **NAD+/longevity story** — NAD+ Injectable shipped with tracking |
| Ava Martinez | AZ | Dr. Rodriguez | Biest 80/20 cream compounding at Strive |
| Noah Kim | IL | Dr. Patel | Tadalafil delivered + the one **Submission Failed** order (ops triage beat) |
| Grace O'Connor | GA | Dr. Rodriguez | LDN 4.5 maintenance, shipped |
| Ruby Sandoval | NM | Dr. Osei (Blue Cedar) | Second-clinic patient — her **Payment Expired** order (`DEMO-1012`) proves cross-clinic isolation in the clinic app + cross-clinic visibility in ops |
| Alex Demo | TX | Dr. Chen | The original E2E checkout patient — unchanged; still the live-payment-page walkthrough subject |

**Providers**

| Provider | Clinic | Role in the demo |
|----------|--------|------------------|
| Dr. Sarah Chen | Sunrise | The only auth login + signer — every live signing flow goes through her |
| Dr. Marcus Patel | Sunrise | Roster realism + F-3 "My patients / All clinic orders" toggle + F-5 primary-provider (owns the TRT storyline) |
| Dr. Elena Rodriguez | Sunrise | Same, on the BHRT storyline; author of the "Menopause Foundation — BHRT" protocol |
| Jamie Fletcher NP | Sunrise | Mid-level realism — no seeded orders, showing a roster that isn't 1:1 with order volume |
| Dr. Naomi Osei | Blue Cedar | Second tenant — powers the ops multi-tenant view; Sunrise clinic users never see her data |

**Three narration beats**

1. **Patient-state pharmacy filtering.** Start a new prescription, pick **Jordan Rivera (CA)**, and narrate the pharmacy list: only the two CA-licensed pharmacies (Strive + Quick Rx) appear. Switch to a TX patient (Alex Demo) and all five come back. "The system will never let a clinic send a prescription to a pharmacy that isn't licensed in the patient's state — that filter is the license table, live."
2. **The provider toggle is now meaningful.** Log in as Dr. Chen and flip the F-3 **"My patients / All clinic orders"** toggle — with three prescribing providers at Sunrise the two views now genuinely differ (Chen's own patients vs. Patel's TRT and Rodriguez's BHRT orders appearing in the clinic-wide view).
3. **A living pipeline.** The dashboard and ops pipeline now show a real spread — orders in Paid Processing, Pharmacy Processing, Shipped (with tracking numbers), Delivered, plus exactly one **Submission Failed** order (order numbers `DEMO-10xx`). Use the failed order as the ops triage beat: filter to Errors, claim it, walk the History tab. "This is what Tuesday morning looks like — not an empty demo database."

---

## Part 1: The Problem (2 minutes — no demo, just talking)

> "Independent functional medicine clinics prescribe compounding medications at scale but lack the infrastructure to do so profitably. They face three compounding problems:"

**1. Sourcing is manual**
> "Finding which pharmacy is licensed in the patient's state, has the right formulation, at the best wholesale price — that's done with phone calls, spreadsheets, and tribal knowledge. There's no searchable marketplace for compounding pharmacy services."

**2. Margin math is error-prone**
> "Clinics mark up compounded medications but calculate margins manually. No real-time pricing tools, no price locking, no platform fee transparency."

**3. Fulfillment is fax-dependent**
> "The prescription gets faxed. Then you wait. No real-time tracking, no automated escalation when orders stall. Every order requires human intervention at multiple stages."

> "CompoundIQ replaces this with an AI-native system that handles the full lifecycle: search, price, pay, route, track, and deliver. Let me show you."

---

## Part 2: Login & Authentication (3 minutes)

### Show the Login Page

1. Navigate to `https://functional-medicine-infrastructure.vercel.app/login`
2. **Point out:**
   - Dark gradient background with CompoundIQ branding
   - Clean, modern design (Geist font, Tailwind CSS design system)
   - HIPAA badge indicating healthcare-grade security
   - Feature bullet points with checkmarks

> "This is the unified login for all three applications. The system uses role-based access control — where you go after login depends on who you are."

### Demonstrate Role-Based Routing

3. Log in as **Clinic Admin**: `admin@sunrise-clinic.com` / `POCClinic2026!`
4. **Point out:** Redirected to `/dashboard` — the Clinic App

> "Clinic users — admins, providers, medical assistants — all land on the clinic dashboard. They can only see their own clinic's data. Row-Level Security is enforced at the PostgreSQL level, not just application code."

5. Sign out
6. Log in as **Medical Assistant**: `ma@sunrise-clinic.com` / `POCMA2026!`
7. **Point out:** the MA lands on the same `/dashboard`, with the same KPI cards and the same order table

> "Same landing page, same data, different authority. The medical assistant sees everything the clinic admin sees — the difference shows up the moment someone tries to *do* something, not when they log in. We'll come back to that in a few minutes, and it's the most important thing in this demo."

**This is the account we run the entire prescribing workflow on in Part 3.** Do not switch back to clinic admin to "make it easier" — the whole point of Part 3G is that we are genuinely the MA.

8. Sign out
9. Log in as **Ops Admin**: `ops@compoundiq-poc.com` / `POCAdmin2026!`
10. **Point out:** Redirected to `/ops/pipeline` — the Ops Dashboard (dark mode)

> "Ops admins see a completely different application — the dark-mode operations dashboard. They have cross-clinic visibility for monitoring the entire order pipeline."

11. **RBAC demo, direction 1 of 2 — ops cannot reach the clinic app.** While logged in as ops, navigate to `/dashboard`
12. **Point out:** the `/unauthorized` **"Access Denied"** page, showing the signed-in email and role

> "Ops can't read clinic data through the clinic app. Note what the denial page tells you: who you're signed in as and what role you hold. That's deliberate — a denial that doesn't say who it denied is a support ticket."

> **The other direction is Part 3G.** Say so out loud here: *"And it works the other way too — I'll show you the clinic user hitting the ops dashboard in a few minutes."* Then actually do it. Prior versions of this script asserted both directions and only ever demonstrated one.

13. Sign out

---

## Part 3: The Clinic Workflow (15–20 minutes)

> ### 👤 You are the medical assistant for all of Part 3 (new in v2.12)
>
> **Sign in as `ma@sunrise-clinic.com` / `POCMA2026!` and stay there** through step 44. The narration says "the MA" because you *are* the MA.
>
> Why this matters: at the Review step the MA does **not** get a Sign & Send button. They get **"Save as Draft — Provider Signs Later."** That is not a UI quirk to work around — it is the product's central compliance claim, and it only lands if you are actually signed in as the medical assistant when it happens. Running this flow as clinic_admin (as versions up to v2.11 did) quietly skips the single strongest beat in the demo.
>
> The role switch to Dr. Chen happens at step 50, on purpose, in front of the audience.

> ### ⚠️ Stay on the safe path: Alex Demo (TX)
>
> **Everything from here to Part 4 is scripted against Alex Demo (TX), and that is deliberate. TX is the only state where all five pharmacies hold an active license** (Strive, Quick Rx, Express Digital, Portal Plus, Hybrid Labs). On Alex, every favorite is clickable and every protocol quick-load loads clean, all lines, first time.
>
> **If you improvise onto a different patient, expect the licensure guard to fire.** That is the product working correctly — but explain it rather than look surprised. The specific traps:
>
> - **"Menopause Foundation — BHRT" + Jordan Rivera (CA) → partial load.** The Portal Plus line is not licensed in CA, so it is skipped and the rest load.
> - **Any protocol + Maya Thompson (NY), Sofia Nguyen (WA), Grace O'Connor (GA), Liam Carter (CO), or Noah Kim (IL) → full block.** None of those states has a licensed pharmacy for every pinned item, and for these patients no item survives the check.
>
> **What a partial load actually does (shipped behavior):** the licensed medications load into the session and the app **advances to the Review step exactly as a clean load does**. On Review you get a **non-blocking amber notice** at the top — "Loaded 2 of 3 medications from Menopause Foundation — BHRT" — listing each skipped medication and the reason, e.g. *"Progesterone Capsule 100mg — Portal Plus Pharmacy is not licensed in CA."* Amber, not red: nothing is blocked, and you can save the lines that did load. If you re-click the same protocol, it will not duplicate anything — it tells you the lines are already in the session.
>
> **What a full block does:** nothing is added, so the app stays on the Protocols panel with a **red** error naming every skipped item. There is nothing to review, so there is nothing to advance to. Recover by choosing a different protocol, or by switching to Alex Demo.
>
> If a prospect asks you to try their own state, this is a great moment to lean in — see **Part 3C-1** for the scripted version of that beat.

### 3A — Dashboard Overview (as the Medical Assistant)

1. Log in as **Medical Assistant**: `ma@sunrise-clinic.com` / `POCMA2026!`
2. **Point out the dashboard.** Verified live in prod on 2026-09-10, the MA sees exactly the same dashboard the clinic admin does:

   **KPI cards (verified baseline):**

   | KPI | Value |
   |-----|-------|
   | Total Orders | **11** |
   | Revenue | **$819** |
   | Pending Payment | **—** |
   | Completed | **4** |

   > **The em dash in Pending Payment is the zero state, not a render failure.** Do not apologize for it. Sunrise currently has no order awaiting payment — the one order in that region of the lifecycle is `DEMO-1012`, it is **PAYMENT_EXPIRED**, and it belongs to **Blue Cedar**, so it could never count toward Sunrise's KPI in the first place. If anyone asks: *"That's a clean board. Nothing is sitting unpaid."* You are about to create orders during this demo, so this number will move on screen — which is a better outcome than pointing at a static tile.

   **Order table tab bar (verified):** **All 11** · **Processing 4** · **Shipped 6**

   > **⚠️ There is no "Drafts" tab right now, and that is correct.** The tabs are **count-conditional** — a tab renders only when it has at least one order in it. The Drafts tab **materializes the moment the MA saves in step 43**, and it arrives with a count (**Drafts 2** on the scripted path — one per prescription). Do not go hunting for it before then and do not tell the audience it's missing. When it appears mid-demo, that's a feature: *"That tab didn't exist ten seconds ago. The board only shows you states you actually have work in."*

3. **Point out** the order table with status badges (colored pills showing order state), and the Table/Kanban toggle in the top right
4. Click the **Kanban toggle** to show the board view

> "The medical assistant starts their day here — this is literally my screen right now. All orders at a glance, filter by status, table or kanban."

5. **Point out the sidebar:** navigation icons for Dashboard / New Prescription / Settings, the active page highlighted, and the sign-out control at the bottom

> **If a prospect asks why the clinic shows 11 orders but the ops dashboard shows 16 (Part 5A):** answer it directly, because the numbers are both correct. **11 = Sunrise's own orders**, which is all a clinic user can ever see — that's Row-Level Security doing its job. **16 = every order in the platform**, which is what ops sees: the 12 seeded `DEMO-10xx` lifecycle orders across both clinics, plus 4 ops-scaffolding rows that exist to exercise the pipeline stages. *"The gap between those two numbers is the tenancy boundary. If a clinic user could ever see 16, we'd have a HIPAA incident."*

### 3B — Patient & Provider Selection

6. Click **"+ New Prescription"**
7. **Point out the patient/provider selector page:**
   - Patient search with name filter
   - Provider selector (Sunrise has 4 providers as of v2.9 — pick **Sarah Chen**, the login/signing provider)
   - "Continue to Pharmacy Search" button (disabled until both selected)

> "The first thing I do as the MA is select the patient. The patient's shipping state auto-populates for all pharmacy searches — no manual entry. The provider is also selected upfront, and note that I'm choosing *which physician this prescription belongs to* — I'm not choosing myself. Both stay pinned at the top of every screen throughout the flow."

8. Search for **"Alex"** — select **Alex Demo** (TX state badge visible, and a green **NKDA** chip beside it — v2.17)

> **Point at the allergy chips while the list is open (v2.17).** Every patient card carries one: Alex Demo reads **NKDA**, Jordan Rivera reads **Allergies: sulfa**, and every other patient reads **Allergies: not recorded** in amber. Once Alex is selected, the chip on the selected-patient card is clickable — click it to show the **inline editor** (a comma-separated list or an NKDA checkbox; Save writes straight to the patient record), then **Cancel** so the demo data stays as scripted. The line to say: "Allergies live on the patient, entered once. Every prescription we send from here carries them — on the PDF and in the pharmacy's feed — without anyone retyping them."

9. Select provider **Sarah Chen** (the only provider with an auth login — Patel, Rodriguez, and Fletcher are seeded for roster realism and the F-3/F-5 features)

> **Expect an amber hint on three of the four provider cards.** Dr. Patel, Dr. Rodriguez, and Jamie Fletcher NP each show **"No signature on file — will capture during review"** in amber underneath their name. That is correct and not an error: only Dr. Chen has a captured `signature_hash` on file, so her card is clean. The hint is telling the MA that if they pick one of the others, the signature will be drawn live at the review step rather than pulled from file. If a prospect asks, this is the honest answer: "we don't fake a signature we don't have — we tell you up front when one has to be captured."

10. Click **"Continue to Pharmacy Search"**

> **If you run this step as Dr. Chen instead of the MA (v2.17 / WO-100), there is no provider list.** A provider login sees step 1 labelled **Patient**, the subtitle **"Prescribing as Sarah Chen. Select the patient to begin."**, and only the patient card; "Continue to Pharmacy Search" enables as soon as a patient is chosen. That is the feature, not a missing list: *"A provider is the provider — the app doesn't ask a physician which physician they are."* The MA screen described above is unchanged.

### 3C — Quick Actions: Favorites + Protocols

11. **Point out the session banner** at the top — Alex Demo + Sarah Chen pinned, with the **NKDA** chip under Alex's name (v2.17). The chip is the same control as on the selector card: click it to edit allergies from any page of the flow. Leave it as is for the scripted path.
12. **Point out the medication search box** — **v2.17:** it is the first element under the banner, and beside it sit two buttons: **Favorites (10)** and **Protocols (3)**. Nothing else is open until you click one. *"Search is where a prescriber starts, so it's at the top. The shortcuts are one click to the right."*
13. Click **Favorites (10)** — a panel opens under the search box (the count on the button reads **Favorites (10)**, verified live as the MA on 2026-09-10; the number is clinic-wide). The list is ordered by use count, most-used first:

    1. Semaglutide 0.5mg weekly
    2. Standard TRT — Cyp 200mg
    3. TRT Cyp 200 — Weekly
    4. Estradiol 0.1% Cream
    5. LDN Starter — Titration
    6. Biest 80/20
    7. LDN 4.5 Maintenance
    8. BPC-157 daily cycling
    9. NAD+ Longevity
    10. Tadalafil 10 Troche

    Note the titration/cycling badges on the relevant favorites (LDN Starter, BPC-157).

    **v2.17 — read one card's dose line out loud.** Each card now shows the formulation, the pinned pharmacy and a dose line with the mg computed from the units — the Semaglutide favorite reads **"10 units (0.5 mg) weekly"**. Point at the **Mine** checkbox (narrows the clinic-wide list to the selected provider's own favorites) and the **+ New** button (closes the panel and puts the cursor in the search box — new favorites are saved with the ☆ from the builder, the price page or a Review card). Hover a card: a **pencil** opens an inline editor (name, dose, frequency, pharmacy) and the **trash** icon still asks for a confirm before removing the favorite for the whole clinic. If you want a 10-second proof that the mg is arithmetic, click the pencil on the Semaglutide favorite, change **10** to **20**, and watch the preview line read **"20 units (1.0 mg) weekly"** — then **Cancel** so the demo data stays as scripted.

> "Provider favorites let you reorder common prescriptions in one click. No searching, no configuring — just click and go straight to pricing. Clicking a favorite lands directly on the margin page with the live wholesale price and the saved sig carried over."

> **Presenter line — say this before they ask:** "You'll notice favorites here that Dr. Chen didn't save. Favorites are **clinic-wide**, not per-doctor — Dr. Patel's TRT setups and Dr. Rodriguez's BHRT setups show up here too, ordered by how often the clinic actually uses them. That's intentional. When a new provider joins a practice, they inherit the practice's prescribing patterns on day one instead of rebuilding them from scratch." (A prospect **will** ask why another doctor's favorite is on this screen. Answer it first.)

14. Click the **Protocols (3)** button — the Favorites panel closes and the Protocols panel opens (verified count as the MA): **Weight Loss Protocol**, **Mold/MCAS Support**, and **Menopause Foundation — BHRT** (added in v2.9, authored by Dr. Rodriguez). **v2.17:** the panel has its own **+ New** — with prescriptions in the session it saves them as a new clinic protocol under a name you type; with an empty session it tells you to add prescriptions first. Do not create one during the scripted run.
15. Click **Weight Loss Protocol** to expand — show the 3 medications with phase labels and sig text
16. **Point out** the **"Load 3 Medications into Session"** button and the protocol's priced total

> **Verified anchor (prod, 2026-09-10):** with **Alex Demo (TX)** selected, **Weight Loss Protocol loads 3 medications totalling $270.20.** That is the number to say out loud. It is a real total computed from live wholesale prices with the clinic's default markup applied — not a placeholder, and not a number this document made up.

> **If you click Load, expect that it may not auto-advance — and that is fine.** Verified in prod on 2026-09-10 as the MA: after clicking **"Load 3 Medications into Session"** the app stayed on `/new-prescription/search` with the session banner showing the loaded medications, rather than jumping straight to Review. On an earlier run as the provider it advanced on its own. Handle it the same way either time: **if it doesn't advance automatically, click "Review & Send"** to reach `/new-prescription/review`. Do not click Load a second time — the lines are already in the session and the app will tell you so.

> "Protocol templates are a market-first feature. One click adds an entire multi-medication protocol to the session, priced. The provider reviews and adjusts per patient before signing."

> **Live pricing note (v2.8):** loaded protocol medications price from the live catalog — each line pre-fills its real wholesale cost with the clinic's default markup applied. The **Mold/MCAS Support** protocol is the crisp example: it loads **Ketotifen Capsule 1mg** ($22 wholesale → $30.80 retail at the clinic's 40% default markup), **Low Dose Naltrexone** ($28 → $39.20), and **Thymosin Alpha-1** ($132 → $184.80). If you expand a protocol during the demo, the prices you see are the real ones the margin builder will show.

> **What a protocol leaves behind in the data (GAP-3 — a credibility point, not a screen to show).** Verified in prod on 2026-09-10: every order created from a protocol load is linked back to the protocol, carrying the same `protocol_instance_id` and `protocol_version_id`, with the template auto-published at **version 1** on first use. That linkage is what makes the pilot's protocol-reuse rate, clarification rate, and 90-day retention measurable per protocol *and per version*, rather than estimated. One sentence is enough for a practitioner or investor: *"Every prescription written from a protocol stays attached to that protocol and that exact version, so we can tell you which of your protocols actually get reused and which ones generate pharmacy callbacks."*

### 3C-1 — The State-Licensure Guard

> **Run this beat.** It is 90 seconds, it needs no setup, and it lands a compliance argument that no slide can. It is also the single most common objection-killer in this demo: every clinic owner in the room has either paid for this mistake or knows someone who has.

17. Open the patient selector again (**"+ New Prescription"**) and this time select **Jordan Rivera** — the **CA** state badge is visible on the card, next to a red **Allergies: sulfa** chip (v2.17). Keep **Sarah Chen** as the provider and continue.

18. Land on the configure page and click **Favorites (10)** to open the panel. Same 10 favorites as before — but **3 of the 10 are now grayed out and un-clickable**, each carrying a red **"not licensed in CA"** pill.

19. **Point at one of the grayed cards and read the line underneath it out loud.** It names the pharmacy explicitly — for example *"Portal Plus Pharmacy is not licensed in CA — choose a licensed pharmacy for this patient."* Read whatever the screen actually says; the three that gray out are the favorites pinned to a pharmacy with no active CA license.

> "Watch what just happened. I didn't change a setting, I didn't run a report, I didn't ask anyone. I picked a patient who lives in California, and the platform immediately took three prescribing options off the table — and told me exactly why, by pharmacy name. The clinic **physically cannot** route this patient's prescription to a pharmacy that isn't licensed in her state. Not 'we'll warn you.' Not 'check the box to confirm.' The button is gone."

20. **Land the value.** "This is the failure mode that costs real clinics real money. A pharmacy fills across a state line it isn't licensed in, and now you're looking at a board complaint, a refund, an insurance problem, and a very bad week. The usual defense is a spreadsheet somebody updates when they remember to. Ours is a license table checked at the moment of prescribing, on every single line, for every single patient."

21. **If they push on protocols (optional):** expand **Menopause Foundation — BHRT** while Jordan Rivera is selected. The unlicensed line is flagged in the expanded list with **"not licensed in CA — will be skipped"** before you commit. Click **Load** and the app loads the licensed medications, advances to Review, and shows the amber notice naming what was skipped and why. "It doesn't refuse to help me. It does the part it's allowed to do, hands me the rest of the visit, and puts the compliance problem in writing."

22. **Switch back to Alex Demo (TX)**, open **Favorites (10)** again and show all 10 clickable. "Same clinic, same favorites, same provider. Texas patient — everything's open, because in Texas all five of our pharmacies are licensed. The guard isn't a blanket restriction; it's the actual license map, applied per patient."

**Pharmacy license matrix (reference — keep this in your back pocket):**

| Pharmacy | Tier | Licensed states |
|----------|------|-----------------|
| Strive | Tier 4 Fax | TX, CA, FL, AZ |
| Quick Rx | Tier 1 API | TX, CA, CO |
| Express Digital Rx | Tier 1 API | TX, NY, IL |
| Portal Plus | Tier 2 Portal | TX, NY, WA, GA |
| Hybrid Labs | Tier 3 Hybrid | TX, FL, CO, NM |

> Read down the TX column: every pharmacy. That is why the scripted path uses a Texas patient. Read down CA: Strive and Quick Rx only — which is exactly why three favorites gray out for Jordan Rivera.

### 3D — Cascading Prescription Builder

> ### ✅ Checkpoint before you continue — read the session banner out loud
>
> **Part 3C-1 may have left you on Jordan Rivera (CA).** Everything from step 24 onward assumes **Alex Demo (TX)**. If you are still on Jordan, the Strive/Semaglutide path in step 30 may behave differently and the $190/$96/$286.00 pricing anchors will not match.
>
> **Look at the pinned session banner at the top of the screen. It must read `Alex Demo` and `Sarah Chen`.** If it does not, go back through **"+ New Prescription"**, reselect Alex Demo + Sarah Chen, and continue. Ten seconds now; a derailed pricing beat otherwise.

23. Confirm the session banner reads **Alex Demo · Sarah Chen**, then go to Configure Prescription.
24. Type **"Sema"** in the medication search — select the ingredient **Semaglutide**
25. **Point out** the cascading dropdown flow: ingredient **Semaglutide** → salt form **Semaglutide** (base — the builder auto-skips this level because it's the only salt option) → dosage form **Injectable Solution** → route **Subcutaneous** → formulation card. Selecting the single ingredient **Semaglutide** surfaces **5 formulations directly**: Injectable 2.5, 5, and 10 mg/mL, an Oral Capsule, and a Sublingual Tablet. (The two combination products, Semaglutide + B12 and Semaglutide + Niacinamide, are reached via the combination path by selecting one of their component ingredients, not from this single-ingredient formulation list.) The presenter picks the specific **"Semaglutide Injectable 5 mg/mL"** card. Its wholesale is **$95**.
26. Select the **"Semaglutide Injectable 5 mg/mL"** card → **Point out the Structured Sig Builder**:
    - Dose amount + unit + frequency dropdowns
    - Timing dropdown (In the morning, At bedtime, etc.)
    - Duration dropdown (For 30 days, Ongoing, etc.)
    - Mode toggles: **Standard** / **Titration** / **Cycling**
27. Set dose: **10 units**, frequency: **Once weekly**, timing: **In the morning**, duration: **For 30 days**
28. **Point out** the auto-generated sig: "Inject 10 units (0.10mL / 0.50mg) subcutaneous once weekly in the morning"

> "The sig generates automatically with full unit conversion — mg, mL, and syringe units for injectables. No manual math. NCPDP-compliant with a 1,000-character limit counter."

29. **Show Titration mode** — click "Titration" toggle. Point out the amber panel with Start at / Increase by / Every / Up to fields

> "For titration protocols like LDN, the provider sets start dose, increment, interval, and target. The sig generates: 'Take 0.1mL by mouth at bedtime. Titrate up by 0.1mL every 3-4 days as tolerated up to 0.5mL.' No competitor has this."

30. Click back to **Standard** mode. Select **Strive Pharmacy** in the Pharmacy & Pricing section. **v2.18:** Strive's row shows **$95.00** with **1 mL vial** under the price, and below it every vial Strive sells with its own price — **"1 mL vial $95.00 · 2.5 mL vial $165.00 · 5 mL vial $285.00"**. *"The app worked out that 10 units a week for 30 days is 0.4 mL, so the 1 mL vial is enough — and that's the price you're looking at."* (Other pharmacies that list one price for every size still show their "Available:" list.)
31. **v2.18: there is no Quantity dropdown for Strive** — the suggested vial from step 30 *is* the quantity, and it can be changed with its price on the next screen. Leave refills at 0. (For a pharmacy with a single package, Quantity is still pre-filled with the smallest vial that covers 30 days, as in v2.17.) **Point out the ☆ button** next to "Continue — Set Retail Price" — **v2.17:** clicking it opens a name field already filled in as **"Semaglutide Injectable 5 mg/mL 10 units weekly"** (drug, dose, frequency); the same ☆ appears again on the price page and on every Review card, so a favorite can be saved at whichever point the provider decides it is worth keeping. Don't save one during the scripted run — the seeded list is what the Favorites beat counts on.

> **v2.17 — nothing to pick.** The next screen shows **Days supply 30 days** (the duration from step 27) and **Dispense 0.4 mL** (4 weekly doses × 0.1 mL). If you skip the duration in step 27, both are computed from the pre-selected vial instead — never a dash. **v2.18:** with no duration there is nothing to size the vial from, so Strive's default **1 mL vial** is used and labelled "default package — no duration selected".

> "The star saves this configuration as a provider favorite for one-click reorder next time."

32. Click **"Continue — Set Retail Price"**

### 3E — Dynamic Margin Builder + Multi-Prescription

> **Set Retail Price note:** The retail field pre-fills at **$133.00** (the clinic's 40% Default Markup); the **$190.00** figures below assume the presenter taps the **2×** button. Without that tap, the retail stays at the $133.00 default and the platform fee, clinic margin, and $286.00 bundle total are all smaller. **Tap 2× if you want the numbers in this script to match the screen.**

33. **Point out the Margin Builder** — Wholesale: $95 (locked), retail price **pre-populated at $133** (1.4× wholesale, from the clinic's 40% default markup), multiplier buttons, Sig field pre-filled, and — **new in v2.16** — under the sig, **Days supply: 30 days · Dispense: 0.4 mL** — the 30-day duration from step 27 and 4 weekly doses of 10 units (0.1 mL each) — with an **Override** link (v2.17, WO-96 fix; previously this read 350 days / 5 mL from the vial size). **v2.17:** the locked-cost card reads **"Injectable Solution · 10 units (0.5 mg)"** — the mg is computed from the syringe units and the 5 mg/mL concentration — and carries a **☆ Save as favorite** button under the pharmacy line. **v2.18:** right under "via Strive Pharmacy" the card reads **"Package: 1 mL vial (suggested for 30 days) · $95.00"** with a **Package** dropdown listing all three vials and their prices. **v2.19:** a small number box beside the dropdown shows **1** — it is how many vials; the app fills it in (2 or more only when one vial cannot hold the prescription, e.g. 80 units weekly for 90 days → 2 × 5 mL vials, $570.00).

> **v2.18 — show that cost follows the vial (optional, 20 seconds).** Open the **Package** dropdown and pick **2.5 mL vial — $165.00**: the locked wholesale changes to **$165.00**, the retail keeps the same markup (**$133.00 → $231.00**), and the platform fee and clinic margin recompute; the label now says "(changed by provider)". Pick **1 mL vial — $95.00** again to return to **$133.00** before continuing, so the scripted numbers match. *"Vial size is a choice the provider can make — and it's priced, not cosmetic. But the app already picked the right one."* If asked about a bigger dose: at **40 units** weekly for 30 days (1.6 mL) the suggestion becomes the **2.5 mL vial at $165.00** without anyone choosing it.

> "Nothing on this screen was typed that the app could have worked out. Days supply and dispense are arithmetic on the sig and the vial — the provider only touches them to override."
34. Click **2x multiplier** — retail updates to $190, margin 50%, platform fee $14.25 (15% of the $95 spread), est. clinic margin $80.75

> "Full transparency. The retail price is pre-filled from the clinic's default markup setting — currently 40% — so I never type a number unless I want to override it. Clicking 2x bumps it to a higher margin. The clinic sees exactly what they earn before committing. The sig is already pre-filled from the builder."

> **Forward-reference — say it here, deliver it in Part 3K:** *"That 40% isn't hard-coded, and it isn't something you call us to change. It's a field the clinic owns. I'll show you exactly where it lives before we're done."* Then actually show it (Part 3K). Every prior version of this script cited the 40% default five times and never once opened the page it comes from.

35. **Point out the three action buttons:**
    - **"Add & Search Another"** — add this prescription and search for another medication
    - **"Review & Send"** — go to batch review with all prescriptions
    - **"Save as Draft — Provider Signs Later"** — save without signing (WO-77)

> "I have three choices. Add more prescriptions for this same patient, go to review, or save it as a draft for Dr. Chen to sign later. Hold that third one in your head — it's about to become the only one I'm allowed to use."

36. Click **"Add & Search Another"**
37. **Point out** — back on configure page, session banner shows **"1 prescription in this session"**
38. Search for **"Testosterone"** → three results now appear (**Testosterone**, **Testosterone Cypionate**, **Testosterone Propionate** — topical/pellet testosterone is modelled as the bare "Testosterone", while the injectable esters are separate top-level ingredients). Select **Testosterone Cypionate** → **Point out DEA Schedule 3 warning banner**
39. Cascade: salt form **Cypionate** (auto-skips as the only option) → dosage form **Injectable Solution** → route **Intramuscular** → formulation **"Testosterone Cypionate Injectable 200 mg/mL"** → set dose + frequency. Select Strive Pharmacy, set retail price. The Testosterone Cypionate 200 mg/mL wholesale is **$48**, and the same **2x multiplier** the demo uses puts its retail at **$96.00**. Click **"Review & Send (2)"**

### 3F — Batch Review, Interaction Alerts & the MA Signing Wall

40. **Point out the batch review page:**
    - **Controlled Substance banner** at the top when any prescription in the session is DEA-scheduled (appears because Testosterone Cypionate is Schedule 3)
    - **Drug Interaction Alerts section** — alerts are dynamic based on the medications in the current session. With Semaglutide + Testosterone (this walkthrough), an INFO-severity alert appears with clinical guidance. With different pairings (e.g. Ketotifen + Ketamine), a WARNING-severity alert appears instead. The alert text comes from the drug-interactions knowledge base.
    - Session banner showing the prescription count (and the **NKDA** chip — v2.17)
    - **v2.17 — no allergy notice for Alex Demo.** If a patient with nothing recorded were pinned here, an **amber "Allergies not recorded" notice** would sit above the cards with a one-click **Confirm NKDA**; it never blocks Save as Draft or Sign & Send. Alex (NKDA) and Jordan (sulfa) never show it — mention it, don't demo it.
    - One prescription card per medication with pharmacy, pricing, and sig
    - Combined totals (total retail, platform fee, total clinic payout)
    - "Remove" link on each card, and — **v2.17** — a **☆ Save as favorite** button beside it on every card; the dose line on each card shows the computed mg (**"Injectable Solution — 10 units (0.5 mg) — Strive Pharmacy"**)
    - **v2.16 — an "Rx details" row on each card.** Semaglutide's is **open** with the clinical-difference picklist already set to its first option and **Cold chain** shipping pre-selected; Testosterone Cypionate's is **open** asking for a diagnosis (see the box after step 42). Expand either to show refills, substitution, syringe kit, shipping, diagnosis and special instructions all pre-filled.
    - "+ Add Another Prescription" button
    - **v2.17 — "Edit" next to "Remove" on every card, and a "Back" button beside "+ Add Another Prescription".** Edit reopens the builder for that line with its values pre-selected; saving returns here with the card updated in place and the totals recomputed. Back returns to the search page with every prescription still in the session.

> "The system automatically detects drug interactions and surfaces them with clinical guidance — severity-coloured: red for critical, amber for warning, blue for informational. DEA-scheduled compounds trigger the red banner."

41. **Now stop and point at what is NOT on this page.** Verified live as the MA on 2026-09-10: **there is no "Sign & Send" button.** In its place the page offers **"Save as Draft — Provider Signs Later"**, accompanied by an on-screen message that **only the assigned provider can sign this prescription.**

> **Presenter line — slow down and deliver this one properly:**
>
> "I want you to look at this screen carefully, because this is the moment the whole product justifies itself.
>
> I've done the entire visit. I picked the patient, I checked the pharmacy licensure, I built two prescriptions with structured sigs and unit conversion, I priced them, I've got the interaction check in front of me. Everything a well-run clinic needs a medical assistant to do, I've done.
>
> And there is no send button. There is no sign button. The system will not let me finish, because I am not a prescriber. My only option is to hand it to Dr. Chen.
>
> That's not a setting somebody remembered to switch on for this demo. That's the role."

42. **Point out** that the page does not merely hide the signing control — it explains it. Read the message naming the assigned provider out loud rather than paraphrasing it.

> **v2.16 — enter a diagnosis for Testosterone Cypionate before step 43.** Testosterone is Schedule III, so its **Rx details** row opens on its own with the **Diagnosis code** field focused and an amber note, and **"Save as Draft" stays disabled** with the hint *"Complete Rx details to enable saving drafts: Testosterone Cypionate … needs a diagnosis (controlled substance)"* until one is entered. Type **E29.1** (or any diagnosis text). The field is pre-filled automatically once the clinic has a prior order for the same formulation with a diagnosis on it — on a fresh seed it is empty. Semaglutide needs nothing: its clinical-difference statement is already selected. Narrate it: *"A controlled substance leaves here with a diagnosis on it, and the compounded GLP-1 leaves with its 503A statement — the pharmacy stops calling back for either."*

43. Click **"Save as Draft — Provider Signs Later"**

> **Expect two drafts, not one — this is verified, not assumed.** A session of **N prescriptions saves as N separate draft orders**, one per medication. This script has the MA build **2** (Semaglutide + Testosterone Cypionate), so you get **2 drafts**, and the app redirects to `/dashboard?draft=2`. Confirmed in a live prod dry run on 2026-09-10, where a 3-medication protocol session produced **3** separate draft orders and redirected to `/dashboard?draft=3`. Say the count out loud before the audience counts the rows: *"Two prescriptions, two drafts. Each one gets its own signature — a physician signs prescriptions, not shopping carts."*

44. Navigate back to the dashboard (the save has already taken you there).

> **Watch the tab bar.** It read **All 11 · Processing 4 · Shipped 6** in step 2. It now reads **All 13 · Drafts 2 · Processing 4 · Shipped 6** — a **Drafts** tab exists, because there is now something in it. Point at it: *"That tab wasn't there when we started. The board only shows states you actually have work in — and now the clinic has work waiting on a physician."*

> **Then point at the KPI cards, because one of them did not move.** **Total Orders** goes **11 → 13** (it rises by one per draft). **Revenue is still $819 — unchanged.** **Completed** is still **4**, and **Pending Payment** is still **"—"**; both stay put until the provider signs in Part 3H. Narrate the gap, it is a good detail: *"Notice the order count moved and the revenue didn't. A draft isn't money. Nothing counts as revenue on this board until a physician has signed it and the patient has paid."*
>
> **Verified in prod 2026-09-10** with a 3-draft save from the Weight Loss Protocol: the dashboard read **All 14 · Drafts 3 · Processing 4 · Shipped 6**, **Total Orders 14**, **Revenue still $819**, **Completed 4** — three Draft rows, all "Demo, Alex", one per protocol medication, all method Fax. Same rule, different N.

### 3G — Role Boundaries in Practice (RBAC, both directions + the signing wall)

> **Two 30-second navigations. Do both.** Up to v2.11 this document *asserted* that clinic users can't reach ops and that the MA can't sign, and demonstrated neither. Both are now verified live in prod (2026-09-10) and both take one URL each. This is the cheapest credibility in the entire demo.

45. **Direction 2 of 2 — a clinic user cannot reach the ops dashboard.** Still signed in as the MA, type `/ops/pipeline` into the address bar.
46. **Point out:** you land on **`/unauthorized`**, showing **"Access Denied"**, **"Signed in as `ma@sunrise-clinic.com`"**, and **"Role: medical_assistant"**.

> "In Part 2 you watched the ops admin get bounced out of the clinic app. This is the mirror. Same enforcement, opposite direction. And again — the page tells me who I am and what role I hold, so a real user files a useful ticket instead of 'the site is broken.'"

> **Verified for both clinic roles.** `clinic_admin` (`admin@sunrise-clinic.com`) and `medical_assistant` (`ma@sunrise-clinic.com`) both land on `/unauthorized` from `/ops/pipeline`. If a prospect says "sure, but the *admin* can probably get in" — that is the answer, and you can run it live in ten seconds.

47. **The hard stop — the MA cannot reach the signing route at all.** Still the MA, take the order ID of any order (either draft you just saved works, or any order ID visible on the dashboard) and navigate directly to `/new-prescription/sign/<order-id>`.
48. **Point out:** bounced to **`/unauthorized`** in about a second. Your session is intact — you are still signed in, you are still the MA, you simply cannot be on that page.

> **Presenter line:**
>
> "This is the part that separates us from software that just hides buttons.
>
> A minute ago you saw there was no Sign button on my screen. A sceptical engineer in your practice would say: fine, the button's hidden, but what happens if I know the URL? So let's find out. I'm going to type the signing page's address directly.
>
> [navigate] Access Denied. One second, and I'm out. I'm still logged in — my session is fine — I just can't be there.
>
> That check isn't in the page. It's in the middleware, in front of the route, before any prescription data is loaded. **A medical assistant on this platform can prepare absolutely everything and physically cannot sign a prescription.** There's no hidden button to un-hide, no browser trick, no 'just this once.'
>
> And that is exactly why the draft queue exists. If the MA can't sign, the work has to go somewhere — so it goes to the physician's queue, with an audit trail. Let me log in as Dr. Chen and pick it up."

> **Verified in prod 2026-09-10:** both `/new-prescription/sign` and `/new-prescription/sign/<uuid>` redirected the MA to `/unauthorized` in ~1–2.3 seconds, with the session intact. If it takes 3 seconds on stage that's a cold start, not a failure — say so and carry on.

49. **Sign out** of the medical assistant account.

### 3H — Provider Signature Queue (the draft handoff)

> "The MA prepared it. The MA could not sign it. Now the physician picks it up — different person, different login, different authority, same clinic."

> **Know before you log in: there are two drafts and you will sign each one.** An N-prescription session saves as N separate draft orders (see step 43), so the scripted flow leaves **2** drafts in the queue — Semaglutide and Testosterone Cypionate — and Dr. Chen signs them one at a time. That is two passes through steps 52–55. Budget the time and say it out loud rather than letting the audience discover a second row after you thought you were finished.

50. **Log in as provider:** `dr.chen@sunrise-clinic.com` / `POCProvider2026!`
51. Click the **"Drafts"** tab on the dashboard — it reads **Drafts 2** and holds one draft order per prescription the MA built

> **The Drafts tab exists now because the MA saved in step 43.** It is count-conditional (see step 2). If you skipped step 43, there is no tab and nothing to sign — go back and save the drafts.

> "The Drafts tab lives on the shared dashboard and is visible to both clinic_admin and provider roles — anyone in the clinic can see what's pending signature, not just providers. The provider just happens to be the one who can act on it. The MA can watch the queue; she just can't clear it."

52. Click the **first** draft order — **point out the amber "Awaiting Provider Signature" banner**
53. Click **"Review & Sign This Prescription"**

> "Same URL that bounced the MA out thirty seconds ago. Dr. Chen walks straight in."

54. **Point out** the sign page: patient info, provider info, prescription details, financial summary, signature pad. Note the send control starts disabled with the hint **"Sign in the signature box above to enable sending"** underneath it.

> "No silent failures. Until the provider actually draws a signature, the send control is disabled and says exactly why."

> **v2.17 — before signing, point at the "Draft lines" box.** It lists this draft line (badge **signing now**) and any sibling drafts for the same patient and provider, each with **Edit** and **Remove**, plus **"+ Add prescription"**. Click **Edit** on Semaglutide: the builder reopens with Semaglutide, Strive, 10 units and once weekly already selected — change the dose to 15 units, continue, and **"Save Changes to Draft"** brings you straight back here with the line updated and the **same order id**. Click **"+ Add prescription"** to append a line (patient and provider are pinned from the draft). Open the order drawer afterwards and the timeline shows **"Draft edited · changed dose, sig …"** with the provider as the actor. Remove is a soft delete — the row keeps its id with `deleted_at` set. Optional for the scripted flow; skip it if time is short.

55. **Sign** on the pad — watch the hint clear and the button enable. Click **"Sign & Send Payment Link"** → Confirm.

> **EPCS 2FA:** the EPCS two-factor modal surfaces here for the **Testosterone Cypionate** prescription because it is DEA Schedule 3 — a red **"EPCS Two-Factor Authentication Required"** header, a Schedule badge, a 6-digit TOTP input citing DEA 21 CFR 1311, and **"Verify & Sign"** / **"Cancel"** buttons. Read the current 6-digit code from the authenticator app you set up before demo day and enter it. The Semaglutide prescription is not scheduled and does not trigger the modal.

> "Controlled substance, so the platform asks the physician for a second factor before it will accept the signature. This is DEA 21 CFR 1311, and it is not optional — there's no way to sign a Schedule 3 on this platform without it."

56. **Sign the second draft the same way.** Return to the **Drafts** tab, open the remaining draft, and repeat steps 52–55. There are exactly **2** drafts and each is signed individually — **one signature per prescription**. The EPCS two-factor modal appears only on the **Testosterone Cypionate** draft; the Semaglutide draft signs without it. When both are signed the Drafts tab empties and disappears, and both Alex Demo orders read **"Awaiting Payment."** Confirm that on the dashboard before moving on.

> **Say the count; don't hedge it.** Verified in prod 2026-09-10: an N-prescription session saves as N separate drafts and the provider signs each one — this is settled behaviour, not something to discover on stage. Narrate it as the design rather than as a surprise: *"One signature per prescription. That isn't friction we forgot to remove — it's what a signature means."* Do still avoid promising the audience a specific screen between clicking Confirm and landing back on the dashboard.

> "The MA prepared it, the provider signed it later. Different sessions, different logins, one audit trail. This is how a real clinic actually works — and now it's how the software works too."

> **Optional beat — "Sign as me" (v2.17 / WO-100, only if a draft belongs to another provider).** The two scripted drafts are Dr. Chen's, so this does not appear in the script. If the MA saved a draft under **Dr. Patel** (say, during an improvised 3B) and Dr. Chen opens it from **All clinic orders → Drafts → Review & Sign This Prescription**, the sign page shows an amber **"This draft is assigned to Marcus Patel — You are signed in as Sarah Chen"** panel with a **Sign as me** button in place of the signature pad. Click it: every line of that draft moves to Dr. Chen, the audit trail records the reassignment from Patel, and the same page becomes the ordinary signing form (steps 54–55). *"Dr. Patel is out today. Dr. Chen takes the draft over under her own name and license — and the record says exactly who took it from whom."* The order shows provider = Chen from then on.

### 3I — Phase C: Combine and Send

> "Those two prescriptions are siblings — same patient (Alex Demo), same provider (Dr. Chen), both **Awaiting Payment**. Before Phase C, that meant two separate payment links the patient had to open and pay one at a time. Now we bundle them into a single checkout."

57. On the dashboard, both Alex Demo orders (Semaglutide + Testosterone Cypionate) show **"Awaiting Payment."** Click either one to open the **order drawer**.
58. **Point out the "Combine into one payment link" picker** — it lists the sibling order (the other Awaiting-Payment Rx for the same patient + provider) with a selectable checkbox.
59. Select the sibling order, then click **"Combine and Copy Payment Link."**
60. **Watch the drawer flip in place — do not close it.** The moment Combine succeeds, the solo **"Copy Payment Link"** block disappears and is replaced, in the same open drawer, by the **"Part of a Payment Bundle"** panel showing the prescription count and bundle total (**"2 prescriptions · $286.00"**) with a **"Copy Bundle Payment Link"** button. The dashboard rows behind the drawer update immediately too. One bundled checkout link covering both prescriptions is now on your clipboard — Semaglutide $190.00 + Testosterone Cypionate $96.00; the **$190.00** assumes the **2×** tap, it defaults to $133.00. This is the link you'll paste in Part 4.

> "One link, both prescriptions, one payment. The patient taps once and pays a single combined total instead of juggling two links. Notice the drawer rewrote itself the instant the bundle existed — there's no refresh, no reopen, no stale button sitting there offering to do something that's no longer valid. The per-order 'Copy Payment Link' button still exists for single-prescription orders — but when a patient has multiple prescriptions from one visit, Combine and Send is the default."

61. **Bundle-link recovery (optional — narrate or demo).** The bundle panel is not a one-time state. Close the drawer, click **either** bundled order, and the same **"Part of a Payment Bundle"** panel and **"Copy Bundle Payment Link"** button are there — same link, same total.

> "The bundle link isn't a one-shot copy. If the toast gets dismissed or the clipboard gets overwritten, open any bundled order's drawer and re-copy the same link — no re-bundling, no support ticket."

62. **Anti-double-pay talking point** (no extra clicks needed — narrate, or demo it if you kept an old solo link): if the patient opens an *old* per-order payment link for an order that has since been bundled, the checkout refuses it with a specific message that the prescription is now **part of a combined payment bundle** — not a payable page, not a generic error.

> "That's deliberate. Once prescriptions are bundled, there's exactly one way to pay — the bundle link. A stale solo link can never produce a second charge for the same prescription."

### 3J — Get the Checkout URL (in-app, no terminal)

63. **Copy the patient checkout URL.** For the bundled pair you already have it from step 60. For any single order: on the clinic dashboard, click an order showing **"Awaiting Payment"** to open the order drawer, then click the emerald **"Copy Payment Link"** button — the checkout URL is on your clipboard.

> "In production, the patient gets this link in a text message when the order is signed. They tap it on their phone and land directly on checkout. In a live clinic we'd never copy-paste the link — we're doing that here only because this is a demo. If the link ever expires, the same button changes to **Regenerate Payment Link** and mints a fresh 72-hour URL in one click."

### 3K — Clinic Settings: where the markup and the money live (60 seconds, as Clinic Admin)

> **Do not skip this.** You have now quoted the clinic's **40% default markup** four or five times without ever showing where it comes from. It takes one minute, it answers the "can we change that?" question before it's asked, and it is the natural place to explain how the clinic actually gets paid. This is also the one part of the demo that is genuinely **clinic-admin** work — the MA does not administer the clinic's payout account.

64. **Sign out** and log in as **Clinic Admin**: `admin@sunrise-clinic.com` / `POCClinic2026!`. Navigate to **`/settings`** (Settings in the sidebar).
65. **Point out the page shell:** the heading **"Clinic Settings"**, the subtitle *"Manage your clinic profile, Stripe payout account, and default pricing."*, and the **sticky section nav** down the left with three anchors: **Stripe Connect**, **Clinic Profile**, **Notifications**.
66. **Stripe Connect** — the section renders as **"Stripe Payout Account"** with the subtitle *"Required to receive clinic payouts from patient payments."* and a **status badge** in the top-right reading one of **Pending / Onboarding / Active / Restricted / Deactivated**. Read whatever badge is actually showing. If the account is not yet fully verified, a **"Start Onboarding"** / **"Continue Onboarding"** button appears; if it is verified you get a green **"Payouts active"** panel with the connected account ID.

> "This is how the clinic gets paid, and it is the clinic's own Stripe account — not ours. We use Stripe Connect Express, which means when a patient pays, the money splits at the moment of the charge: the clinic's margin lands in the clinic's account, our platform fee lands in ours. We are never holding your money and remitting it to you later. There is no float, no monthly settlement, no invoice from us.
>
> And note what the banners say when onboarding isn't finished: **order intake is blocked.** We won't let a clinic take a patient's money into an account that can't legally receive it. That's a guardrail, not a bug."

67. **Clinic Profile** — the section shows the **Clinic Name** (display only — "Sunrise Functional Medicine"), the **Default Markup %** field, the **Logo URL** field with a live preview thumbnail, and a **Save Settings** button.

68. **Point at Default Markup % and connect it back to Part 3E.** This is the field that pre-filled the retail price in the Margin Builder. The helper text under the input states the convention explicitly: *"Pre-fills the retail price in the Margin Builder. Example: 150 = 150% of wholesale (1.5× markup)."* **Read the number the field actually contains** — Sunrise's value is the one that produced the $133.00 pre-fill on a $95 wholesale in step 33.

> "Remember that retail price that appeared already filled in when I got to the margin screen? It came from here. One number, set once by the practice, applied to every prescription every clinician writes — and any of them can still override it per-prescription, which is what I did when I tapped 2×.
>
> That's the difference between a pricing *policy* and a pricing *argument*. The practice owner sets the floor, and nobody has to remember it."

69. **Logo URL** — note the preview: this logo is what the patient sees at the top of the checkout page in Part 4.

> "White-labeling isn't a professional-services engagement. It's a field."

70. **Notifications** — the third section is honest about not being built yet. It reads: *"Email and SMS notification preferences are not yet configurable. Order status updates are sent automatically based on your clinic's registered contact email,"* with a **"Coming soon — configurable preferences"** chip.

> **Do not skip past this or apologize for it.** Say it plainly: *"Notifications go out today on the clinic's registered contact email; per-user preferences are on the roadmap and the page says so. We'd rather show you a labelled gap than a screen that pretends."* Prospects trust a product that admits its edges. This one costs you nothing and buys you credibility for everything else you just claimed.

---

## Part 4: Patient Checkout (4–5 minutes)

> ## 🛑 Reminder before you open this tab: production is on LIVE Stripe keys.
>
> **No card number is entered in Part 4. None.** A test card will hard-decline; a real card will really charge ~$286.00 with a real Connect payout split. **We render the page, we narrate it, and we stop.** Part 4B gives you the words.

### 4A — Checkout Page

1. Paste the **bundled checkout URL** copied in the Combine-and-Send step (Part 3I) into a new tab (or into a mobile browser for extra impact)
2. **Point out:**
   - Clinic branding: "Sunrise Functional Medicine" displayed prominently — the logo from the Logo URL field you just saw in Part 3K
   - **"Prescription Bundle · 2 prescriptions · $286.00"** — the two sibling Rx now share one checkout instead of two separate links
   - Two generic line items, each labeled **"Prescription Service"** — NOT the medication name
   - A single **combined total of $286.00** — the sum of the two retail prices set in Part 3E (Semaglutide $190.00 + Testosterone Cypionate $96.00; the **$190.00** assumes the **2×** tap — it defaults to $133.00). The patient pays this one combined amount, once.
   - **Email field** ("Email for receipt") — required, above the Stripe payment form. Stripe auto-emails a branded receipt to this address when the charge succeeds.
   - Stripe Elements payment form below (card + whichever wallet options the patient's device supports — e.g., Apple Pay in Safari on iOS, Google Pay in Chrome on Android, Cash App Pay, Bank, Affirm, Amazon Pay)
   - Trust signals: "256-bit TLS Encryption", "Powered by Stripe"
   - Footer: "Your payment info is encrypted and never stored by CompoundIQ"

> "This is what the patient sees. No login, no app download, no account creation. They tapped a link in a text message and landed here — and both prescriptions from today's visit are on one page as a single bundle. Notice — no medication name anywhere. HIPAA compliance means zero Protected Health Information touches Stripe or appears on any patient-facing surface."

3. **Point out the white-labeling:**

> "The patient sees their clinic's name and branding. They don't know CompoundIQ exists. This is a branded checkout experience for the clinic."

### 4B — Render and Narrate (we deliberately stop here)

> **This is a narration beat, not a transaction beat. Nothing is typed into the payment form. The Pay button is never clicked.**

4. **Leave the form empty and say this — out loud, unhurried, as a deliberate choice rather than an apology:**

> "Now — I'm going to stop right here, and I want to tell you exactly why.
>
> This is our production environment on live payment credentials. That Pay button is real. If I click it, a real card gets charged two hundred and eighty-six dollars, and Stripe really splits that money into a clinic's payout account. **I'm not going to run a live charge on somebody's real payment rail to decorate a demo.** If I were willing to do that here, you should wonder what else I'd be willing to do in your practice.
>
> And I don't need to click it, because everything worth proving is already on this screen. Look at what this page is telling you:
>
> **Your name is on it, not ours.** Sunrise Functional Medicine, your logo, your colors. The patient has no idea we exist.
>
> **There's no medication name anywhere.** Two line items, both say 'Prescription Service.' That is not cosmetic — it means no Protected Health Information ever reaches Stripe, ever lands in a payment processor's logs, and never shows up on a card statement that a spouse or an employer might read. This is the single most common way healthcare software leaks PHI, and we designed it out.
>
> **One total, one payment.** Two prescriptions from one visit, two hundred eighty-six dollars, paid once — not two links and two charges and a confused patient calling your front desk.
>
> **Receipt email is required** before the form will submit, so the patient always gets documentation and your staff never fields 'did it go through?'
>
> **And it's Stripe.** Card, Apple Pay, Google Pay — whatever their phone supports. TLS encryption and Powered by Stripe right there at the bottom, which is the trust mark patients already recognize. We are not building a payment processor. We're not touching card data at all.
>
> That's the checkout. It works — we run it end to end in automated tests on every single merge. I'm just not going to spend your money to show you a green checkmark."

5. **If someone asks to see the payment actually complete:** the honest answer, and it lands well — *"Happy to. Not on live keys in a meeting. Give me a sandbox and a scheduled follow-up and I'll walk you through a completed transaction, the success page, the webhook, and the order flipping to Paid in the ops pipeline."* Then book it. This is a second meeting you've just earned, not an objection you've dodged.

### 4C — Success Page (NOT SHOWN LIVE — describe only)

> ## ℹ️ Do not navigate here. This screen is unreachable without completing a real payment.
>
> `/checkout/success` renders only after a successful charge. Because Part 4B never charges anything, **there is nothing to click through to.** Do not attempt to visit the URL and do not tell the audience you're about to show it. Describe it in one sentence and move on to Part 5.
>
> **What the patient sees after paying** (for narration only): an animated green checkmark, a "Payment Received" heading, the combined bundle amount in green, an order reference (first 8 characters of the order UUID, monospace), and a "What Happens Next" card with a 3-step progress indicator — Payment confirmed (check), Prescription sent to pharmacy (pending), Pharmacy will contact you, with a timing estimate that adapts to the pharmacy's integration tier ("Within 3–7 business days" for a Tier 4 fax pharmacy; "24–48 hours" for an API-connected Tier 1). **There is no medication name on the success page either** — zero PHI, same as the checkout page.
>
> **One-line version for the demo:** *"After they pay, they get a confirmation page with the amount, an order reference, and a realistic timeline that depends on which pharmacy tier the order routed to — API pharmacies quote 24 to 48 hours, fax pharmacies quote 3 to 7 days. No false promises, and still no medication name."*

### 4D — Expired Link Page (safe to show live)

6. Navigate to `https://functional-medicine-infrastructure.vercel.app/checkout/expired`
7. **Point out:**
    - Clock icon, friendly message
    - "Payment links expire after 72 hours for security"
    - Instructions to contact clinic
    - No order details revealed

> "If a patient waits too long, they see this. No PHI exposed. The clinic can reissue — the expired order stays as a permanent record. And this isn't hypothetical: there's a real expired order in the system right now, `DEMO-1012` over at Blue Cedar. That's a Tuesday-morning problem for their front desk, and it's completely invisible to Sunrise."

> **This page is a static route with no order attached, so it is safe to visit at any time.** It is the only Part 4 screen besides the checkout page itself that you can show live.

---

## Part 5: Ops Dashboard (7–10 minutes)

### 5A — Pipeline View

1. Open a new tab, navigate to `https://functional-medicine-infrastructure.vercel.app/login`
2. Log in as **Ops Admin**: `ops@compoundiq-poc.com` / `POCAdmin2026!`
3. **Point out the dark-mode dashboard:**
   - Pipeline stage groups in the left sidebar (Payment, Submission, Pharmacy, Shipping, Errors / Terminal)
   - Each stage has a count badge
   - Order table with columns: Order, Status, Clinic, Pharmacy / Tier, SLA, Assigned, Actions
   - **Verified count (prod, 2026-09-10): the pipeline reads "16 of 16 orders"** — the 12 seeded `DEMO-10xx` lifecycle orders plus 4 ops-scaffolding rows that exist to populate the pipeline stages. Plus whatever you created live in Part 3.

> "This is the operations nerve center. Every order across every clinic is visible here — as of v2.9 that genuinely means two clinics: Sunrise and Blue Cedar Integrative Health. The dark theme is intentional — ops teams monitor this all day, and dark mode reduces eye strain."

> **The 11-vs-16 question, answered before it's asked:** *"The clinic dashboard showed 11 orders. This one shows 16. That's not a bug — that's the tenancy boundary. Sunrise sees Sunrise's 11. Ops sees everything: both clinics' lifecycle orders plus the scaffolding rows. If those numbers ever matched, we'd have a problem."*

4. **Point out an order row:**
   - Status badge (colored)
   - SLA column — a countdown to the next deadline, or the resolved state
   - Tier icon (Tier 1 API / Tier 2 Portal / Tier 3 Hybrid / Tier 4 Fax — the demo seed has orders across all four tiers)
   - Claim button

> "Each order shows its SLA status. Ops can claim orders to prevent duplicate work."

> **Corrected in v2.12 — do not promise red overdue rows.** Earlier versions told the presenter to point at orders showing "in red with the exact hours overdue." **There are no overdue orders in the queue today.** Do not go looking for a red row; you will not find one and the hunt reads badly. Describe the capability in the conditional and let the empty case be the good news: *"When an order breaches its deadline, this column turns red and shows exactly how many hours late it is. Nothing's red today, which is what a healthy queue looks like."*

5. **Show the filter bar:**
   - Filter by Clinic, Pharmacy, Tier, Date range
   - Filters reset by selecting "All" in each dropdown

> "Multi-dimensional filtering lets ops isolate specific issues — show me all Tier 4 fax orders from this week, or all orders from a specific clinic. With two clinics and the DEMO-10xx lifecycle orders seeded, the clinic filter and the Errors stage both have real content to show."

6. **Click an order** to open the detail drawer
7. **Point out the tabs:** Detail, History, Submissions, SLA

> "Full drill-down into any order. The History tab shows every state transition with timestamps and who triggered it. The Submissions tab shows every adapter attempt. The SLA tab shows all deadline tracking."

> **Good order to click:** the one **Submission Failed** order (Noah Kim's Tadalafil). Filter to Errors, claim it, walk the History tab. *"This is what Tuesday morning looks like — not an empty demo database."* And `DEMO-1012` (Ruby Sandoval, Blue Cedar, **Payment Expired**) is the cross-tenant proof: visible here, invisible in the Sunrise clinic app.

### 5B — SLA Monitor

> **Rewritten in v2.12 — the old script did not match this page.** It told the presenter to point at "SLA breach cards with countdown timers," "escalation tier indicators," and an "Acknowledge button." **None of those are on screen, because nothing is breached.** Verified in prod 2026-09-10, the page reads **"0 SLA deadlines"** and **"All SLAs are on track or resolved."** Walking a prospect toward elements that aren't there is the fastest way to lose a room. The empty state is the story — tell that one.

8. Click **"SLA"** in the top nav
9. **Point out what is actually on the page:**
   - The filter pills across the top (All Active, Breached, and the rest) — the controls that scope the view
   - The current state: **"0 SLA deadlines — All SLAs are on track or resolved"**

> **Presenter line — lean into the empty state, do not apologize for it:**
>
> "This is the SLA monitor, and right now it is empty. I want to be straight with you about that rather than wishing a fire onto the screen: **zero SLA deadlines, everything on track or already resolved.**
>
> That is the outcome the whole system exists to produce.
>
> Here's what stands behind that empty page. Every order carries deadlines — time to submit to the pharmacy, time for the pharmacy to acknowledge, time to ship. A job runs every five minutes and checks all of them. When one is at risk, it appears on this page and escalation starts: a Slack alert, then a direct message to the ops lead, then a PagerDuty page. Acknowledging a breach stops the escalation — it tells the system a human has it.
>
> The reason there's nothing here is that nothing has gone late. In the operations tools most clinics have today, 'nothing is late' and 'nobody is watching' look identical — both are a silent inbox. Here they're different: this page is watching, and it's telling you the queue is clean.
>
> If you want to see it populated, that's a five-minute conversation in a sandbox where I can let a deadline lapse on purpose. I'm not going to break a production order to give you a red screen."

> **Narrator cue:** if a deadline *has* gone at-risk by the time you present, narrate what is genuinely on screen instead. Either state is a good beat — the failure mode is describing the state that isn't there.

### 5C — Adapter Health Monitor

10. Click **"Adapters"** in the top nav
11. **Point out what the page is:** a card for every configured pharmacy across all 4 integration tiers (Tier 1 API, Tier 2 Portal, Tier 3 Hybrid, Tier 4 Fax). Each card shows:
    - A traffic-light health indicator (green / yellow / red for Degraded or Critical / slate for Idle)
    - Circuit breaker state as a plain-English chip: **Online** (green) / **Degraded** (amber) / **Offline** (red bold). Chip is only shown when the pharmacy has circuit-breaker telemetry — a freshly-configured adapter with no traffic yet omits the chip entirely.
    - 24-hour submission success rate + total submission count + failure count
    - p50 / p95 / p99 latency percentiles
    - A 24-hour submissions bar chart (green bars for successes, pink for failures)
    - "Last success" relative timestamp
    - Quick-action buttons (Disable Adapter, Force Tier 4)

> "Every pharmacy integration is monitored in real time. The card's colour reflects what that pharmacy has actually been doing in the last 24 hours — 95%+ success with recent activity is green, degraded performance shifts to yellow, and a circuit-breaker-open state flips it red. A pharmacy we've configured but haven't routed traffic through yet shows **Idle** — neutral slate — instead of falsely flashing Critical. What you see on the grid right now reflects today's real submission activity."

> **Narrator cue:** whatever card is coloured however is fine. The page's value is that it reports reality — green pharmacies are healthy, yellow pharmacies are ones ops should look at, red pharmacies need intervention, and the circuit breaker auto-cascades traffic to the next-highest tier when something's down. Narrate the colours you see in front of you and explain what each state means.

### 5D — Fax Triage Queue

12. Click **"Fax Queue"** in the top nav
13. **Point out what the page is:**
    - Status filter pills across the top (All, Received, Matched, Unmatched, Processed, Archived)
    - Queue metrics in the header (`X new`, `Y unmatched`, total count)
    - A list of inbound fax rows — each one shows status, from-number, page count, relative received-at timestamp, matched pharmacy/order if any
    - Click any row to open a triage detail panel on the right with the available actions

> "Tier 4 pharmacies respond via fax. Inbound faxes land here with an OCR text preview. The system attempts to auto-match each inbound fax to an open order. When it succeeds, the fax moves to Matched. When it can't, the fax sits in Unmatched until a human decides what to do with it — the right-hand triage panel gives ops the tools to manually match the fax to an order or archive it. Tier 1 and 2 pharmacies skip this entire page because their responses come back via API, not fax."

> **Narrator cue:** whatever rows you see (including none) is what the queue genuinely contains today. The page's value is that it gives ops a single place to resolve fax-borne pharmacy responses — narrate whatever's in front of you.

### 5E — Catalog Manager

14. Click **"Catalog"** in the top nav
15. **Point out — two catalogs, clearly separated on one screen:**
    - At the top, a read-only **Product Catalog** block with live counts: **Ingredients**, **Salt Forms**, **Formulations**, and **Pharmacy Offerings**. These are the hierarchical catalog the prescription builder cascaded through in Part 3D — the same numbers the builder is working from.
    - Below it, **"Legacy Pharmacy Price List (CSV upload)"** with its own **"N price-list items"** count, the CSV drag-and-drop area, the Manual Entry form, and the tabs: Catalog, Versions, Normalized, API Sync.

> **Verified counts (prod, 2026-09-10) — read these aloud:** **77 Ingredients · 57 Salt Forms · 167 Formulations · 1,336 Pharmacy Offerings**, and **6** legacy price-list items in the CSV importer below. The counts are live, so if the screen disagrees, **read the screen** — but these are what it showed on 2026-09-10. (Earlier versions of this document said "166 formulations across 79 ingredients," which was wrong in both numbers and omitted salt forms and pharmacy offerings entirely.)

> "Two things live on this screen and they do different jobs. The top block is the product catalog — 77 ingredients, 57 salt forms, 167 finished formulations, and 1,336 pharmacy offerings, which is every combination of *this pharmacy sells this formulation at this price*. That's the tree the prescription builder walked down when I picked Semaglutide a few minutes ago, and that 1,336 is the number that actually matters commercially: it's the size of the sourcing market this platform can price against in real time.
>
> The bottom half is the pharmacy price-list importer: a pharmacy sends us a flat CSV of what they stock and what it costs, we version it, and we flag any price that moves more than 10%. Every change is versioned, and the normalized view lets you compare the same medication across pharmacies."

> **Narrator cue:** if a prospect asks why the price-list item count is only 6, the honest answer is the right one: *"That's the raw CSV import table, not the product catalog — it only has the rows a pharmacy has actually sent us a price sheet for. The product catalog is the block above it, and it has 167 formulations across 1,336 pharmacy offerings."*

---

## Part 6: Architecture Highlights (3–5 minutes, no demo)

### The 4-Tier Pharmacy Adapter

> "The key innovation is the Pharmacy Adapter Layer. Instead of forcing every pharmacy onto one integration method, we meet them where they are:"

| Tier | Method | Speed | Coverage |
|------|--------|-------|----------|
| Tier 1 | Direct REST API | Instant | ~25% of pharmacies |
| Tier 2 | Portal Automation (Playwright) | ~5 min | ~20% |
| Tier 3 | Standardized API Spec | Instant | Future 30%+ |
| Tier 4 | Fax Fallback | ~30 min | Universal |

> "The routing is deterministic — always use the highest available tier. If it fails, cascade down. Fax is always the fallback. A single LifeFile API integration unlocks Empower, Belmar, UCP, and Strive — the largest pharmacy network in the country."

### Security & Compliance

> "HIPAA compliance is enforced at the infrastructure level, not just application code:"
- Row-Level Security on all 47 tables
- **Role enforcement in middleware, not in the UI** — a medical assistant cannot reach `/new-prescription/sign/*` even by typing the URL, and a clinic user of any role cannot reach `/ops/*` (both demonstrated live in Part 3G)
- Per-state pharmacy licensure enforced at the point of prescribing — an unlicensed pharmacy cannot be selected, quick-loaded, or protocol-loaded for that patient (see Part 3C-1)
- **Protocol provenance** — orders created from a protocol are linked to the protocol instance and the exact published template version (GAP-3), so reuse, clarification rate, and retention are measurable rather than estimated (see Part 3C)
- Zero PHI in Stripe (metadata contains order_id only)
- Supabase Vault for all pharmacy credentials
- 30-minute session timeout with warning modal
- Supabase Realtime DISABLED (hard HIPAA requirement)
- All data at rest encrypted AES-256
- Phase C multi-Rx payment groups (live) bundle sibling prescriptions into one patient payment link; PHI redaction (Option B) on logs and non-clinical surfaces; role features F-3 (provider clinic-view toggle) and F-5 (primary provider)

### Technology Stack

> "Built on Next.js 16, Supabase (PostgreSQL 15+), Stripe Connect Express, Twilio, and Documo mFax. Deployed on Vercel serverless. **9 scheduled cron jobs** handle SLA enforcement and re-firing, payment expiry, submission reconciliation, adapter/portal polling, fax retry, screenshot cleanup, PHI debug purge, and the daily ops digest. Everything is atomic — Compare-And-Swap patterns on every state transition prevent race conditions."

> **Verified 2026-09-11:** `vercel.json` declares exactly **9** entries under `crons` (`sla-check`, `sla-refire`, `payment-expiry`, `submission-reconciliation`, `daily-digest`, `fax-retry`, `portal-status-poll`, `screenshot-cleanup`, `purge-phi-debug`). The tenth, `poc-credential-sync`, was removed on 2026-09-11 (v2.15): every fire re-set the four demo passwords through the Supabase admin API, which revoked every active demo session, so it was the cause of the recurring mid-demo silent logout. Demo credentials are now reset only by the manual **Reset Demo Credentials** button on `/ops/demo-tools`, and that button signs every demo user out, including the presenter. If anyone claims a different number, this is the source of truth.

---

## Part 7: Q&A / Wrap-Up

### Key Metrics to Mention

| Metric | Value |
|--------|-------|
| Order states | 23-state machine with 47 valid transitions |
| SLA types | 10 enforcement types with 3-tier escalation |
| Database tables | 47 (PostgreSQL with full RLS) + 6 views |
| Cron jobs | **9** Vercel cron jobs (verified against `vercel.json`) |
| Product catalog | **77 ingredients · 57 salt forms · 167 formulations · 1,336 pharmacy offerings** |
| Build phases completed | 19 phases, 87 work orders (all merged; WO-87 formulation support in prod) |
| Phase C & roles | Multi-Rx payment groups (live), PHI redaction (Option B), provider clinic-view toggle (F-3), primary provider (F-5) |
| Hard constraints | 16 non-negotiable rules |
| Test coverage | 65 Playwright E2E tests (all browsers) + 87 jest unit tests. CI gates every merge. |

### Common Questions

**Q: How do you handle controlled substances?**
> "DEA-scheduled compounds are explicitly excluded from the adapter layer. They're flagged at search time and forced to Tier 4 (manual fax) only. And signing one requires TOTP two-factor from the prescriber, per DEA 21 CFR 1311 — you saw that in Part 3H."

**Q: Can a medical assistant sign a prescription?**
> "No, and not in the 'we hid the button' sense. The MA can prepare the entire visit — patient, pharmacy licensure check, structured sigs, pricing, interaction review — and the review screen offers her exactly one action: save as a draft for the provider. If she types the signing URL directly, middleware bounces her to Access Denied before any prescription data loads. That's why the draft queue exists. We showed it live in Part 3G."

**Q: If the assistant prepares three prescriptions, does the doctor sign once or three times?**
> "Three times. A session of N prescriptions saves as N separate draft orders, and each one is signed on its own — with its own EPCS two-factor step if it's a controlled substance. Today each prescription is signed individually — one signature per prescription — and there is no 'sign all' action in the product. A signature is a legal attestation about one prescription for one patient, so batch signing isn't something we'd add without walking it through with your compliance team first."
>
> *Presenter note: if they press on whether batch signing is coming, treat it as roadmap and feedback — "it isn't built today, and I'll take that back as a request." Do not claim we ruled it out on purpose; that has never been confirmed as a product decision.*

**Q: What about patient data privacy?**
> "Zero PHI touches Stripe. The checkout page shows 'Prescription Service' — never the medication name. SMS messages contain only the patient's first name and a URL. Row-Level Security ensures clinics can never see each other's data — the clinic dashboard shows 11 orders while the ops dashboard shows 16, and that gap *is* the tenancy boundary."

**Q: How do you stop a clinic from sending a prescription to a pharmacy that isn't licensed in the patient's state?**
> "We don't warn them — we remove the option. Every pharmacy carries a state license table, and every prescribing surface checks it against the selected patient's shipping state: the pharmacy dropdown filters, favorites pinned to an unlicensed pharmacy gray out with the reason and the pharmacy name, and a protocol quick-load skips the unlicensed lines and tells the provider exactly which ones and why. There is no override checkbox. See it live in Part 3C-1."

**Q: What's the revenue model?**
> "Per-transaction platform fee. The spread between wholesale and retail is split: clinic keeps their margin, platform captures 15% of the spread. Stripe processing fees come out of the platform's portion. The split happens at the moment of the charge through Stripe Connect Express — we never hold the clinic's money."

**Q: Can we set our own markup?**
> "Yes, and it's a field you control, not a support ticket. `/settings` → Clinic Profile → Default Markup %. It pre-fills the retail price on every prescription your clinicians write, and any of them can still override it per-prescription. Shown in Part 3K."

**Q: Why didn't you complete the payment in the demo?**
> "Because that's our production environment on live Stripe keys — clicking Pay would put a real charge through a real payout account. The checkout page proves the branding, the PHI redaction, the bundling, and the trust marks without spending anyone's money. Happy to walk a completed transaction end to end in a sandbox on a follow-up."

**Q: How long to integrate a new pharmacy?**
> "Tier 4 (fax) works immediately — just add the fax number. Tier 1 (API) requires their REST endpoint and credentials. Tier 2 (portal) requires Playwright selectors for their web portal. Tier 3 is our published spec that pharmacies can adopt."

---

## Post-Demo Checklist

- [ ] Answer all questions
- [ ] Share POC URL if appropriate
- [ ] Note any feedback or feature requests
- [ ] Schedule follow-up if interest
- [ ] If you promised a sandbox walkthrough of the completed payment (Part 4B), book it before you leave the call
