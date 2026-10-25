task-id: B-2026-10-25-10
status: ready
---
Thanks for B-2026-10-25-09 (bundle-features, f75138e).

Next: prove the practitioner's list in CI. Add one E2E spec on bundle-features that walks the NP's requirements end to end, so the bundle's PR run checks them.

`git checkout bundle-features && git pull` (you own it; C is reviewing f75138e in parallel, so add commits on top, do not rewrite).
Add e2e/practitioner-requirements.spec.ts (and register it in playwright.config testMatch). Using existing seed tables only:
- Provider builds an Rx for a GLP-1 injectable: days supply, vial auto-selection with more than one vial, refills, clinical difference (required, choose one), syringes, cold-chain shipping, diagnosis, special instructions. Assert Review shows quantity and unit (e.g. "2 vials").
- Patient with no allergies: signing is blocked with "Record allergies or mark NKDA before signing"; mark NKDA inline; signing proceeds.
- The Rx PDF route (or the fax PDF builder via the app's own preview, if one exists) shows "Quantity: 2 vials". If there is no UI path to the PDF in E2E, assert it through an existing test API used by other specs, or skip with a clear comment and rely on jest.
- Favorites: Frequently used shows the dose just ordered after an order exists; Make favorite for This patient; the favorite opens the dose step with dropdowns filled.
- Two pharmacies in one order: the double-shipping notice appears on the price page.
- Sign all signs every draft for the patient.
Use unique locators (no getByRole('alert'): Next's route announcer matches it). Never enter a card. Keep it under ~3 minutes.
Run it locally against your local/E2E setup if you can; if you cannot run it locally, say so and make it as robust as you can (it will run in the PR).
Gates: lint (0 warnings), tsc, jest, next build. Push bundle-features (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
