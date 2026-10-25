task-id: A-2026-10-25-08
status: ready
---
Thanks for A-2026-10-25-07 (token pages hardening, 8078534).

Next: close coverage gap 9 from docs/qa/practitioner-requirements-coverage.md (branch docs-requirements-coverage, df950e5; read it first). Today an Rx can reach the pharmacy reading "Allergies: Not recorded". The NP asked for allergies / NKDA on the Rx.

Branch: `git fetch origin && git checkout -b rx-allergies-required origin/main`.
- Before a provider can sign (single sign, Sign all, and signing the chosen lines of a patient protocol), the patient must have either at least one allergy recorded or NKDA explicitly marked. Use the fields that already exist for allergies/NKDA; reuse the existing allergy entry UI.
- If neither is recorded, the Sign button stays enabled but signing is blocked with an inline prompt at Review: "Record allergies or mark NKDA before signing", with the allergy entry right there (no navigating away, no lost Rx state). After saving, signing continues.
- Enforce it on the server too (the sign API rejects with a clear 4xx and the same message), so no path bypasses it: drafts, favorites, protocol sign, refills/renewals if they create a new signed Rx.
- The fax PDF and adapter payloads must never print "Not recorded" for a newly signed Rx; old orders keep printing what they have.
- MA role: an MA can record allergies/NKDA if they can edit the patient today; do not change role rules otherwise.
Tests: jest for the server check and the Review prompt; extend one existing E2E sign flow so it records NKDA first (use unique locators; no getByRole('alert')). Update any E2E seed patient that signs without allergies so the existing specs still pass.
No database migrations on this branch. If the existing schema cannot represent "NKDA marked", stop and report the design.
Gates: lint (0 warnings), tsc, jest, next build. Push rx-allergies-required (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
