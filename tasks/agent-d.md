task-id: D-2026-10-25-11
status: ready
---
Thanks for D-2026-10-25-10 (quantity has one meaning, 9e2b075).

Next: source content for a "What's new since October 5" summary for the cofounder (non-technical reader). I will turn it into a Word document; you write the AI-facing source.

Branch: `git checkout docs-run-sheet-v3 && git pull` (your branch), add docs/qa/whats-new-since-oct5-source.md.
- Cover everything merged to main since 2026-10-05 (git log origin/main --since=2026-10-05, read the PRs' code, not just titles) plus everything in the merge queue (your coverage doc and A's dry-run report list the branches; include the quantity fix with its new rule, allergies required, favorites Frequently used, state machine enforcement, Notifications page, patient pages on phones, token page hardening).
- Group by what a clinic notices: Adding patients; Team and onboarding; Writing prescriptions; Patient choice of protocol; Payments and checkout; Pharmacy delivery (tiers, quantity, fax); Ops tools; Security and compliance (plain words: what is protected, what is still outstanding: BAAs not signed, demo data only, Twilio not on prod so no texts sent); What is not built yet (from your coverage gaps: direct Cerbo connector, Hybrid tier, EHR write-back, pharmacy home, notification preferences if B could not build them).
- For each item: one or two plain sentences, no code terms, no branch names, no PR numbers. Mark items still in the merge queue as "(finishing)".
- Answer the Oct 5 questions directly in a short section at the top: how do we add patients, providers, clinics and pharmacies; is the admin dashboard set up; do we connect to an EHR; are orders sent to pharmacies.
Push docs-run-sheet-v3 (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
