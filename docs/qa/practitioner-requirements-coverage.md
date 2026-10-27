# Practitioner requirements coverage

An audit of what main implements against the practising NP's feedback, done before the cofounder review. The code on `main` at 2696ff2 (2026-10-25) is the only evidence used; older docs, WO status notes and commit messages were not trusted. Paths are relative to `src/`. `np/` means `app/(clinic-app)/new-prescription/`.

## Sources

- **Primary:** `docs/practitioner-feedback/2026-09-11-gina-rooks-email.md` (Gina Rooks NP) and `docs/practitioner-feedback/2026-09-11-product-run-thru-transcript.md`.
- **Oct 5 run-through:** `docs/meetings/2026-10-05-run-through.md`, notes rebuilt from what Sam relayed (no transcript). Audited in the section "Oct 5 run-through" below: asks 2, 3, 4, 5, 6, 7 and 9, and decisions 1, 3 and 6. Ask 1 and ask 10 were answered in the meeting; ask 8 and decisions 2, 4, 5 and 7 are process or policy, not code.
- **Unmerged branches:** an item done only on an origin branch is PARTIAL (not on main), with the branch named. These branches were checked with `git diff --stat origin/main...origin/<branch>`. Already squash-merged, nothing extra: ehr-sync-keragon, intake-self-service, intake-face-sheet, invite-accept-rate-limit, compliance-consent-intake-foundations, compliance-wcag-checkout-intake. With real unmerged work: signup-squatting, security-followups-2, rate-limit-db, rls-user-write-lockdown-v2, ops-fax-viewer-documo, and (after this audit) rx-quantity-shipping and favorites-frequent.

## Verdict rule

| Verdict | Meaning |
|---|---|
| **DONE** | Built and reachable in the UI. Where the requirement is about the Rx, the value also reaches the pharmacy output: the fax PDF (`lib/adapters/prescription-pdf.ts`) and the API payloads (`lib/adapters/transformers.ts`). |
| **PARTIAL** | Built, but leaves the provider doing arithmetic or a manual step, or leaves the Rx short of what she asked. The gap is stated. |
| **MISSING** | Not built. |

## Where the Rx details live

Most Rx-field requirements are edited in one place: Review (`/new-prescription/review`), where each card has a collapsible **"Rx details"** section (`np/review/_components/rx-details-row.tsx`). Defaults, validation and the column mapping are in `lib/orders/rx-details.ts`.

## Cross-cutting defect: "Quantity: 1"

`POST /api/orders` always stores `quantity: 1` (`app/api/orders/route.ts:364`). This value goes out in several places:
- The fax PDF prints `Quantity: 1` (`prescription-pdf.ts:189`), directly above the real dispense line, for example `Dispense: 9.6 mL (2 x 5 mL vials)`.
- LifeFile `drug.quantity`, Vios `medication.quantity`, MediVera `RxInfo.Qty` and the Tier 2 `{quantity}` placeholder all send 1.

When more than one vial is dispensed, the Rx contradicts itself. This is the gap in items 3 and 4.

---

## 1. mg next to injectable doses in favorites, e.g. "10 units (0.5 mg)"
- **Code:** `lib/orders/dose-display.ts` (`formatDoseWithMg`, `formatFavoriteDose`); `lib/orders/favorite-presets.ts` (`presetChipText`); the dose chips in `np/_components/quick-actions-panel.tsx`.
- **UI:** `/new-prescription/search` > "Favorites (N)". The card chips read "10 units (0.5 mg) weekly", followed by "Custom".
- **On the Rx:** yes, inside the sig (`Sig: ... 10 units (0.10mL / 0.50mg) ...`).
- **Tests:** `lib/orders/__tests__/dose-display.test.ts`, `wo104-favorite-presets.test.ts`, `np/_components/__tests__/wo103-favorites-panel.test.tsx`, `wo104-favorites-panel.test.tsx`; E2E `e2e/clinic-app.spec.ts` (WO-103 "10 units (0.5 mg) weekly", WO-104).
- **Verdict: DONE.**
  - mg appears only when the formulation has an mg/mL concentration.
  - A hand-edited sig can drop it.

## 2. Duration (days supply) on the Rx
- **Code:** `np/_components/structured-sig-builder.tsx` ("Duration" select: "For 7 / 14 / 30 / 60 / 90 days", "Ongoing", "Custom..."); `rx-details.ts` (`computeDispense`, `durationDaysFromSig`); `np/_components/derived-dispense.tsx`.
- **UI:**
  - Search dose step: "Duration".
  - Price step: read-only "Days supply" with an "Override" button.
  - Review "Rx details": "Days supply: N days".
- **On the Rx:** yes. The PDF prints `Days supply: N days`; payloads send `days_supply` / `daysSupply` / `DaysSupply`.
- **Tests:** `lib/orders/__tests__/wo96-fix-derived.test.ts`, `rx-details.test.ts`, `np/margin/_components/__tests__/margin-builder-derived.test.tsx`, `lib/adapters/__tests__/wo96-rx-details-payloads.test.ts`; E2E `clinic-app.spec.ts` (WO-96 blocks).
- **Verdict: DONE.**
  - With "(no duration)", days supply is derived from what the package covers (the E2E asserts 350 days for 10 units weekly from a 5 mL vial).
  - An as-needed (PRN) dose prints "-".

## 3. Quantity / count to dispense
- **Code:** `rx-details.ts` (`computeDispense`, `dispenseInPackageUnit`, `formatDispenseWithPackage`); `derived-dispense.tsx`.
- **UI:**
  - Price step: "Dispense" with "Override".
  - Review "Rx details": "Dispense: 9.6 mL (2 × 5 mL vials)".
  - Search "Quantity" select, shown only when the pharmacy has no priced packages.
