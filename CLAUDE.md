# CompoundIQ — Claude Code Instructions

## PHASE WORKFLOW REMINDER

**At the start of every phase and every conversation involving phase work, read this file:**

`C:\Users\ssham\.claude\projects\c--Users-ssham-OneDrive-Functional-Medicine\memory\feedback_phase_build_workflow.md`

This file contains the complete 10-step workflow that MUST be followed for every phase. Do not begin any phase work without reading it first.

### Quick Reference (full details in the memory file above)

1. Build WO → set `in_progress`
2. Run first review agent
3. Fix ALL blocking + non-blocking issues
4. Repeat 1–3 for every WO in the phase
5. Set all WOs to `in_review` once all are built + reviewed + fixed
6. Hand user one cowork prompt for the entire phase
7. User gives prompt to cowork — **wait, do nothing**
8. User returns cowork review to me
9. Fix all cowork findings
10. Cowork passes phase → mark all WOs `completed`

**`completed` status is ONLY set at step 10. Never before.**

## QA Walkthrough Templates

**For browser-agent walkthroughs of the live POC (rounds R7, R8, R9, …), start from the reusable template at:**

`docs/qa-templates/walkthrough-prompt-base.md`

The template includes the verify-before-report guardrail that dropped R7's 28% false-positive rate to R8's 0%. Each new round drops in round-specific deltas via HTML-comment placeholders; the guardrail and severity scale stay verbatim. See [`docs/qa-templates/README.md`](docs/qa-templates/README.md) for the assembly workflow (round-N prompt + concat with the canonical demo doc).

Do NOT re-derive the prompt structure from scratch each round. The compounding payoff of the template is multi-hour savings per cycle in audit + triage work avoided. Filed under WO-95.

## Stack and lint (as of Oct 25, 2026)

- Next.js 16.4.3 (App Router), React 19.3.1, TypeScript strict. Node 20 in CI (`NODE_VERSION` in `.github/workflows/ci.yml`).
- `npm run lint` is `eslint . --max-warnings=0`: **any** warning fails CI. eslint-config-next 16.4.3 brings eslint-plugin-react-hooks 7.1 (React Compiler rules: `set-state-in-effect`, `purity`, `refs`, `immutability`, `preserve-manual-memoization`, `globals`).
- Fix a finding in code, not in `eslint.config.mjs`. The usual fixes:
  - adjust state while rendering, comparing to the previous value, instead of setting it in an effect;
  - a pure async reader whose result is applied in `.then(...)`;
  - a latest-ref updated in an effect;
  - `useSyncExternalStore` for "hydrated";
  - a query's `dataUpdatedAt` instead of `Date.now()` during render.
- A scoped `// eslint-disable-next-line <rule> -- <reason>` only where the fix would change behaviour. For example, restoring `sessionStorage` or `localStorage` after hydration, which a server render cannot do.
- `src/middleware.ts` is the request gate today: auth, roles, MFA, the checkout token, public routes and security headers. Next 16 renames it to `proxy.ts`. That rename is pending in #266. Until it merges, middleware.ts is current.

## Code rules that every change keeps

- Identity is `getUser()`, never `getSession()`. Role, clinic and pharmacy come from `app_metadata`, through `src/lib/auth/claims.ts` only. Never use `user_metadata` for them, because the user can write it.
- No PHI in logs, Slack or Sentry: ids and outcomes only. The `phi/no-phi-in-logs` lint rule enforces it.
- No em dashes in UI copy.
- Writes that a browser sends refuse cross-site requests through `src/lib/security/same-origin.ts`:
  - `refuseCrossSite` refuses Sec-Fetch-Site `same-site` and `cross-site`;
  - `same-origin`, `none` or no header passes.
  Each route keeps its own 403 wording. A few routes still carry an inline copy of the check; moving them onto the helper is on `security-followups-2`.
