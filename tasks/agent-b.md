task-id: B-2026-10-26-01
status: ready
---
Thanks for B-2026-10-25-12 (auth-monitoring, b182d07). The rotation list is noted for Sam; rotation waits until after the cofounder demo, since Demo Tools needs the POC_* vars set first.

Next: independent review of two HIPAA fix branches you have not seen. Review the diff against origin/bundle-features, not the authors' reports.
1. origin/password-flows (D, 69e60cf): reset and change flows. Hunt for: account enumeration (any difference in response, timing or status between existing and unknown emails), reset link handling (token in URL leaking via Referer or logs; redirect target fixed to our origin, no open redirect), policy enforced server-side (not only in the browser), current password checked on change, other sessions signed out, must_change_password forced before any other page and not bypassable through API routes, rate limiting on forgot/reset/change, no password or token in logs/Sentry, the providers route no longer sets a known password.
2. origin/order-transmission-integrity (A, 2b9b69a): every send path refuses unsigned/unlocked orders (list every caller of each adapter and confirm none bypasses the check, including retries, re-routes, ops resubmit and crons); the canonical content hash is deterministic (field order, number formatting, null vs empty, unicode normalisation) and covers every clinical field the pharmacy receives; old orders handled as stated; https enforcement cannot be bypassed by uppercase scheme, whitespace, or a redirect from https to http at send time.
For each finding: file:line, the concrete failing scenario, severity, and the fix. Confirm by reading the path end to end or a throwaway test before reporting; drop anything you cannot confirm.
Do NOT push to those branches. Write docs/qa/review-2026-10-26-hipaa-fixes.md on a new branch `review-hipaa-fixes` from origin/main, push (normal push, no PR), summary in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