- **On the Rx:** the PDF prints the right `Dispense:` line.
- **Tests:** `wo96-fix-derived.test.ts`, `count-units-pellet-supp.test.ts`, `np/margin/_components/__tests__/count-units-pricing.test.tsx`, `np/review/_components/__tests__/wo101a-review-dispense.test.tsx`, `wo96-rx-details-payloads.test.ts`; E2E `clinic-app.spec.ts` (dispense_quantity on the order row).
- **Verdict: PARTIAL.**
  - The PDF still prints a separate `Quantity: 1`, and every adapter's quantity field sends 1 (see the cross-cutting defect above).
  - No test asserts the PDF or payload quantity against the dispense count.

## 4. Vial size: priced by size, auto-selected, multiples of one size
- **Code:**
  - `rx-details.ts` (`suggestPackage`, `suggestPackageForDispense`, `packageCountFor`, `MAX_PACKAGE_COUNT = 20`).
  - The `pharmacy_formulation_packages` table (migration `20260914000001_wo101_pharmacy_formulation_packages.sql`).
  - Pharmacy cards in `np/_components/cascading-prescription-builder.tsx`; package controls in `np/margin/_components/margin-builder-form.tsx`.
- **UI:**
  - Search "Pharmacy & Pricing" cards show the suggested size ("2 × 5 mL vials") and each size's price.
  - Price step: "Package: 2 × 5 mL vials (suggested for 90 days) · $570.00", a "Number of packages" input, and a "Package" select ("label: $price (suggested)").
- **On the Rx:** yes. The PDF prints `Dispense: ... (2 x 5 mL vials)`; payloads send `package_label` / `package_count` (and their camel/Pascal forms).
- **Tests:** `lib/orders/__tests__/wo101-suggest-package.test.ts`, `wo101a-package-count.test.ts`, `np/_components/__tests__/wo101b-pharmacy-sizes.test.tsx`, `np/margin/_components/__tests__/wo101-margin-package.test.tsx`, `np/review/_components/__tests__/package-at-review.test.tsx`, `lib/adapters/__tests__/wo101a-package-payloads.test.ts`; E2E `clinic-app.spec.ts` (WO-101 blocks incl. 2 × 5 mL).
- **Verdict: DONE.**
  - Auto-sizing needs a duration and priced package rows; without them the pharmacy default is used.
  - The `Quantity: 1` line affects this Rx too (item 3).

## 5. Refills authorized
- **Code:** "Refills" select in `cascading-prescription-builder.tsx` (0 to 5); `rx-details-row.tsx` (0 to `MAX_REFILLS` = 12).
- **UI:** search "Refills" ("0 refills", "1 refill", ...); Review "Rx details" > "Refills".
- **On the Rx:** yes. The PDF prints `Refills: N` with "Substitution permitted" or "Dispense as written (DAW)"; all payloads carry it.
- **Tests:** `np/review/_components/__tests__/rx-details-row.test.tsx`, `rx-details.test.ts`, `app/api/orders/__tests__/wo96-rx-details.test.ts`, `wo96-rx-details-payloads.test.ts`; E2E `clinic-app.spec.ts`.
- **Verdict: DONE.** The search step caps refills at 5, while Review allows 12.

## 6. Clinical difference statements for GLP-1s (auto-expands, pre-selected)
- **Code:** `rx-details.ts` (`formulationRxDefaults`, `STANDARD_CLINICAL_DIFFERENCE_OPTIONS`, `rxDetailsNeedConfirmation`, `missingRxDetails`); `lib/compliance/compounding.ts` (C8); `rx-details-row.tsx`.
- **UI:** Review "Rx details" opens on its own when a statement is required. "Clinical difference (required)" starts at "Select a reason…" and offers 5 standard reasons plus "Other (describe)" (20 characters minimum). Sending is blocked until a reason is set.
- **On the Rx:** yes. The PDF prints `Clinical difference: ...`; payloads send `clinical_difference` and its other casings.
- **Tests:** `rx-details-row.test.tsx`, `rx-details.test.ts`, `np/review/_components/__tests__/compounding-at-review.test.tsx`, `lib/compliance/__tests__/compounding.test.ts`, `wo96-rx-details-payloads.test.ts`; E2E `clinic-app.spec.ts`.
- **Verdict: PARTIAL.**
  - Auto-expand works, but **nothing is pre-selected**: `defaultRxDetails` sets `clinicalDifference: null` on purpose.
  - The patient-specific statements Gina cited from Strive (for example "Glycine added to help maintain muscle mass") are not in the list. They must be typed into "Other" every time, and cannot be saved per formulation or per favorite.

## 7. Syringes on the Rx, or none
- **Code:** `SYRINGE_OPTIONS` in `rx-details.ts`. The default is "SubQ syringe kit" for injectables, "IM syringe kit" for intramuscular, and "None" otherwise. UI in `rx-details-row.tsx`.
- **UI:** Review "Rx details" > "Syringe option": SubQ syringe kit / IM syringe kit / Insulin syringes / None.
- **On the Rx:** yes. The PDF prints `Syringe option: ...`; payloads send `syringe_option` and its other casings.
- **Tests:** `rx-details-row.test.tsx`, `rx-details.test.ts`, `wo96-rx-details-payloads.test.ts`; E2E `clinic-app.spec.ts`.
- **Verdict: DONE.**
  - Covers "include Rx for syringes if needed or indicate no syringes".
  - There is no syringe count or size; she did not ask for one.

