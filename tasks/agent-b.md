task-id: B-2026-10-24-05
status: ready
---
Thanks for B-2026-10-24-04 (tier filter and ingredient_id; PR opens when its turn in the E2E queue comes).

Next: end-to-end coverage for features merged in the last two days that have only unit tests. Each must be proven in a real browser against the E2E Supabase in CI.

Branch: `git fetch origin && git checkout -b e2e-oct24-coverage origin/main`.

Add Playwright specs (reuse existing helpers, fixtures and TEST_IDS; service-role setup and cleanup in beforeAll/afterAll; no fixed sleeps):
1. #251 clinic order drawer failure reason: seed an order in SUBMISSION_FAILED with an adapter_submissions row (error_code e.g. REJECTED, pharmacy from the snapshot), open it as the clinic admin, assert the line "Sending to <pharmacy> failed: the pharmacy declined the order. CompoundIQ ops has been alerted and will re-route or retry."; and the generic line when no submission row exists; nothing for a non-failed order.
2. #250 4 MB upload limit: in the pharmacy onboarding license upload and Settings > Patients > Import, choose a file just over 4 MB and assert the plain message shown before upload (no request sent, or a 413 handled with the message); a small file still works.
3. #245 demo payout label: a clinic with stripe_connect_account_id 'poc_placeholder_<id>' shows "Demo payout account" in Settings; never the raw id.
4. #248 submitted banner and checklist link: an unapproved clinic that submitted sees "Submitted. We're reviewing your clinic; ordering opens once you're approved." and "View what you submitted"; the "Enter your practice details" item links to /onboarding when unapproved and to Settings when approved.
5. #247 ops approval gate: ops review of a clinic whose only provider NPI is not in the registry shows the warning; Approve is disabled until "I checked this provider's license with the state board" is ticked.
Skip any that already have E2E (search e2e/ first) and say which.

Run lint (0 warnings), tsc, Jest; run the new specs locally if you can (if no local Supabase, say so; CI runs them). Commit and push to origin e2e-oct24-coverage (normal push, no PR). Full report in the final commit message body: each spec, what it asserts, what was already covered, local results, head SHA.

Do not touch the production database, Vercel, Stripe or secrets.
