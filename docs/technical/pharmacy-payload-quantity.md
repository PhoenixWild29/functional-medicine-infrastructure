# Pharmacy payloads: quantity and its unit

Every pharmacy output carries one quantity with one meaning, always next to its unit. The rule is `dispenseQuantity()` in `src/lib/orders/rx-details.ts`. It is stored as `orders.quantity` (the number) and computed again from the order row at submission, so rows written before the rule also send the right count.

## The rule

| Line | quantity | unit |
|---|---|---|
| Counted form (capsule, tablet, troche, pellet, suppository, lozenge), package or not | units dispensed | the form, singular ("capsule") |
| Counted form from a package that states its count ("30 capsules" × 2) | package count × units per package (60) | the form |
| Counted form from a package that states no count ("1 bottle") | units needed, rounded up | the form |
| Measured form (mL, g, mg) from a package | packages (2 × 5 mL vials → 2) | the container in the label (vial, bottle, tube, pen, kit, syringe, cartridge), else "package" |
| Dispense stated in containers ("2 vials"), no package | the containers (2) | the container |
| Measured amount, no package | 1 | "container" |
| Old row with no package and no dispense | its stored quantity | "container" |

- Units and container words match case-insensitively, singular or plural.
- `rxDetails.dispenseUnit` is stored normalised ("Capsules" → "capsule").
- The measured amount stays on the Dispense line: `dispenseQuantity` + `dispenseUnit`, and `packageLabel` + `packageCount`.
- `rxDetails.dispenseQuantity` is at most 10000 (`MAX_DISPENSE_QUANTITY`); more is a 400.
- No price, fee, payout or shipping charge reads quantity.
- The unit is not stored: no existing `orders` column fits it, and adding one would need a migration. It is derived at send time from the line's package label and dispense unit.

## Where each output carries it

| Output | quantity | unit |
|---|---|---|
| Tier 1 canonical, Tier 3 pass-through (`OrderPayload`, OpenAPI `OrderSubmitRequest`) | `quantity` | `quantityUnit` |
| Vios | `medication.quantity` | `medication.quantity_unit` |
| LifeFile | `prescription.drug.quantity` | `prescription.drug.quantityUnit` |
| MediVera | `RxInfo.Qty` | `RxInfo.QtyUnit` |
| Tier 2 portal flows | `{quantity}` | `{quantity_unit}` |
| Tier 4 fax (Rx PDF) | `Quantity: 30 capsules` / `Quantity: 2 vials` | in the same line |

The stored debug copy of each request redacts `quantity` (as before) and the unit fields `quantity_unit`, `quantityUnit` and `QtyUnit` (`src/lib/phi/redact-adapter-payload.ts`).