## 8. Shipping type: temperature sensitive or not
- **Code:** `SHIPPING_TYPES` in `rx-details.ts`. Cold chain is the default for GLP-1 ingredients (semaglutide, tirzepatide, liraglutide, retatrutide), seeded by migration `20260912000001_wo96_rx_detail_fields.sql`. UI in `rx-details-row.tsx`.
- **UI:** Review "Rx details" > "Shipping": Standard / Cold chain (refrigerated). The price step shows "Shipping (cold chain): $X".
- **On the Rx:** yes. The PDF prints `Shipping: Cold chain (refrigerated)`; payloads send `shipping_type` and its other casings.
- **Tests:** `rx-details-row.test.tsx`, `lib/orders/__tests__/wo102-shipping.test.ts`, `np/review/_components/__tests__/wo102-review-shipping.test.tsx`, `wo96-rx-details-payloads.test.ts`; E2E `clinic-app.spec.ts`.
- **Verdict: DONE.** Other refrigerated products default to Standard and must be changed by hand.

## 9. Allergies / NKDA on the Rx
- **Code:** `lib/patients/allergies.ts` (`allergiesForPayload`: "NKDA", the list, or "Not recorded"); `np/_components/allergy-chip.tsx`; `np/review/_components/allergy-notice.tsx` (also on the sign page).
- **UI:**
  - The allergy chip on patient selection and in the session banner offers "Drug allergies", "No known drug allergies (NKDA)" and "Save allergies".
  - Review shows an amber notice, "The pharmacy will receive 'Allergies: not recorded'", with a "Confirm NKDA" button.
- **On the Rx:** yes. The PDF always prints `Allergies: ...`; Vios, LifeFile, MediVera and the Tier 2 `{patientAllergies}` placeholder carry it.
- **Tests:** `lib/patients/__tests__/allergies.test.ts`, `np/_components/__tests__/allergy-chip.test.tsx`, `np/review/_components/__tests__/allergy-notice.test.tsx`, `lib/adapters/__tests__/wo97-allergies-payloads.test.ts`; E2E `clinic-app.spec.ts` (allergy blocks).
- **Verdict: PARTIAL.** She wrote "Allergies or no known drug allergies is needed on the Rx", but sending is not blocked. No server check exists in `app/api/orders`, and an E2E confirms the draft goes through, so an Rx can reach the pharmacy reading "Allergies: Not recorded".

## 10. Diagnosis
- **Code:** `rx-details-row.tsx`. `missingRxDetails` requires a diagnosis only for DEA schedule II and above, which rule C6 already blocks.
- **UI:** Review "Rx details" > "Diagnosis code" (placeholder "ICD-10") and "Diagnosis" (placeholder "Description").
- **On the Rx:** yes. The PDF prints `Diagnosis: <code> - <text>`; payloads send `diagnosis_code` / `diagnosis_text` and their other casings.
- **Tests:** `rx-details-row.test.tsx`, `rx-details.test.ts`, `app/api/orders/__tests__/wo96-rx-details.test.ts`, `wo96-rx-details-payloads.test.ts`; the E2E checks only the empty default.
- **Verdict: DONE.** Free text, with no ICD-10 lookup and no per-formulation "required" setting.

## 11. Special instructions (e.g. remove a filler or dye)
- **Code:** `rx-details-row.tsx`. A textarea of up to 1000 characters, stored in `orders.special_instructions`.
- **UI:** Review "Rx details" > "Special instructions (optional)" (placeholder "Notes to the pharmacy").
- **On the Rx:** yes. The PDF prints `Special instructions: ...`; payloads send `special_instructions` and its other casings.
- **Tests:** `rx-details-row.test.tsx`, `wo96-rx-details.test.ts`, `wo96-rx-details-payloads.test.ts`. No E2E types into the field; the E2E checks only the empty default.
- **Verdict: DONE.**

## 12. Edit an Rx at Review and send; Back works; a pending Rx queue
- **Code:** `np/review/_components/batch-review-form.tsx` (per-card "Edit", "Back", "+ Add Another Prescription"); `np/_lib/edit-target.ts`; `np/margin/_components/margin-builder-form.tsx` (`handleReviewAll` updates the same line); the session queue in `np/_context/prescription-session.tsx` and `np/_components/session-banner.tsx`.
- **UI:**
  - Review > "Edit" opens "Edit Prescription", then "Save Changes and Back to Review".
  - "Back" keeps the session.
  - The session banner shows "N prescriptions in this session" and "Review & Send".
  - Saved work is on the dashboard Drafts tab.
- **Tests:** `np/review/_components/__tests__/wo98-edit-at-review.test.tsx`, `np/_lib/__tests__/edit-target.test.ts`, `np/review/_components/__tests__/shipping-after-edit.test.tsx`; E2E `clinic-app.spec.ts` ("changing a dose at Review updates the card in place ... Back keeps both Rx in session").
- **Verdict: DONE.** The session queue lives in one browser tab. A provider cannot save the whole session as drafts from Review unless the patient's intake is pending.

## 13. Edit a saved draft and add other Rx to that order
- **Code:**
  - `app/(clinic-app)/dashboard/_components/order-drawer.tsx` ("Edit prescription" goes to `?editOrder=`, "+ Add prescription" goes to `?addToOrder=`).
  - `np/sign/_components/batch-sign-form.tsx` (per-line "Edit", "+ Add prescription").
  - `margin-builder-form.tsx` (PATCH `/api/orders/[id]`, POST `/api/orders` with `appendedToOrderId`).
