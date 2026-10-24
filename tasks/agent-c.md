task-id: C-2026-10-24-07
status: ready
---
Thanks for C-2026-10-24-06 (proposals PR 3, 8f3f83a).

Next: patient protocol choice, PR 5 of 5: end to end. PR 2 (B, proposals-pr2-provider-propose, 06ccf28) and PR 3 (yours) are pushed; PR 4 (B, proposals-pr4-sign-choice) is in progress. All stack on PR 1.

Branch: `git fetch origin && git checkout -b proposals-pr5-e2e origin/proposals-pr3-patient-page && git merge origin/proposals-pr2-provider-propose`. Resolve any conflicts (they should only touch shared files such as database.types.ts, the proxy public-route list, retention lists); keep both sides. Run lint/tsc/Jest after the merge and record the result.

1. Write the Playwright spec(s) as the design's section 6 row 5 says: provider (as TEST_USERS provider) builds two options, marks one item optional, sends; the plan link is taken from the UI via "Copy link" (clipboard permission in the test) and the QR is shown; patient on a phone viewport opens /plan/<token>, wrong DOB once (dob_failed), right DOB, sees both options, unticks the optional item, chooses, confirms; provider sees "<name> chose <label> (n of m items)". Stop there until PR 4 is available.
2. When origin/proposals-pr4-sign-choice has B's final report commit, `git merge origin/proposals-pr4-sign-choice`, then extend the spec: provider signs the choice, unchosen DRAFTs are CANCELLED, the payment page loads (never enter a card; Stripe test mode in E2E), the plan link then shows "Approved, check your texts for the payment link" (or the copy-link variant when texting is off).
3. Add /plan/[token] states to e2e/accessibility.spec.ts. Add the spec to the chromium testMatch in playwright.config.ts.
4. No sleeps; service-role setup and cleanup; unique emails per run.
5. `npm run lint` (0 warnings), tsc, Jest, build. Push proposals-pr5-e2e (normal push, no PR). Report in the final commit body: merges done, conflicts, spec steps, local results (say if E2E cannot run locally), head SHA. If PR 4 has not appeared within 2 hours of finishing step 1, push what you have with a report saying so.

Do not touch the production database, Vercel, Stripe or secrets.
