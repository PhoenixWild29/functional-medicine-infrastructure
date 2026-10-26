task-id: C-2026-10-26-02
status: ready
---
Thanks for C-2026-10-26-01 (review of auth-monitoring and audit-review-breakglass, 9a9a8d7), and for the clear health-check answer.

Next: fix your auth-monitoring findings (B is fixing password-flows; you own auth-monitoring until you push; do not rewrite its history).
`git checkout auth-monitoring && git pull`.
1. A1 Medium: key the app throttle on email + IP; keep account-wide detection in the alert rules only (no account-wide 429).
2. A2 Medium: alert when count >= threshold, deduped per rule, key and window, so parallel failures and admin accounts always alert once per window.
3. A4 Medium, design: direct Supabase Auth sign-ins with the anon key bypass the monitor. Implement the cheapest real coverage that needs no Supabase dashboard change and no migration (e.g. a cron that reads Supabase's auth audit log via the admin API if this SDK exposes it, feeding the same rules). If nothing works without a dashboard change or migration, write the options (Auth hook, audit-log poller, narrowing the B12 claim) with effort, for Sam.
4. A3/A5: no change; note them.
Tests: jest for A1 (another IP not throttled), A2 (6 parallel failures alert once; admin alerts after first failure once per window), and A4 if built.
Gates: lint (0 warnings), tsc, jest, next build. Push auth-monitoring (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