- **UI:** Dashboard > Drafts > a row > the drawer's "Edit prescription" or "+ Add prescription". The price page then shows "Save Changes to Draft" or "Add to Draft".
- **Tests:** `app/api/orders/[orderId]/__tests__/wo98-draft-edit.test.ts`, `lib/orders/__tests__/draft-edit.test.ts`, `app/(clinic-app)/dashboard/__tests__/order-drawer-draft-access.test.tsx`, `lib/orders/__tests__/wo99-followup.test.ts`; E2E `clinic-app.spec.ts` ("provider opens a draft, edits the dose, adds a second line ...", "server enforces who may edit a draft").
- **Verdict: DONE.** An added Rx is its own DRAFT linked by `appended_to_order_id`; signing puts the linked drafts on one payment link.

## 14. Sign all at once
- **Code:** `dashboard/_components/orders-dashboard.tsx` ("Sign all (N)", "Sign selected (N)"); `np/sign/_components/batch-sign-form.tsx` (one pad, "Sign & Send N Prescriptions"); `lib/orders/batch-sign.ts` (`signBatch`, all or nothing); Review's "Sign & Send All N Prescriptions".
- **UI:** Dashboard > Drafts > "Sign all (N)", or Review > "Sign & Send All N Prescriptions".
- **Tests:** `dashboard/__tests__/wo99-sign-all.test.tsx`, `np/sign/__tests__/batch-sign-form.test.tsx`, `lib/orders/__tests__/batch-sign.test.ts`, `app/api/orders/batch-sign/__tests__/routes.test.ts`; E2E `clinic-app.spec.ts` (WO-99 "two drafts → Sign all → one pad, one click").
- **Verdict: DONE.**
  - At most 25 orders per batch.
  - Only the signer's own drafts count; another provider's drafts go through "Sign as me" first.

## 15. Shipping shown with med pricing and at Review, plus a double-shipping warning across pharmacies
- **Code:**
  - Price step `shippingLine` in `margin-builder-form.tsx`: "Shipping (cold chain|standard): $X, charged once for {pharmacy}".
  - Review: `np/review/_components/bundle-shipping.tsx` (`ShippingLines`, `MultiPharmacyNoticeBanner`), with the notice text from `lib/orders/reroute.ts` (`multiPharmacyNotice`) and a "Route all to {pharmacy}" button.
  - Sign page: per-pharmacy shipping lines.
- **UI:** `/new-prescription/margin`, `/new-prescription/review` (totals plus an amber notice), `/new-prescription/sign`.
- **Tests:** `np/margin/_components/__tests__/wo102-margin-shipping.test.tsx`, `np/review/_components/__tests__/wo102-review-shipping.test.tsx`, `lib/orders/__tests__/wo102-shipping.test.ts`, `wo102-reroute.test.ts`, `app/api/orders/shipping/__tests__/route.test.ts`; E2E `clinic-app.spec.ts` ("WO-102: shipping once per pharmacy per order").
- **Verdict: PARTIAL.**
  - The pharmacy cards on the search step, where she compares pharmacies, show medication price only, with no shipping. She still adds shipping in her head.
  - The multi-pharmacy warning appears only at Review (`MultiPharmacyNoticeBanner` is used only in `batch-review-form.tsx`). Saved drafts that span pharmacies get no warning and no re-route on the sign page.

## 16. Favorites open the Rx builder dose step with the dropdowns populated
- **Code:** `quick-actions-panel.tsx` (dose chips and "Custom", which call `handleFavoriteClick`); `cascading-prescription-builder.tsx` (`handleLoadFavorite`, then `loadOntoDoseStep`, which sets ingredient, salt form, formulation, pharmacy, dose, unit, frequency, timing and duration). It never routes to the margin page.
- **UI:** `/new-prescription/search` > "Favorites (N)" > a dose chip or "Custom", which lands on the dose step with the dropdowns live.
- **Tests:** `np/_components/__tests__/wo104-favorite-dose-step.test.tsx`, `wo104-favorites-panel.test.tsx`; E2E `clinic-app.spec.ts` ("'20 units' opens the dose step, then prices", "Custom opens the dose step with the formulation pre-selected and the dropdowns live").
- **Verdict: DONE.**

## 17. Favorites: common doses grouped under the drug
- **Code:** migration `20260917000001_wo104_favorite_presets.sql` (`dose_presets` jsonb; merges the older one-per-dose rows); `app/api/favorites/route.ts` POST (`mergePresets`, keyed on formulation + pharmacy + patient).
- **UI:** "Favorites (N)" shows one card per drug with chips ("10 units (0.5 mg) weekly", ...) plus "Custom"; "☆ Save as favorite" adds a dose to the card.
- **Tests:** `lib/orders/__tests__/wo104-favorite-presets.test.ts`, `app/api/favorites/__tests__/wo104-favorites-model.test.ts`, `wo104-favorites-panel.test.tsx`; E2E ("legacy Semaglutide favorites collapse to one card with 10 / 20 / 40 units").
- **Verdict: DONE.** The same drug at two pharmacies or two concentrations makes two cards.

## 18. Favorites sorted alphabetically and/or by category
- **Code:** `lib/orders/favorite-presets.ts` (`groupFavorites`, `compareCategories`, `FAVORITE_CATEGORY_ORDER`; A to Z within each group).
- **UI:** the "Favorites (N)" panel shows category groups; a "Mine" filter is available.
- **Tests:** `wo104-favorite-presets.test.ts`, `wo104-favorites-panel.test.tsx`; E2E ("categories in a fixed order, A–Z within a group").
- **Verdict: DONE.** It sorts both ways at once; the user cannot choose one.

