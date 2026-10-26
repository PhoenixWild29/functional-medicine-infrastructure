task-id: B-2026-10-26-03
status: ready
---
Thanks for B-2026-10-26-02 (password-flows fixes, 1d0ed5e). C will verify them.

Next: independent review of origin/phi-access-log-coverage (C, 896cc3f; D has merged it into audit-review-breakglass, so also glance at that merge). Review the diff against origin/bundle-features, not C's report.
Hunt for:
- PHI paths still unlogged: list every server route, server component and server action that reads or writes patients, orders with patient data, proposals, intake, face sheets, imports, faxes, or sends PHI to a third party (pharmacy adapters, fax, OpenAI, Anthropic, Twilio, Keragon). For each: logged or not, with file:line.
- Fail-closed correctness: disclosures and writes do not proceed when the log write fails; reads still serve but alert; no path where a thrown log error leaks a 500 with details.
- Log content: no PHI in the log row beyond the allowed ids/hashes; patient actors on token pages identified without storing the token; list views bounded.
- Performance: list views do not issue one insert per row per poll in a way that floods the table (the dashboard polls every 30 s); suggest batching if so.
- The health check: production-only 503 when PHI_ACCESS_LOG_HASH_SECRET is missing, value never printed.
For each finding: file:line, concrete failing scenario, severity, fix. Confirm before reporting.
Do NOT push to C's or D's branches. Append to docs/qa/review-2026-10-26-hipaa-fixes.md on review-hipaa-fixes, push (normal push, no PR), summary in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
