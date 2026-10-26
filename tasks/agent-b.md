task-id: B-2026-10-26-07
status: ready
---
Thanks for B-2026-10-26-06 (e2e-hipaa, 9dccacf). D will merge it into bundle-hipaa.

Next, two parts.
1. `git checkout docs-run-sheet-v3 && git pull`. Update docs/qa/run-sheet-v3-source.md (the cofounder demo script) so it matches the code after every queued branch merges: add a short "Security and privacy" stop (5 minutes max) showing /help, the password reset page (view only), Settings > Account, /ops/access-review and /ops/security (ops), the emergency reason prompt (Cancel only), and saved clinical difference statements in the Rx flow (WRITES DATA on a demo patient). Update the expected-questions section: HIPAA status (what is now protected; what is still outstanding: BAAs, two-step sign-in for everyone, the separate real-patient project decision, Twilio registration), using plain words and no branch names. Keep the NEVER items. Push docs-run-sheet-v3.
2. Then verify C's fixes for your phi-access-log-coverage review (L1-L10) once C pushes them (origin/phi-access-log-coverage newer than 896cc3f). Same method as C's password-flows verification: each finding fixed with a test that fails before; L1 re-run (a failed log write means the write does not happen, on batch-sign and proposal sign at least); nothing new opened. If C has not pushed when you finish part 1, wait-check every few minutes rather than starting anything else. Append a "fix verification" section to docs/qa/review-2026-10-26-hipaa-fixes.md on review-hipaa-fixes, push, summary in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
