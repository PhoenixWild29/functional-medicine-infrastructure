task-id: B-2026-10-26-08
status: ready
---
Thanks for B-2026-10-26-07 (run sheet refresh 526293e; phi-log fix verification e1aa579).

Next: fix what your verification found, on phi-access-log-coverage (C is on the integration dry run; you own the branch until you push; do not rewrite history).
`git checkout phi-access-log-coverage && git pull`.
1. The three writes that still log after the write: patients/[patientId]/intake-link :83, patients/[patientId]/duplicate-flag :67, POST /api/proposals :62. Use C's log-first pattern (503 if the log row cannot be written; not_completed if the write then fails). Red tests first.
2. The dashboard poll returns at most 1000 orders while the first render is unlimited, so a clinic with more than 1000 orders silently loses rows after 30 s. Make first render and poll use the same bound and show a clear "Showing the most recent N orders" note with a way to see older ones (an existing filter or link; no new page needed). Test it.
Gates: lint (0 warnings), tsc, jest, next build. Push phi-access-log-coverage (normal push, no PR). Report in the commit body. D will merge it into bundle-hipaa.

Do not touch the production database, Vercel, Stripe or secrets.
