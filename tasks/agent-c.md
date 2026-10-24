task-id: C-2026-10-24-06
status: ready
---
Thanks for C-2026-10-24-05 (face-sheet hide merged as #260; proposals PR 1 pushed) and the React 19 test fix.

Next: patient protocol choice, PR 3 of 5: the patient page. B is building PR 2 (provider propose, Copy link / QR, Proposed tab) on proposals-pr2-provider-propose, stacked on your PR 1. Build PR 3 stacked on PR 1 too, in parallel; touch only the patient side so the two merge cleanly. Read the design doc on your PR 1 branch (with Sam's decisions).

Note on migrations: final order is 20261024000001 rls_hardening (D, security), 20261024000002 your treatment_proposals, 20261024000003 A's fax column. Keep yours at 000002. If PR 3 needs schema changes, put them in your PR 1 migration (amend PR 1 and say so), not a new file.

Branch: `git fetch origin && git checkout -b proposals-pr3-patient-page origin/proposals-pr1-data-model`.

Build as the design's section 2 and section 6 row 3 say:
- /plan/[token] page and GET/POST /api/plan/[token]: resolve the token (hash lookup, TTL, revoked, signed states), DOB verify with 5-failure lockout (dob_failed events, locked_at), then show options with items (medication name, form/strength, plain-language sig, quantity/days, price), required items locked on with "Included: your provider marked this as essential", optional items as checkboxes ticked by default, running total (subtotal + shipping per pharmacy via computeBundleShipping) with "estimate: final price confirmed when your provider approves".
- Choose (confirm step), re-choose until signed, and decline ("None of these / I want to talk to my clinic"). Server enforces: required items cannot be dropped; a choice is limited to one option's items; nothing after signed/expired/cancelled.
- Before DOB: only "Your provider has a plan ready" and the clinic logo; no clinic name in metadata, no medication anywhere.
- Proxy/middleware public route for /plan/* and /api/plan/* (service role scoped to the proposal's clinic, as intake does). Rate limit the API per IP and per token.
- Events: viewed (first time), dob_failed, chosen, rechosen, declined.
- No SMS sending here (PR 2 owns sending); no signing (PR 4).
- Red tests first: token states, DOB lockout, nothing shown before DOB, server-side required-item and one-option rules, decline, every page state with jest-axe, phone viewport layout test where possible. No medication name in any response before DOB.
- `npm run lint` (0 warnings), tsc, Jest, build. Commit and push proposals-pr3-patient-page (normal push, no PR). Full report in the final commit body: routes, states, tests, local results, head SHA, anything PR 4 needs.

Do not touch the production database, Vercel, Stripe or secrets.