## 19. Favorites: a frequently used section, convertible to a favorite
- **Code:** the "Recent" strip in `quick-actions-panel.tsx` with a "Make favorite" button ("Make {name} a favorite"); `app/api/favorites/recent/route.ts`; `recentFormulations` and `RECENT_LIMIT = 8` in `lib/orders/favorite-presets.ts`.
- **UI:** "Favorites (N)" > "Recent" row > "Make favorite", which then shows "★ Favorite".
- **Tests:** `wo104-favorites-panel.test.tsx`, `wo104-favorites-model.test.ts`; E2E ("Recent shows the last prescribed formulations; Make favorite creates a card").
- **Verdict: PARTIAL.**
  - The strip shows the last 8 distinct formulations, newest first. It is recency, not frequency; nothing counts how often a formulation is prescribed.
  - "Make favorite" always saves for the practice and only the last dose.

## 20. Favorites scoped to a specific patient as well as the practice
- **Code:** `provider_favorites.patient_id` (migration `20260917000001`); `app/api/favorites/route.ts` (GET `?patient_id=` returns the practice's favorites plus that patient's); `np/_components/save-favorite-button.tsx` ("For the practice" / "Only for {name}"); `groupFavorites` puts "For {patient}" first.
- **UI:** "☆ Save as favorite" > "Only for {name}"; the pencil icon edits a favorite.
- **Tests:** `wo104-favorites-model.test.ts`, `app/api/favorites/__tests__/route.test.ts`, `np/review/_components/__tests__/wo103-save-favorite.test.tsx`; E2E ("a favorite saved for this patient surfaces first").
- **Verdict: DONE.**

## 21. Patient protocol choice (#268)
- **Code:**
  - Propose: `batch-review-form.tsx` ("Let the patient choose", "Send the patient a plan to choose from, instead of signing now", "Send to patient for choice"; for an MA, "Save the plan for the provider to send"), `np/review/_components/proposal-options.tsx`, `app/api/proposals/route.ts`, `lib/proposals/propose.ts`.
  - Choose: `app/plan/[token]/page.tsx`, `_components/plan-flow.tsx` ("Date of birth", "Choose your plan", "Choose this plan"), `app/api/plan/[token]/route.ts` (`verifyPlanDob` on every action, tries-left lock).
  - Sign: `dashboard/_components/chosen-plans-queue.tsx` ("Plans ready to sign", "Review and sign"), `np/sign/page.tsx` (`?proposal=`, chosen lines only), `lib/proposals/sign-choice.ts` (`signChosenProposal` signs the chosen lines and cancels the rest).
- **UI:** Review > tick the plan box > "Send to patient for choice" > Copy link / Show QR code; the patient opens `/plan/<token>` and enters their DOB; the dashboard shows the "Proposed" tab and "Plans ready to sign".
- **Tests:** `lib/proposals/__tests__/*` (propose, plan, sign-choice, queue, status, token, expire, sms), `app/api/proposals/__tests__/routes.test.ts`, `sign-route.test.ts`, `app/api/plan/[token]/__tests__/route.test.ts`, `app/plan/[token]/__tests__/plan-flow.test.tsx`, `np/review/_components/__tests__/send-for-choice.test.tsx`, `np/sign/__tests__/batch-sign-proposal.test.tsx`, `dashboard/__tests__/chosen-plans-queue.test.tsx`; E2E `e2e/patient-protocol-choice.spec.ts` (two options, one wrong DOB, untick an optional item, choose, provider signs).
- **Verdict: DONE.**

---

## Oct 5 run-through (Lauren Perkins, cofounder, and Anila)

Source: `docs/meetings/2026-10-05-run-through.md`. Same rule as above: code on main only.

### Ask 2. Is the admin dashboard set up? Follow-up: full admin click-through
- **Code:**
  - `app/(clinic-app)/practice/page.tsx` and `_components/practice-dashboard.tsx` ("Practice Dashboard": period buttons, "Needs attention", breakdown tabs).
  - `app/(clinic-app)/settings/page.tsx` ("Clinic Settings"): sections Payouts / Stripe Connect, Clinic Profile, Sign-in Security, Team, Patients, Access log, Integrations, Notifications and Agreements.
  - Subpages `/settings/team`, `/settings/patients/import`, `/settings/patients/signup-link`, `/settings/access-log`, `/settings/integrations`, `/settings/agreements`.
- **UI:** sidebar "Practice" and "Settings". Settings links: "Manage the team", "Import patients", "Patient sign-up link", "Open the access log", "Open EHR sync". Admin-only toggle "Show the practice dashboard to providers".
- **Tests:** `app/(clinic-app)/practice/__tests__/practice-dashboard.test.tsx`, `practice-custom-period.test.tsx`, and the `settings/__tests__/` files (nav order and active state, team link, read-only for non-admins, settings form). E2E covers it in pieces: `clinic-app.spec.ts` (/practice and /settings), `rbac.spec.ts`, `team-invites.spec.ts`, `patient-import.spec.ts`, `patient-signup-link.spec.ts`, `mfa.spec.ts`.
- **Verdict: PARTIAL.**
  - The admin pages are all there.
  - There is no single admin click-through on main, neither an E2E walk nor a checklist. The prod click-through checklist (`docs/qa/prod-clickthrough-checklist.md`, clinic admin section) is only on the unmerged branch **docs-prod-clickthrough**.
  - Notifications is a placeholder: "Email and SMS notification preferences are not yet configurable." and "Coming soon: configurable preferences".

