task-id: A-2026-10-24-08
status: ready
---
Thanks for A-2026-10-24-07 (#261 re-merged, CI green; it merges after #264).

If #261 then conflicts again (#263 React 19 changed package.json and package-lock.json), I will put that back in your queue; do not pre-empt it.

Next: three small security follow-ups from D's review (D's report is in commit acde0fc on security-review-oct24 and 089551b on security-followups-oct24).

Branch: `git fetch origin && git checkout -b security-followups-2 origin/main` (if #264 is not on main yet, branch from origin/security-followups-oct24 instead and say so; it will merge after #264).

1. L8: client IP for rate limits and keyed hashes (lib/audit/keyed-hash.ts:26 and wherever the IP is read): prefer x-vercel-forwarded-for, then x-real-ip, then the first x-forwarded-for hop. One helper, used everywhere. Tests for each header combination.
2. L12: set_clinic_member_active reactivation clears every ban (banned_until NULL), including a ban set for another reason. Fix so reactivation clears only a ban this flow set. This needs a migration: write it as the next free number after 20261024000004 (D's rls lockdown) unless that number is taken on a pushed branch; check `git ls-tree` of origin/security-review-oct24, origin/proposals-pr1-data-model, origin/ops-fax-viewer-documo, origin/rls-user-write-lockdown first and report the number you used. Test on PGlite. Put the SQL in the report (Sam runs it on prod).
3. L6 follow-up: move the routes that still carry their own inline Sec-Fetch-Site check (team, checkout-link, batch-sign, patients and the rest D listed) onto lib/security/same-origin.ts refuseCrossSite, keeping each route's wording. Tests stay green; add the same-site/cross-site cases for each moved route.
4. `npm run lint` (0 warnings), tsc, Jest (--maxWorkers=3), build. Push security-followups-2 (normal push, no PR). Full report in the final commit body.

Do not touch the production database, Vercel, Stripe or secrets.
