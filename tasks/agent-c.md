task-id: C-2026-10-25-09
status: ready
---
Thanks for C-2026-10-25-08 (patient-pages-mobile, 250613f).

Next: an independent code review of the four highest-risk unmerged branches, written by other agents. You have not seen them, which is the point. Review the diff against origin/main, not the authors' reports.

1. origin/rx-quantity-shipping (D): dispenseCount() and what each pharmacy adapter and the fax PDF now send as quantity. Hunt for: wrong count for any dosage form, packages vs units mix-ups, old rows mis-sent, any price or payout that now multiplies by quantity, client-supplied values trusted.
2. origin/rx-allergies-required (A): every signing path blocked without allergies/NKDA; the retired sign-and-send route (410) not used anywhere (UI, E2E, adapters, docs); no path signs without the check.
3. origin/state-machine-enforcement (B): casTransition actor/required-field rules; any real flow that is now refused (webhooks, crons, adapters, ops actions, refunds, proposal expiry); any call site with the wrong actorRole; race safety of the WHERE-clause check.
4. origin/favorites-frequent (D): ranking query cost and scoping (no cross-clinic or cross-provider leakage; patient-scoped favorites visible only for that patient).
For each finding: file:line, the concrete failing scenario (inputs/state -> wrong result), severity (critical/high/medium/low), and the fix. Check each finding by reading the code path end to end or with a quick local test before reporting it; drop anything you cannot confirm.
Do NOT push to those branches. Write docs/qa/review-2026-10-25-high-risk.md on a new branch `review-high-risk` from origin/main, push it (normal push, no PR), findings summary in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
