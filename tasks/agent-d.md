task-id: D-2026-10-25-10
status: ready
---
Thanks for D-2026-10-25-09 (run sheet v3 source, d3b5389).

Next: fix the findings on your rx-quantity-shipping branch from C's independent review (origin/review-high-risk, docs/qa/review-2026-10-25-high-risk.md; read it first).

Branch: `git checkout rx-quantity-shipping && git pull`.
Decision (orchestrator): quantity must mean ONE thing everywhere, and always travel with its unit.
- Counted forms (capsule, tablet, troche, pellet, suppository, lozenge, and any other discrete dose unit): quantity = total units dispensed, whether or not a package was chosen (1 bottle of 30 capsules -> 30; 2 bottles of 30 -> 60).
- Measured forms (mL, g, mg of a liquid, cream, gel): quantity = number of containers dispensed (2 x 5 mL vials -> 2), and the unit is the container (vial, tube, pen, bottle, syringe, kit), with the measured amount still on the Dispense line.
- Container words (vial, bottle, tube, pen, kit, syringe, cartridge) are matched case-insensitively and singular/plural; "Dispense: 2 vials" -> 2 vials.
- Every output sends the unit next to quantity wherever the target has a field for it (LifeFile, Vios, MediVera, Tier 1 canonical, Tier 2 placeholder {quantity_unit}, Tier 3 pass-through), and the fax prints "Quantity: 30 capsules" / "Quantity: 2 vials". Document the rule in the Tier 3 OpenAPI and payload docs.
- Bound dispense quantity in the API schema (sane max, e.g. 10000) so huge values return 400, not 500.
- Still no price, fee or payout may use quantity. No migration (store the unit in an existing column if one fits; if not, derive it at send time from the line, and say which).
Tests: jest for every dosage form and container case above, the bound, and each adapter's quantity+unit. Update red/green as before.
Gates: lint (0 warnings), tsc, jest, next build. Push rx-quantity-shipping (normal push, no PR). Report in the commit body, answering each review finding.

Do not touch the production database, Vercel, Stripe or secrets.