### Ask 3 and decision 3. The clinic admin lands on the Practice dashboard
- **Code:** `lib/auth/landing-route.ts` (`defaultLandingRoute`: clinic_admin → `/practice`, provider and MA → `/dashboard`; `postLoginDestination` lets a safe `redirectTo` win). Called from `app/login/page.tsx`, `app/mfa/challenge/page.tsx`, `app/mfa/enroll/page.tsx` and `app/page.tsx` (the "/" redirect).
- **UI:** sign in as a clinic admin → "Practice Dashboard".
- **Tests:** `lib/auth/__tests__/landing-route.test.ts`; E2E `auth.spec.ts` (lands on `/practice`), `rbac.spec.ts`, `clinic-app.spec.ts`.
- **Verdict: DONE.**

### Ask 4. How do we add patients? Follow-up: patient intake portal, zero typing for staff
- **Code:**
  - "+ New patient" in `np/_components/patient-provider-selector.tsx` and `new-patient-form.tsx`. POST `/api/patients` sets intake_status 'pending', creates the intake link and texts it (`IntakeLinkPanel` shows "Copy link").
  - Patient side: `/intake/[token]` ("Complete your details", `app/intake/[token]/_components/intake-flow.tsx`, POST `/api/intake/[token]`).
  - Sign-up link: `/join/[token]` ("Sign up as a new patient", POST `/api/join/[token]`), managed at `/settings/patients/signup-link` ("Create a sign-up link", "Copy link", "Print", QR code).
  - CSV import: `/settings/patients/import` ("Import patients": "Choose a file", "Match the columns", "Review before importing"). Required columns are first name, last name and date of birth (`lib/patients/import/mapping.ts`, which knows Cerbo, Healthie, OptiMantra and IntakeQ header names).
  - Face-sheet fill on the new-patient form ("Drop a face sheet", "Choose a face sheet file", "Paste text instead"; POST `/api/patients/face-sheet`). Shown only when `faceSheetAvailable()` (`lib/face-sheet/config.ts`): ANTHROPIC_API_KEY set and FACE_SHEET_AI_ENABLED not "false".
  - Keragon sync (ask 7) adds patients with no typing.
- **UI typing left for staff:** on "+ New patient", only "Mobile number" is required; "First name (optional)", "Last name (optional)" and "State (optional)" follow. The patient types the rest at `/intake`. The sign-up link and Keragon need no staff typing; the CSV import needs a column mapping, not per-patient typing.
- **Tests:** `np/_components/__tests__/new-patient.test.tsx`, `face-sheet-fill.test.tsx`, `app/intake/[token]/__tests__/*`, `app/join/[token]/__tests__/page.test.tsx`, `lib/intake/__tests__/*`, `app/api/patients/__tests__/create-patient.test.ts`, `settings/patients/import/__tests__/*`, `settings/patients/signup-link/__tests__/signup-link.test.tsx`; E2E `intake.spec.ts`, `patient-signup-link.spec.ts`, `patient-import.spec.ts`, `face-sheet-fill.spec.ts`.
- **Verdict: PARTIAL.**
  - The intake portal, the sign-up link, the import and the face sheet are all on main.
  - "Zero typing" is not met on the staff path: the mobile number is typed unless a face sheet is read, and the face sheet only appears when the AI key is configured (the prod setting is not visible from code).
  - The shared rate limit for `/api/join` and the face sheet is on the unmerged branch **rate-limit-db** (hardening, not part of the ask).

### Ask 5. How do we add providers? Follow-up: Team page with invites and prescriber verification
- **Code:**
  - `app/(clinic-app)/settings/team/page.tsx` ("Team") with `_components/team-panel.tsx` and `credentials-editor.tsx`; POST `/api/team/providers` and `/api/team/invites`, approved clinics only.
  - NPI registry check in `lib/providers/npi.ts` and `verify-npi.ts` (POST `/api/providers/[providerId]/npi-check`).
  - Signing refuses an unverified NPI or a missing or expired license (`lib/orders/batch-sign.ts`).
  - Ops approval needs "I checked this provider's license with the state board" for an unverified NPI (`lib/onboarding/provider-review.ts`; the server returns 422 without it).
- **UI (/settings/team):**
  - "Team members" (Name, Email, Role, Status; "Deactivate" / "Reactivate").
  - "Add a provider" (First name, Last name, Email, NPI, "State licenses", "Add another license"; "Add provider").
  - "Invite a medical assistant or clinic admin" (Name, Email, Role; "Create invite").
  - "Invite link ready" with "Copy link"; "Pending invites" with "Resend" / "Revoke".
  - Per provider: "Save license", "Re-run NPI check".
- **Tests:** `settings/team/__tests__/team-panel.test.tsx`, `settings/__tests__/team.test.tsx`, `lib/providers/__tests__/npi.test.ts` and the other provider tests, `app/api/ops/onboarding/__tests__/approve-unverified.test.ts`, `lib/onboarding/__tests__/provider-review.test.ts`; E2E `team-invites.spec.ts`, `self-serve-signup.spec.ts` (Approve disabled until the license check is ticked).
- **Verdict: DONE.** Hardening is unmerged: NPI squatting at approval and duplicate-email probing on **signup-squatting**; the reactivation ban (L12) on **security-followups-2**.

### Ask 6. How are new clinics and pharmacies added? Follow-up: clinic and pharmacy onboarding portals
- **Code and UI, clinics:**
  - Ops "Clinic onboarding" (`/ops/onboarding`: "Invite a clinic", "Clinics in onboarding", "Approved clinics", "Clinic invites"; review at `/ops/onboarding/[clinicId]`).
  - Invite accept at `/onboard/clinic/[token]`.
  - The clinic wizard `/onboarding` (practice, providers, staff, BAA, terms, payouts, review; `lib/onboarding/steps.ts`).
  - Self-serve `/get-started` (from /login, "New to CompoundIQ? Get started"; "I'm a provider (solo practice)", "I run a clinic or practice").
