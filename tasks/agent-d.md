task-id: D-2026-10-25-09
status: ready
---
Thanks for D-2026-10-25-08 (Oct 5 audit, 21de866).

Next: the source content for the cofounder review run sheet (v3.0). I will turn it into a Word document; you write the AI-facing source.

Branch: `git fetch origin && git checkout -b docs-run-sheet-v3 origin/docs-prod-clickthrough` (reuse your checklist).
Write docs/qa/run-sheet-v3-source.md: a click-by-click demo script for a 45 to 60 minute walk-through with the cofounder on prod, assuming every branch in the merge queue has merged (your coverage doc lists them; include rx-quantity-shipping, rx-allergies-required, favorites-frequent, error-boundaries, token-pages-hardening, checkout-token-out-of-url, settings-notifications if it lands).
Structure:
1. Before the call: accounts to sign in (Sunrise clinic admin admin@sunrise-clinic.com, provider Dr. Chen, ops admin), browser tabs to open, demo orders to have ready (DEMO-1001..1015, DEMO-1011 failed).
2. The story, in order: clinic admin lands on Practice; team and invites; adding patients (intake link, sign-up link/QR, CSV import); provider writes an Rx with every field the NP asked for (days supply, quantity with the real vial count, vial auto-select, refills, clinical difference, syringes, shipping type, allergies/NKDA required, diagnosis, special instructions), favorites and Frequently used, edit at review, Sign all; patient protocol choice end to end (propose, Copy link/QR, /plan DOB, choose, provider signs chosen lines); checkout page (show it, NEVER enter a card); order drawer status, failure reason on DEMO-1011; ops pipeline filters, approval with license check, fax viewer; pharmacy onboarding.
3. For each step: exact clicks, exact visible text to point at, one line on why it matters to a clinic, and the NEVER items (card entry, Reset Credentials on /ops/demo-tools, Re-run NPI check on demo providers, anything sending real SMS/fax/email, Approve on a real clinic).
4. Expected questions and short honest answers: EHR (Keragon live inbound sync; no direct Cerbo connector yet; which EHR do pilots use?), HIPAA/BAAs (none signed yet; demo data only), how pharmacies receive orders (API/Portal/Hybrid/Fax tiers; Hybrid not available yet), payments (Stripe live; demo payouts), what is not built yet (from your coverage gaps).
Keep it plain and short. Read the code for labels; do not guess.
Push docs-run-sheet-v3 (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
