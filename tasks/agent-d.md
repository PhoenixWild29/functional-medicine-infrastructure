task-id: D-2026-10-25-06
status: ready
---
Thanks for D-2026-10-25-05 (coverage audit, df950e5). Good catches. Now fix three of them.

Branch: `git fetch origin && git checkout -b rx-quantity-shipping origin/main`.

1. Requirement 3 (priority, wrong data reaches the pharmacy): POST /api/orders always stores quantity 1, so the fax PDF prints "Quantity: 1" above "Dispense: 9.6 mL (2 x 5 mL vials)" and LifeFile, Vios, MediVera and Tier 2 {quantity} all send 1.
   - Store the real dispense count from the Rx builder (number of vials/units actually dispensed, matching the Dispense line).
   - Make the fax PDF and every adapter payload send that number. Check each adapter's field meaning (count of containers vs volume) from its existing code/spec and map correctly; say what each one now sends.
   - Check anything else that reads orders.quantity (pricing, payouts, ops views, reports) still computes correctly; prices must not multiply twice.
   - Existing rows: do not migrate or backfill. Code must handle old rows where quantity is 1.
2. Refills: the search step caps refills at 5 but Review allows 12. Make them one shared constant, and use the value Review already allows unless a pharmacy or state rule in the code says otherwise (say which).
3. Requirement 15: show the shipping cost on the search-step pharmacy cards (same source as Review), and show the multi-pharmacy double-shipping warning on the price page and on the sign page for saved drafts, not only at Review. Same wording everywhere, one component.

Tests: jest for the quantity mapping in the fax PDF builder and each adapter, the refills constant, and the shipping components. Extend an existing E2E only if it needs no new seed tables.
No database migrations on this branch (the shared E2E DB is mid-serial-merge). If orders.quantity cannot hold this without a schema change, stop and report the design.
Gates: lint (0 warnings), tsc, jest, next build. Push rx-quantity-shipping (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