- **Code and UI, pharmacies:**
  - Ops "Pharmacy onboarding" (`/ops/onboarding/pharmacies`: "Invite a pharmacy", "Invites", "Applications"; review at `/ops/onboarding/pharmacies/[applicationId]`).
  - Invite accept at `/onboard/pharmacy/[token]`.
  - The wizard `/pharmacy/onboarding` (details, facility, licenses, ordering, shipping, BAA, terms, catalog; `lib/pharmacy-onboarding/steps.ts`).
  - Self-serve "I run a compounding pharmacy" on `/get-started`.
- **Tests:** `app/get-started/__tests__/get-started-form.test.tsx`, `app/api/signup/__tests__/route.test.ts`, `lib/signup/__tests__/self-serve.test.ts`, `app/api/onboarding/__tests__/*`, `ops/onboarding/__tests__/*`, `app/api/__tests__/pharmacy-onboarding-routes.test.ts`, `app/pharmacy/__tests__/pharmacy-onboarding-ui.test.tsx`, `lib/pharmacy-onboarding/__tests__/*`; E2E `self-serve-signup.spec.ts`, `clinic-onboarding-status.spec.ts`, `pharmacy-onboarding-a11y.spec.ts`.
- **Verdict: DONE.** The clinic payouts step is not live; approval sets a demo payout account. Ops deleting an unapproved self sign-up is on the unmerged branch **signup-squatting**.

### Ask 7. Do we connect to a clinic's existing EHR? Import plus live sync via Keragon, then a direct connector (likely Cerbo)
- **Code (Keragon):**
  - `lib/integrations/keragon/*` (access, connection, contract, mapping, signature, sync, webhook).
  - Webhook POST `/api/integrations/keragon/patients`: HMAC-signed, one patient per event, upsert by external id, possible duplicates flagged and never merged, a patient's own intake answers never overwritten.
  - `/api/integrations/keragon/connection` and `/connection/secret`.
- **UI:**
  - Clinic admin `/settings/integrations` ("EHR sync": "Connection", "Generate secret", "Rotate secret" then "Rotate now", "Disconnect" then "Disconnect now", "Sync log").
  - Ops "EHR sync" (`/ops/integrations`).
- **Tests:** `settings/integrations/__tests__/ehr-sync-panel.test.tsx`, `app/api/integrations/keragon/__tests__/patients-route.test.ts`, `lib/integrations/keragon/__tests__/*`; E2E `ehr-sync-keragon.spec.ts`.
- **Verdict, Keragon import plus live sync: PARTIAL.**
  - Live inbound patient sync is done.
  - "Import" means one patient per event: there is no bulk pull of an existing EHR's patients through Keragon (the bulk path is the CSV import).
  - Nothing flows back to the EHR.
  - The branch ehr-sync-keragon is already on main. The cross-site check change for the Keragon routes (L6) is on the unmerged branch **security-followups-2**.
- **Verdict, direct Cerbo connector: MISSING.** Cerbo appears in code only as CSV header names (`lib/patients/import/mapping.ts`). Which EHR the pilots use is still unanswered in the meeting notes.

### Ask 9. Sending orders to pharmacies, with an on/off switch
- **Code:**
  - `lib/adapters/submission-switch.ts` with `lib/env.ts`: on only when PHARMACY_SUBMISSIONS_ENABLED is exactly "true"; unset means off.
  - Checked by the Stripe webhook, the routing engine, the submit-paid-orders, sla-check and fax-retry crons, the ops order action (423) and `/api/adapters/submit`.
  - Asserted again inside the Tier 1, Tier 2 and Tier 4 senders and the Documo client.
- **UI:** none shows the switch. A refused ops action shows "Pharmacy submissions are turned off. Nothing was sent and the order was not changed." in the order drawer.
- **Tests:** `lib/adapters/__tests__/submission-kill-switch.test.ts`. No E2E.
- **Verdict: DONE.**
  - The prod value is a Vercel environment variable and cannot be read from code.
  - Gap: ops cannot see whether the switch is on until an action is refused.

### Decision 1. Patient intake (each part)
- **(a) Prescribe now, hold the order until intake is finished: DONE.**
  - Review sets `intakePending` (`np/review/_components/batch-review-form.tsx`) and offers "Save as Draft: Sign When the Patient Finishes".
  - The server refuses to sign: `lib/orders/batch-sign.ts`, intake_pending, "the patient has not finished their details yet. Nothing was signed". `signBatch` is the only signing path; proposal signing goes through it too.
  - The server refuses payment: `app/api/checkout/payment-intent/route.ts` and `payment-group-intent/route.ts`.
  - Tests: `lib/orders/__tests__/batch-sign.test.ts` (intake_pending), the two checkout route tests, `intake-pending-session.test.tsx`. No test asserts the "Save as Draft: Sign When the Patient Finishes" button, and no E2E walks the hold.
- **(b) License scan optional: DONE.** `/intake/[token]` "Your details" offers "Scan my license" or "Type my details" (`license-scanner.tsx`, `lib/intake/aamva.ts`); New Hampshire is typed only. Tests: `intake-flow.test.tsx`, `lib/intake/__tests__/aamva.test.ts`.
- **(c) Sex collected: DONE.**
  - The intake "Sex" radio offers Female, Male and "Prefer not to say", and is required to submit (`lib/intake/submission.ts`).
  - Stored in `patients.sex` (migration `20261006000001_patient_consent_intake_foundations.sql`).
  - Staff form: "Sex (optional)".
  - Tests: `lib/intake/__tests__/*`, `intake-flow.test.tsx`.
