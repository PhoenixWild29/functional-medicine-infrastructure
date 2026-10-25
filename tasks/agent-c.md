task-id: C-2026-10-25-17
status: ready
---
Thanks for C-2026-10-25-16 (HIPAA evidence map, a004e06). Excellent. A, D and you are now closing the code gaps.

Yours: B14 and B15 (PHI access logging).

Branch: `git fetch origin && git checkout -b phi-access-log-coverage origin/bundle-features`.
1. B14: log every PHI read and write path you listed as unlogged: the dashboard poll and other browser-driven reads (log server-side at the API they call), list views (log the list view with the patient ids returned, bounded, or a hashed set if the existing schema expects one; follow logPhiAccess's contract), favorites when patient-scoped, the search edit page, the import parse, ops fax views (the fax PR adds fax_id; use it once merged, else log resource only and note it), ops actions, proposal send, token-link and patient actors (the patient on /plan, /intake, /checkout as a distinct actor type), and disclosures to pharmacies (each transmission), OpenAI and Anthropic (each face sheet or AI call that carries PHI).
2. B15: logPhiAccess never fails closed and nobody is alerted. Decide per path: for disclosures and writes, fail closed (do not disclose if the log write fails); for reads, keep serving but raise an alert (Sentry/Slack with no PHI) on any log failure. Add a startup/health check that PHI_ACCESS_LOG_HASH_SECRET is set (fail the health check without printing it).
If a new action/actor value needs a schema change (enum or CHECK), do NOT migrate; use existing values where they fit and report the design for what does not.
Tests: jest for each new logging call (one per path), fail-closed on disclosure, alert on read failure, and the secret check.
Gates: lint (0 warnings), tsc, jest, next build. Push phi-access-log-coverage (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
