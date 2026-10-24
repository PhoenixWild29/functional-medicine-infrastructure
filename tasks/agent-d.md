task-id: D-2026-10-24-05
status: ready
---
Thanks for D-2026-10-24-04 (CI throughput; PR goes in right after the current one).

Next: security review of everything added Oct 14 to 24 (#237 to #257 plus open branches you can see), before real clinics.

Branch: `git fetch origin && git checkout -b security-review-oct24 origin/main`.

For every new or changed route handler, server action and RPC/SECURITY DEFINER function since Oct 14 (self-serve sign-up, team invites/deactivate, protocol create, sign-up link /join, face-sheet AI, failure-reason, uploads limits, ops approval, demo payouts, fax PDF if on main), check and table:
- auth: getUser (never getSession), role and clinic from app_metadata claims, deactivated users refused, approval guard where writes need it;
- tenant isolation: clinic_id from claims, RLS or explicit filter, no IDs trusted from the body;
- same-origin / CSRF stance consistent with the rest of the app;
- rate limits on anything public or expensive (sign-up, /join, face-sheet, fax view);
- input validation (zod or equivalent), size limits, magic-byte checks on uploads;
- PHI: nothing in logs, Slack, Sentry, Stripe; phi_access_log rows where PHI is viewed;
- SECURITY DEFINER functions: fixed search_path, EXECUTE revoked from anon/authenticated where meant for service_role;
- error bodies: no stack traces or raw DB messages.
Also run `npm audit --omit=dev` and report anything high or critical with a fix path.

Fix real findings with red tests first (small, behaviour-preserving changes). Anything that needs a migration: write it, test it in the E2E/test setup only, and put the SQL in the report (Sam runs prod SQL). Anything risky or debatable: report with file:line and a recommendation, do not change.

`npm run lint` (0 warnings), tsc, Jest, build. Commit and push to origin security-review-oct24 (normal push, no PR). Full report in the final commit message body: the route table with pass/fail per check, findings by severity, fixes, migrations with SQL, npm audit summary, head SHA.

Do not touch the production database, Vercel, Stripe or secrets.