- A clinic that is not approved can look around, but nothing that orders, signs, charges or reaches a patient runs. Every such route calls `refuseUnlessApproved` (`src/lib/onboarding/approval-guard.ts`), which returns 403 `CLINIC_PENDING_REVIEW`.
- Uploads and file-carrying bodies are limited to 4 MB (`src/lib/uploads/limits.ts`; Vercel refuses bodies over about 4.5 MB). A file's type is read from its first bytes (`src/lib/uploads/sniff.ts`), never from the declared type.
- Stripe is live in production. Tests use mocks only; never enter a card or a password.
- Red tests first, in their own commit, then the fix.

## Production SQL and migrations

- Sam runs every SQL statement against production. Agents and CI never touch the production database.
- A migration is applied on prod **before** the PR that needs it merges. Its SQL goes in the PR or commit report.
- E2E shares one Supabase project, and every E2E run applies all of `supabase/migrations/` to it (`supabase db push` in the job). So a PR with a migration must merge before any other PR runs E2E: the other PR's run would otherwise run against a schema its own branch does not have. Merge migration PRs first, then rebase the others onto main.
- Numbering: the next free `YYYYMMDD0000NN` across main **and** every pushed branch. Check with `git ls-tree origin/<branch> supabase/migrations/` before you pick one. Every migration has a down file in `supabase/migrations/down/`.
- Never identify prod by `current_database()` (it says `postgres` everywhere) or by the migration ledger. Sam confirms the project by name in the Supabase header.
- Test a migration against all migrations on PGlite. Examples: `scripts/security/pglite-check/` (on `security-followups-2`) and `scripts/cleanup/pglite-check/` (on `test-data-cleanup-script`).
- Production test data (QA Test Clinic, QA Test Pharmacy, the Sunrise test patients, the Beta practices and logins) is removed by `scripts/cleanup/2026-10-24-test-data-cleanup.sql`. It is on the `test-data-cleanup-script` branch. Sam runs it once, after Lauren's review: dry run first (end with ROLLBACK), then with COMMIT.

## CI and E2E

- Lint, type-check, Jest and Build run on every push and PR to main.
- E2E (Playwright) runs:
  - for pull requests from this repository that change more than docs (top-level `*.md`, `docs/`, `reviews/`);
  - nightly on main at 07:30 UTC;
  - by hand (workflow_dispatch).
  It does not run on pushes to main.
- All E2E runs share one Supabase project. They are serialized (`concurrency: e2e-shared-supabase-project`, never cancelled). The job applies every migration to that project before testing; see the migration-order rule above.
- The Supabase CLI is pinned (`npx supabase@2.120.0`). 2.121.0 shipped no linux-x64 binary.

## The agent queue (orchestrator-tasks)

Work for the coding agents (A, B, C, D, ...) comes from `tasks/agent-<x>.md` on the `orchestrator-tasks` branch. Each file has a `task-id` and a `status`. An agent:

- fetches that branch and does a task whose status is `ready` and whose id is not in its done file. The agent never edits, pushes to or merges `orchestrator-tasks`;
- works on the branch the task names, cut from `origin/main` unless the task says otherwise;
- pushes that branch with a normal push. It never opens, updates or merges a PR; Sam does;
- puts the full report in the body of its final commit: what changed, why, tests, local results, head SHA, and any SQL Sam must run;
- never touches the production database, Vercel, Stripe, Documo or secrets, and never asks for approval mid-task. If a step needs any of those, or a decision from Sam, the agent pushes a commit whose message starts `BLOCKED:` and says exactly what is needed, records the task as done, and stops.

## Multi-factor sign-in (compliance C3)