- **(d) Current medications free text: DONE.** "Current medications (optional)", a textarea at intake and on the staff form; `patients.current_medications` TEXT (migration `20261015000001_patient_self_intake.sql`). Tests: `intake-flow.test.tsx`, `lib/intake/__tests__/*`.
- (e) Keragon for EHR sync during the pilots: see ask 7.

### Decision 6. All pharmacies, clinics and patients on prod are demo; pharmacy submissions on
- **Code:**
  - Demo markers: `lib/stripe/demo-account.ts` ("Demo payout account" for `poc_placeholder*` and `acct_poc_*`).
  - `lib/clinics/demo-payouts.ts` (DEMO_PAYOUTS_ON_APPROVAL).
  - `demo_seed` provider credential rows, which disable "Re-run NPI check".
  - `lib/poc/*` seed rows under POC_MODE, and `/ops/demo-tools`.
  - The submissions switch defaults to off.
- **Tests:** `settings/__tests__/stripe-demo-account-label.test.tsx`, `app/api/ops/onboarding/__tests__/approve-demo-payouts.test.ts`, `lib/poc/__tests__/*`, `lib/adapters/__tests__/submission-kill-switch.test.ts`; E2E `clinic-onboarding-status.spec.ts`.
- **Verdict: PARTIAL.**
  - There is no demo or real flag on clinics, pharmacies or patients, so the code treats a real pharmacy and a demo one the same. Only payout ids, `demo_seed` rows and POC seed markers tell them apart.
  - Whether prod holds only demo data, and whether PHARMACY_SUBMISSIONS_ENABLED is "true" there, cannot be seen from code; it needs a check of the prod data and environment.

## Summary

| # | Requirement | Verdict | Gap |
|---|---|---|---|
| 1 | mg next to favorite doses | DONE | mg only when the formulation has an mg/mL concentration |
| 2 | Days supply on the Rx | DONE | |
| 3 | Quantity to dispense | PARTIAL | PDF and every adapter also send `Quantity: 1`, contradicting the Dispense line (fixed on unmerged branch rx-quantity-shipping) |
| 4 | Vial size by price, auto, multiples | DONE | needs a duration and priced packages; shares the `Quantity: 1` defect |
| 5 | Refills | DONE | search step caps at 5, Review at 12 (one 0 to 12 range on unmerged branch rx-quantity-shipping) |
| 6 | GLP-1 clinical difference | PARTIAL | auto-expands but nothing pre-selected; Strive-style statements not offered or savable |
| 7 | Syringes or none | DONE | no count or size (not asked) |
| 8 | Shipping type (cold chain) | DONE | non-GLP-1 refrigerated products default to Standard |
| 9 | Allergies / NKDA on the Rx | PARTIAL | not enforced; an Rx can go out with "Allergies: Not recorded" |
| 10 | Diagnosis | DONE | free text, no ICD-10 lookup |
| 11 | Special instructions | DONE | no E2E types into it |
| 12 | Edit at Review, Back, pending queue | DONE | queue is per browser tab |
| 13 | Edit a draft, add Rx to it | DONE | |
| 14 | Sign all at once | DONE | 25 per batch, own drafts only |
| 15 | Shipping with pricing, double-shipping warning | PARTIAL | no shipping on the pharmacy cards; warning only at Review, not for saved drafts (both on unmerged branch rx-quantity-shipping) |
| 16 | Favorite opens the dose step | DONE | |
| 17 | Doses grouped under the drug | DONE | one card per pharmacy and concentration |
| 18 | Sorted A to Z and by category | DONE | |
| 19 | Frequently used, convertible | PARTIAL | it is "Recent" (last 8), not frequency (Frequently used, 90 days, on unmerged branch favorites-frequent) |
| 20 | Patient-scoped favorites | DONE | |
| 21 | Patient protocol choice | DONE | |

Sep 11 (Gina Rooks): 16 DONE, 5 PARTIAL, 0 MISSING.

| # | Oct 5 item | Verdict | Gap |
|---|---|---|---|
| A2 | Admin dashboard, full admin click-through | PARTIAL | no admin click-through on main (checklist only on docs-prod-clickthrough); Notifications is a placeholder |
| A3 | Clinic admin lands on Practice | DONE | |
| A4 | Add patients, zero staff typing | PARTIAL | staff still type the mobile number unless a face sheet is read; the face sheet needs the AI key |
| A5 | Add providers, invites, prescriber verification | DONE | squatting and reactivation hardening on signup-squatting and security-followups-2 |
| A6 | Clinic and pharmacy onboarding portals | DONE | clinic payouts step not live (demo payout on approval) |
| A7a | EHR import plus live sync via Keragon | PARTIAL | inbound per-patient events only; no bulk pull, nothing back to the EHR |
| A7b | Direct EHR connector (Cerbo) | MISSING | not built; pilot EHR still unanswered |
| A9 | Pharmacy submissions with an on/off switch | DONE | switch state not shown to ops; prod value not visible from code |
| D1a | Prescribe now, hold until intake finished | DONE | no button test, no E2E of the hold |
| D1b | License scan optional | DONE | |
| D1c | Sex collected | DONE | |
| D1d | Current meds free text | DONE | |
| D3 | Clinic admin lands on Practice | DONE | same as A3 |
| D6 | Prod all demo, submissions on | PARTIAL | no demo/real flag in the data model; prod data and env not visible from code |

Oct 5: 9 DONE, 4 PARTIAL, 1 MISSING.

**Totals:** 25 DONE, 9 PARTIAL, 1 MISSING (35 items).
