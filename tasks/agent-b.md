task-id: B-2026-10-25-12
status: ready
---
Thanks for B-2026-10-25-11 (keyboard and screen-reader pass, 8af5877).

Next: two gaps from C's HIPAA evidence map (origin/review-high-risk, docs/compliance/technical-safeguards-evidence-2026-10-25.md, B12 and B9). Read those sections first.

Branch: `git fetch origin && git checkout -b auth-monitoring origin/bundle-features`.
1. B12: failed-login monitoring and alerting.
   - Record each failed sign-in and MFA challenge failure (email hashed with the existing hash secret approach, IP, user agent, time, reason). Use an existing table if one fits (audit/security event, rate-limit hits); if none fits, do NOT migrate, report the design.
   - Alert (Slack/Sentry, no PHI, no raw email) on: 5+ failures for one account in 15 minutes; 20+ failures from one IP in 15 minutes; any failed sign-in on an ops_admin or pharmacy_admin account.
   - Lock-out: use Supabase's own protections where they exist; add a short app-level delay after repeated failures through the existing rate limiter. No permanent lock-out (support burden).
   - Ops page or section listing recent failed-login alerts, if cheap; otherwise the alerts suffice.
2. B9: shared POC account passwords appear in source and docs.
   - Find every place a password, or anything that looks like one, appears in tracked files (src, scripts, docs, README, e2e, seed files, .env.example). Do NOT print any value in your report or commit body; refer to file:line only.
   - Replace with env var names (e.g. POC_OPS_PASSWORD) read at seed/test time, with a clear error if missing. Docs say "set in your local env" without values.
   - Do not rotate or change any real password and do not touch Vercel or Supabase settings: list in the report which accounts Sam must rotate because their passwords were in git history.
Tests: jest for the failure recording, thresholds and alert payload (no PHI, no raw email), and that seed/test helpers read from env.
No database migrations.
Gates: lint (0 warnings), tsc, jest, next build. Push auth-monitoring (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
