# Practitioner requirements coverage

An audit of what main implements against the practising NP's feedback, done before the cofounder review. The code on `main` at 2696ff2 (2026-10-25) is the only evidence used; older docs, WO status notes and commit messages were not trusted. Paths are relative to `src/`. `np/` means `app/(clinic-app)/new-prescription/`.

## Sources

- **Primary:** `docs/practitioner-feedback/2026-09-11-gina-rooks-email.md` (Gina Rooks NP) and `docs/practitioner-feedback/2026-09-11-product-run-thru-transcript.md`.
- **Oct 5 meeting:** no document on main covers it. Searches of `docs/` for "Oct 5", "October 5", "2026-10-05" and "10-05" found nothing. The only hits for "Anila" are in the Sep 11 transcript and in `docs/phase21-practitioner-feedback-workorders.md`, which also cites Sep 11. **No requirements were added from Oct 5.** If notes from that meeting exist, they need to be committed before they can be audited.

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

## Summary

| # | Requirement | Verdict | Gap |
|---|---|---|---|
| 1 | mg next to favorite doses | DONE | mg only when the formulation has an mg/mL concentration |
| 2 | Days supply on the Rx | DONE | |
| 3 | Quantity to dispense | PARTIAL | PDF and every adapter also send `Quantity: 1`, contradicting the Dispense line |
| 4 | Vial size by price, auto, multiples | DONE | needs a duration and priced packages; shares the `Quantity: 1` defect |
| 5 | Refills | DONE | search step caps at 5, Review at 12 |
| 6 | GLP-1 clinical difference | PARTIAL | auto-expands but nothing pre-selected; Strive-style statements not offered or savable |
| 7 | Syringes or none | DONE | no count or size (not asked) |
| 8 | Shipping type (cold chain) | DONE | non-GLP-1 refrigerated products default to Standard |
| 9 | Allergies / NKDA on the Rx | PARTIAL | not enforced; an Rx can go out with "Allergies: Not recorded" |
| 10 | Diagnosis | DONE | free text, no ICD-10 lookup |
| 11 | Special instructions | DONE | no E2E types into it |
| 12 | Edit at Review, Back, pending queue | DONE | queue is per browser tab |
| 13 | Edit a draft, add Rx to it | DONE | |
| 14 | Sign all at once | DONE | 25 per batch, own drafts only |
| 15 | Shipping with pricing, double-shipping warning | PARTIAL | no shipping on the pharmacy cards; warning only at Review, not for saved drafts |
| 16 | Favorite opens the dose step | DONE | |
| 17 | Doses grouped under the drug | DONE | one card per pharmacy and concentration |
| 18 | Sorted A to Z and by category | DONE | |
| 19 | Frequently used, convertible | PARTIAL | it is "Recent" (last 8), not frequency |
| 20 | Patient-scoped favorites | DONE | |
| 21 | Patient protocol choice | DONE | |

**Totals:** 16 DONE, 5 PARTIAL, 0 MISSING. No Oct 5 requirements were found on main.
