task-id: B-2026-10-24-06
status: ready
---
Thanks for B-2026-10-24-05 (E2E coverage; PR in turn).

Next: patient protocol choice, PR 2 of 5: provider propose. Sam approved D's design (docs/design/patient-protocol-choice.md) with all 9 recommendations as written, plus: the plan link must not depend on texting (no Twilio account). C is building PR 1 (data model, migration, src/lib/proposals token and status machine) on branch proposals-pr1-data-model and is updating the design doc with the decisions.

Step 0: wait until origin/proposals-pr1-data-model exists and its head commit message is C's final report (it contains the migration SQL). Check every 5 minutes (`git fetch origin`). Do not start PR 2 code before then; while waiting, read the design doc, src/lib/orders/batch-sign.ts (checkBatch), batch-review-form.tsx, the dashboard tabs and the intake link code. If it has not appeared within 90 minutes, push a commit "BLOCKED: PR 1 not pushed" on a branch proposals-pr2-provider-propose and stop.

Branch: `git checkout -b proposals-pr2-provider-propose origin/proposals-pr1-data-model` (stacked on PR 1; it will be rebased onto main after PR 1 merges).

Build PR 2 as the design's section 6 row 2 says, plus the copy-link addition:
- Split checkBatch into a read-only canSign(lines) used by both propose and sign; sign behaviour unchanged (existing batch-sign tests must stay green untouched).
- Review: group lines into options (Option A, B...) with a patient-facing label (max 80), each loaded protocol its own option by default, Required star per line (on by default).
- "Send to patient for choice": POST /api/proposals creates the proposal + options, tags the DRAFTs (proposal_option_id, proposal_required), writes a token (PR 1 lib), records a 'sent' event. Provider or clinic admin on the provider's behalf may send; MA may prepare but gets 403 on send. Same auth stack as other clinic routes (getUser, app_metadata claims, approval guard, same-origin).
- After sending, the provider sees the plan link with "Copy link" and "Show QR code" (QR as one SVG path, like D's sign-up link QR). Copy and QR record link_copied / qr_shown events. The SMS goes out only when texting is enabled (TWILIO_ENABLED and the patient's opt-in), using a new name-free template under the same opt-in-gate test pattern; when texting is off, no send is attempted and the UI says "Texting is not set up, copy the link or show the QR code".
- Dashboard: a Proposed tab ("Awaiting patient choice"); proposed DRAFTs hidden from Drafts. Edit, cancel (DRAFT -> CANCELLED, proposal cancelled, link revoked) and re-send (revokes the previous link).
- No patient page yet (PR 3).
- Red tests first: table-driven tests that every C4/C5/C6/C8/price refusal blocks propose with the same message as sign; controlled item never proposable; role tests; Proposed vs Drafts; cancel and re-send revoke; copy/QR events; no SMS when texting is off; jest-axe on the new UI.
- `npm run lint` (0 warnings), tsc, Jest (--maxWorkers=3), build. Commit and push proposals-pr2-provider-propose (normal push, no PR). Full report in the final commit body: files, routes, tests, local results, head SHA, and anything PR 3 needs from PR 2.

Do not touch the production database, Vercel, Stripe or secrets.
