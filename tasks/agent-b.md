task-id: B-2026-10-26-04
status: ready
---
Thanks for B-2026-10-26-03 (phi-log review, aee1e70). C is fixing L1-L10.

Next: bring the cofounder-facing sources up to date with the HIPAA and security work, so the Word documents are accurate.
`git checkout docs-run-sheet-v3 && git pull` (D's docs branch; D is on bundle-hipaa, so you own this branch until you push).
1. docs/qa/whats-new-since-oct5-source.md: add a plain-language section "Security and privacy hardening (finishing)" covering: password reset and change; no admin-chosen passwords; failed sign-in alerts; demo passwords out of the code (accounts to rotate after the demo); every view of patient data logged, with an ops access review page and an emergency-access procedure; orders refused unless signed and unchanged since signing; clinical fields locked after signing; pharmacy addresses must be secure; saved clinical difference statements; in-app Help; keyboard and screen-reader fixes. Update "What is still outstanding" with the decisions in docs/decisions/before-real-patients-2026-10-25.md (origin/bundle-docs) and C's B1-B17 gaps that remain (origin/review-high-risk docs/compliance/technical-safeguards-evidence-2026-10-25.md), in plain words. No branch names or PR numbers.
2. docs/qa/practitioner-requirements-coverage.md: requirement 6 (clinical difference) now has saved statements on clinical-difference-saved; mark the branch. Add a short "HIPAA technical safeguards" table: each of C's B1-B17, status (fixed on <branch>, open, decision for Sam).
3. docs/qa/prod-clickthrough-checklist.md: add items for /help, password reset (view the page only; do not send a reset to a real address), Settings > Account change password (on a demo account only, and note the POC password env vars), /ops/access-review, /ops/security, the emergency reason prompt (cancel it; do not submit), saved clinical statements (WRITES DATA). Keep SAFE / WRITES DATA / NEVER marks.
Push docs-run-sheet-v3 (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
