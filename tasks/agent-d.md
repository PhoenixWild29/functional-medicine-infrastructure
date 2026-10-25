task-id: D-2026-10-25-05
status: ready
---
Thanks for D-2026-10-25-04 (prod click-through checklist, 0ed4ea7).

Next: a requirements coverage audit against the code on main, so nothing the practitioners asked for is missed before the cofounder review (AI-facing; Markdown is right).

Branch: `git fetch origin && git checkout -b docs-requirements-coverage origin/main`.
Write docs/qa/practitioner-requirements-coverage.md. For EACH requirement below, find the code on main that implements it (file paths and the component/route/function), say how a user reaches it in the UI (exact page and button/field labels), and give a verdict: DONE, PARTIAL (say exactly what is missing), or MISSING. Read the code; do not trust older docs, WO status notes or commit messages. If a jest or E2E test covers it, name the test file. If one is missing, say so.

Requirements (from the practising NP's Sep 11 feedback; follow her wording, a half-built feature that still leaves her doing the arithmetic or a manual step is PARTIAL):
1. mg shown next to injectable doses in favorites, e.g. "10 units (0.5 mg)".
2. Duration (days supply: 30, 90 days etc) on the Rx.
3. Quantity/count to dispense.
4. Vial size selection, priced by size, auto-selected by calculation; multiple vials of one size when no single vial covers the Rx.
5. Refills authorized.
6. Clinical difference statements for GLP-1s (auto-expands, pre-selected).
7. Syringes on the Rx, or indicate none.
8. Shipping type, temperature sensitive or not.
9. Allergies / NKDA on the Rx.
10. Diagnosis.
11. Special instructions (e.g. remove a filler or dye).
12. Edit an Rx at review and send; Back button works; a pending Rx queue.
13. Edit a saved draft and add other Rx to that order.
14. Sign all at once (sign every Rx in an order in one action).
15. Shipping costs shown with med pricing and at review, plus a warning about double shipping when the order spans pharmacies.
16. Favorites open the Rx builder DOSE STEP with dropdowns populated (NOT a free-text box / margin page).
17. Favorites: common doses grouped under the drug, not one favorite per unit dose.
18. Favorites sorted alphabetically and/or by category.
19. Favorites: a frequently used section, convertible to a favorite.
20. Favorites scoped to a specific patient as well as the practice.
21. Patient protocol choice: provider proposes options, patient chooses on /plan/<token> after DOB check, provider signs only the chosen lines (merged #268).
Also read the repo docs for the Oct 5 meeting decisions if present (search docs/ for "Oct 5", "2026-10-05", "Anila") and add any requirement you find there with the same treatment; list the doc you took it from.

Finish with a short table: requirement number, verdict, one-line gap. Keep the whole doc factual and short.
Push docs-requirements-coverage (normal push, no PR). Report in the commit body: counts of DONE/PARTIAL/MISSING and the gaps, one line each.

Do not touch the production database, Vercel, Stripe or secrets.