- `REQUIRE_MFA` (read through `src/lib/env`) turns multi-factor sign-in on for provider, medical_assistant, clinic_admin and ops_admin. It is OFF unless exactly `true`, so demo accounts and E2E sign in with a password until the owner turns it on. `MFA_ENFORCED_EMAILS` enforces it for named accounts only (E2E uses `test-mfa-admin@compoundiq.test`).
- The rule lives in `src/lib/auth/mfa.ts`; `src/middleware.ts` applies it to every authenticated page (redirect to `/mfa/enroll` or `/mfa/challenge` with `redirectTo`) and API route (401 `MFA_ENROLLMENT_REQUIRED` / `MFA_REQUIRED`). Patient checkout, webhooks, crons, health and `/login` are not gated.
- The AAL comes from `supabase.auth.getClaims()`, which verifies the JWT. Never read it from an unverified session. `getUser()` stays the identity read.
- A user who enrolled voluntarily (Settings) is challenged on every new sign-in even with enforcement off.
- The login factor is Supabase Auth's TOTP factor (`auth.mfa_factors`). The EPCS signing secret (`providers.totp_secret_encrypted`, WO-86 / #171) is a separate factor on purpose: Supabase can only raise a session to AAL2 through its own factors, and EPCS needs its code checked by our server at the moment of signing. A provider may hold both in one authenticator app as two entries.
- HIPAA automatic logoff: `HipaaTimeout` is mounted once, by the clinic and ops layouts, with `IDLE_TIMEOUT_MINUTES` (default 15). Do not mount it in pages.

<!-- VERCEL BEST PRACTICES START -->
## Environment variables

- `PHARMACY_SUBMISSIONS_ENABLED`: kill switch for every pharmacy submission (API, portal, fax); OFF unless exactly `true`, and only the owner turns it on in production (see `src/lib/adapters/submission-switch.ts`).
- `DEMO_PAYOUTS_ON_APPROVAL` (`src/lib/clinics/demo-payouts.ts`): when ops approves a clinic with no Stripe Connect account, it gets a demo payout placeholder, `poc_placeholder_<clinic_id>` with status ACTIVE.
  - On unless exactly `false`.
  - A real Connect account id is never overwritten.
  - Pending (H1 in the Oct 24 security review): turning this off whenever a live Stripe key is set. It waits for Sam's decision and is on `demo-payouts-live-key-guard`.
- `ANTHROPIC_API_KEY` and `FACE_SHEET_AI_ENABLED` (`src/lib/face-sheet/config.ts`): the face-sheet fill on New patient renders only when the flag is not `false` **and** a key is set. Without a key the entry point is not shown at all, and the route answers 503.

## Best practices for developing on Vercel

These defaults are optimized for AI coding agents (and humans) working on apps that deploy to Vercel.

- Treat Vercel Functions as stateless + ephemeral (no durable RAM/FS, no background daemons), use Blob or marketplace integrations for preserving state
- Edge Functions (standalone) are deprecated; prefer Vercel Functions
- Don't start new projects on Vercel KV/Postgres (both discontinued); use Marketplace Redis/Postgres instead
- Store secrets in Vercel Env Variables; not in git or `NEXT_PUBLIC_*`
- Provision Marketplace native integrations with `vercel integration add` (CI/agent-friendly)
- Sync env + project settings with `vercel env pull` / `vercel pull` when you need local/offline parity
- Use `waitUntil` for post-response work; avoid the deprecated Function `context` parameter
- Set Function regions near your primary data source; avoid cross-region DB/service roundtrips
- Tune Fluid Compute knobs (e.g., `maxDuration`, memory/CPU) for long I/O-heavy calls (LLMs, APIs)
- Use Runtime Cache for fast **regional** caching + tag invalidation (don't treat it as global KV)
- Use Cron Jobs for schedules; cron runs in UTC and triggers your production URL via HTTP GET
- Use Vercel Blob for uploads/media; Use Edge Config for small, globally-read config
- If Enable Deployment Protection is enabled, use a bypass secret to directly access them
- Add OpenTelemetry via `@vercel/otel` on Node; don't expect OTEL support on the Edge runtime
- Enable Web Analytics + Speed Insights early
- Use AI Gateway for model routing, set AI_GATEWAY_API_KEY, using a model string (e.g. 'anthropic/claude-sonnet-4.6'), Gateway is already default in AI SDK
  needed. Always curl https://ai-gateway.vercel.sh/v1/models first; never trust model IDs from memory
- For durable agent loops or untrusted code: use Workflow (pause/resume/state) + Sandbox; use Vercel MCP for secure infra access
<!-- VERCEL BEST PRACTICES END -->
