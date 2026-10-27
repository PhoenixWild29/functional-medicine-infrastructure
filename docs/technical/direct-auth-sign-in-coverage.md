# Failed sign-ins made directly against Supabase Auth (B12, finding A4)

Status: **not built**. Every real option needs a Supabase dashboard change, a migration, or a new secret. This note sets out the options so Sam can choose. It was written for C-2026-10-26-02.

## The gap

The failed sign-in monitor (`src/lib/auth/sign-in-monitor.ts`) only sees sign-ins that go through this app:

- `POST /api/sign-in` (the login page);
- `POST /api/mfa/verify` (the MFA challenge).

The Supabase anon key is public by design (`NEXT_PUBLIC_SUPABASE_ANON_KEY`). So a script can call Supabase Auth's password grant directly (`POST <SUPABASE_URL>/auth/v1/token?grant_type=password`), skipping the app.

Such attempts get:

- no `auth_failure` row;
- no Slack alert;
- no app throttle.

Only Supabase Auth's own rate limits apply (per IP, set in the Supabase dashboard under Auth, Rate Limits).

This does not weaken authentication itself: a wrong password is still refused, and MFA is still required for AAL2. What is missing is the **detection and alerting** half of B12 for that path.

## What was checked and does not work without a change

- **The SDK has no audit-log API.** `@supabase/auth-js` 2.100.0 (`GoTrueAdminApi`) exposes only these admin methods:
  - `createUser`, `deleteUser`, `generateLink`;
  - `getUserById`, `inviteUserByEmail`, `listUsers`;
  - `signOut`, `updateUserById`.

  None of them reads the auth audit log.
- **`auth.audit_log_entries` cannot be read through the Data API.** The `auth` schema is not exposed by PostgREST. Reading it needs a `SECURITY DEFINER` function in `public`, which is a migration.
- **The audit log may not hold failures anyway.** GoTrue writes audit entries for completed actions (login, logout, token refresh, signup and the like). In our understanding it does not write one for a refused password, but this has not been checked against a live project. If that holds, a poller of `audit_log_entries` would only see successes, so it could flag unusual successful sign-ins but not failures.

## Options

| # | Option | What it gives | Needs | Effort |
|---|---|---|---|---|
| 1 | **Supabase Auth hook: Password Verification Attempt.** Supabase calls our HTTPS endpoint (or a Postgres function) on every password check, with the user id and whether it was valid. The endpoint feeds `recordSignInFailure` and can refuse further attempts. | Full coverage of password failures, direct calls included. It can also enforce the throttle at the source. | A dashboard change (Auth, Hooks). The hook's signing secret goes in Vercel env. The plan must include this hook (check the project's plan). | S to M: one route that verifies the hook signature and maps the payload onto the existing monitor, plus tests. |
| 2 | **Log poller on Supabase's Auth logs.** A cron reads the project's Auth logs (failed `/token` calls with status 400) from the Management API logs endpoint every few minutes and feeds the same rules. | Failures on direct calls, minutes late, with no refusal. | A Supabase personal access token (or OAuth app) as a new secret, plus log retention on the plan. No migration. | M: parsing the log format, deduping across runs, and a cursor kept in `ops_alert_queue` or a small table. |
| 3 | **Audit-log poller via an RPC.** A `SECURITY DEFINER` function returns recent `auth.audit_log_entries` to the service role, and a cron feeds unusual successful sign-ins (new IP for an admin, many accounts from one IP) into alerts. | Successful sign-ins on direct calls, not failures (see above). | A migration (the function, service-role only). | S to M. |
| 4 | **Narrow the B12 claim.** In the evidence map and the procedure, say the app-level monitor covers sign-ins through the app. Direct calls to Supabase Auth are limited by Supabase's per-IP rate limits, which are configured in the dashboard and should be tightened. | Accurate evidence, no new coverage. | Sam reviews the Supabase Auth rate limits in the dashboard. | XS (docs). |

## Recommendation

**Option 1** is the only one that sees every failed password check, wherever it comes from, and can stop it at the source. Until it is in place, use **option 4**: state the scope in the B12 evidence and tighten Supabase's Auth rate limits.

Options 2 and 3 add moving parts (a new secret or a migration) for partial coverage.

## Unchanged notes (not part of this work)

- **A3: no audit secret means no account rule.** Without `PHI_ACCESS_LOG_HASH_SECRET` the account rule cannot count, because there is no email hash. The production health check on `phi-access-log-coverage` fails the deploy in that case.
- **A5: the deactivated answer.** The 403 `user_banned` answer may tell a caller that an email is a deactivated account. This predates B12, and whether Supabase checks the ban before the password is not confirmed. No change.
