task-id: B-2026-10-24-07
status: ready
---
Thanks for B-2026-10-24-06 (proposals PR 2, 06ccf28).

Next: patient protocol choice, PR 4 of 5: sign the choice. C is building PR 3 (patient page /plan/[token], choose/re-choose/decline) on proposals-pr3-patient-page, stacked on PR 1. Build PR 4 stacked on your PR 2.

Branch: `git fetch origin && git checkout -b proposals-pr4-sign-choice origin/proposals-pr2-provider-propose`.

Build as the design's section 1 step 4-5 and section 6 row 4 say (decisions approved by Sam 2026-10-24, in the design doc on PR 1):
- When a proposal is chosen (status chosen, chosen_option_id and proposal_choice_items set by PR 3's API), the provider sees it in the existing signature queue (WO-77): "<first name> chose <option label> (<n> of <m> items)", plus an in-app clinic notification. Read only the PR 1 tables; do not depend on PR 3 code (use the PR 1 lib and seed rows in tests).
- Signing: the provider opens the chosen lines and signs through the existing batch sign with exactly the chosen order ids (required items of the option + kept optional items). Batch sign runs every check again, allocates shipping, creates the payment group for 2+ or the solo checkout, sends the existing payment link (texting rules unchanged; when texting is off, the existing copy-link path for the payment link applies).
- Unchosen DRAFTs of the proposal go DRAFT -> CANCELLED, never signed. Proposal -> signed, signed_at, link dies (token revoked), 'signed' event.
- A check that fails at sign (license lapsed, price moved, compounding status) stops signing for the whole choice and tells the provider plainly; the proposal stays chosen.
- Repricing (WO-108) at signing as today; protocol_instances created or advanced at signing only (decision 8).
- Proposal expiry cron: sent or chosen-but-unsigned past expires_at -> expired, DRAFTs cancelled, idempotent, 'expired' event. Register it like the other crons.
- Red tests first: batch sign called with exactly the chosen ids; unchosen never get a signature hash; failed check stops signing and leaves the proposal chosen; group vs solo; expiry cron idempotent; role tests (provider signs; clinic admin may sign only as their own linked provider per existing signer rules; MA cannot).
- `npm run lint` (0 warnings), tsc, Jest (--maxWorkers=3), build. Commit and push proposals-pr4-sign-choice (normal push, no PR). Full report in the final commit body: files, tests, local results, head SHA, what PR 5 (end-to-end) needs.

Do not touch the production database, Vercel, Stripe or secrets.
