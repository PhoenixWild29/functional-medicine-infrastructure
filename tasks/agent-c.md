task-id: C-2026-10-24-05
status: ready
---
Thanks for C-2026-10-24-04 (React 19, clean). Two parts, two branches. Do part 1 first (small), push it, then part 2.

PART 1. Hide the face-sheet AI fill when no Anthropic key is configured.
Branch: `git fetch origin && git checkout -b face-sheet-hide-without-key origin/main`.
There is no ANTHROPIC_API_KEY in production and none is planned now, so the "Drop a face sheet" control in New Prescription > Select Patient > + New patient must not be shown, and POST /api/patients/face-sheet must refuse cleanly.
- Server decides: the feature is available only when FACE_SHEET_AI_ENABLED is not "false" AND ANTHROPIC_API_KEY is set (non-empty). Expose that as a boolean to the client from a server component or an existing config route; never send the key or its presence detail beyond the boolean.
- When unavailable: the control is not rendered (no disabled ghost UI); the route returns 404 or 503 with a plain message and makes no Anthropic call.
- When available: unchanged behaviour.
- Red tests first: unit tests for the availability rule, the form with and without the flag, the route without the key. The face-sheet E2E keeps its placeholder key in CI so it still runs.
- `npm run lint` (0 warnings), tsc, Jest, build. Commit and push face-sheet-hide-without-key (normal push, no PR). Report in that branch's final commit body.

PART 2. Patient protocol choice, PR 1 of 5: data model.
Sam approved D's design (docs/design/patient-protocol-choice.md on branch design-patient-protocol-choice, commit a269d26) with ALL 9 recommendations as written, plus one addition: the plan link must not depend on texting (there is no Twilio account). The provider's screen will offer "Copy link" and "Show QR code" for the plan link; the SMS (and the 48h reminder) are sent only when texting is enabled. Design that into the data model now (e.g. link delivery recorded as copied / qr / sms in the events table).

Branch: `git fetch origin && git checkout -b proposals-pr1-data-model origin/main`. First `git checkout origin/design-patient-protocol-choice -- docs/design/patient-protocol-choice.md`, then update that doc: section 7 becomes "Decisions (approved by Sam 2026-10-24)" with each answer, and add the copy-link / QR addition to sections 1, 2 and 6.

Build PR 1 exactly as the design's section 6 row 1 says:
- One migration (next free timestamp after 20261024000001, which is taken by the fax PHI column) + down file: treatment_proposals, treatment_proposal_options, orders.proposal_option_id (FK) and orders.proposal_required, proposal_choice_items, treatment_proposal_events (append-only trigger; event types include sent, link_copied, qr_shown, viewed, dob_failed, chosen, rechosen, declined, signed, expired, cancelled). RLS on every new table reading app_metadata (clinic users of that clinic read, ops_admin reads, service role writes). `SELECT apply_pharmacy_admin_scope();` last before COMMIT. New tables on the retention never-delete list. Down file refuses if any proposal rows exist.
- src/lib/proposals/: types, token (32 random bytes, SHA-256 stored, TTL 7 days, revoke on re-send, dies on sign; copy intake's token code and tests), and the status machine (draft, sent, chosen, signed, declined, expired, cancelled) with a transition table.
- database.types.ts updated.
- Tests first: migration static test (tables, RLS via app_metadata, scope call last, triggers, down), token tests, status-transition table tests, retention never-list test.
- Do NOT run the migration anywhere except the E2E/test setup. Put its full SQL in the report: Sam runs it on prod before the PR merges.
- `npm run lint` (0 warnings), tsc, Jest, build. Commit and push proposals-pr1-data-model (normal push, no PR). Full report in the final commit body: design doc changes, the migration SQL in full, tables and policies, tests, local results, head SHA.

Do not touch the production database, Vercel, Stripe or secrets.
