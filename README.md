# CompoundIQ

[![CI](https://github.com/PhoenixWild29/functional-medicine-infrastructure/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/PhoenixWild29/functional-medicine-infrastructure/actions/workflows/ci.yml)
[![License: Proprietary](https://img.shields.io/badge/license-proprietary-red.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript)](https://www.typescriptlang.org)

Compounding pharmacy order management platform connecting clinics and pharmacies with automated routing, SLA monitoring, and HIPAA-compliant workflows.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, testing, and PR conventions.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.4 (App Router, TypeScript strict), React 19 |
| Database | Supabase (PostgreSQL 15, RLS, Auth, Vault, Storage) |
| Payments | Stripe Connect Express destination charges. The application fee is pharmacy wholesale plus shipping only; the clinic receives the rest. No percentage platform fee: CompoundIQ's flat monthly fee is billed separately under a signed order form. |
| SMS | Twilio Programmable Messaging |
| Fax | Documo mFax API |
| AI (optional) | Anthropic API for the face-sheet fill (hidden without a key) |
| Monitoring | Sentry (PHI-scrubbed) |
| Alerting | Slack + PagerDuty |
| Hosting | Vercel |
| CI | GitHub Actions: lint (0 warnings allowed), type-check, Jest and build on every PR and push to main; Playwright E2E on PRs that change code, nightly, and by hand |
| CD | Vercel native GitHub integration (deploy.yml disabled) |

## Prerequisites

- **Node.js** 20 (what CI uses)
- **npm** (`npm ci` installs exactly the lockfile; CI does the same)
- **Supabase CLI**: run through `npx supabase@2.120.0`, which is the pinned version (`npm run db:migrate` uses it). 2.121.0 shipped no linux-x64 binary.
- **Vercel CLI** (optional for local preview) — `npm install -g vercel`
- **Stripe CLI** (for local webhook forwarding) — [Install guide](https://stripe.com/docs/stripe-cli)

## Local Setup

```bash
# 1. Clone the repository
git clone https://github.com/<your-org>/compoundiq.git  # replace <your-org> with your GitHub org
cd compoundiq

# 2. Install dependencies
npm install

# 3. Copy environment variables
cp .env.example .env.local
# Edit .env.local with your credentials (see Environment Variables below)

# 4. Link Supabase project
supabase link --project-ref your-project-ref

# 5. Apply all migrations
npm run db:migrate

# 5a. Configure Supabase Auth
# In Supabase dashboard → Authentication → Providers → Email:
# Disable "Confirm email" for local/POC development (simplifies seeding)
# Production: leave email confirmation enabled

# 6. Regenerate TypeScript types
npm run db:types

# 7. Start development server
npm run dev
```

The app runs at [http://localhost:3000](http://localhost:3000).

## Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint, `--max-warnings=0`: any warning fails, locally and in CI |
| `npm run type-check` | TypeScript strict check |
| `npm run test` | Jest unit tests |
| `npm run test:coverage` | Jest with 80% coverage threshold |
| `npm run test:e2e` | Playwright E2E tests |
| `npm run format:check` | Prettier format check |
| `npm run format:write` | Prettier auto-format |
| `npm run db:migrate` | Apply migrations to the **linked** Supabase project (`npx supabase@2.120.0 db push`). Never production: Sam applies production migrations (see DEPLOYMENT.md) |
| `npm run db:types` | Regenerate database.types.ts |
| `npm run seed:poc` | Seed POC demo data (clinic, users, pharmacies, catalog) |
| `npm run seed:catalog` | Seed the V3 hierarchical catalog (166 products) |
| `npm run seed:pharmacy-invite` | Create a demo pharmacy invite (pharmacy onboarding) |

## Environment Variables

Copy `.env.example` and fill in the values. All variables marked **required** must be set before `npm run dev` or `npm run build`.

### Supabase

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key (server-side only) |

### Stripe

| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_SECRET_KEY` | ✅ | Stripe secret key (server-side only) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ✅ | Stripe publishable key |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Stripe webhook endpoint secret |

### Twilio

| Variable | Required | Description |
|----------|----------|-------------|
| `TWILIO_ACCOUNT_SID` | ✅ (placeholder if disabled) | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | ✅ (placeholder if disabled) | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | ✅ (placeholder if disabled) | Twilio sending phone number (E.164) |
| `TWILIO_WEBHOOK_SECRET` | ✅ (placeholder if disabled) | Twilio webhook signature secret |
| `TWILIO_ENABLED` | ✅ | Set `false` to suppress SMS in POC environments (logs metadata only) |

### Documo

| Variable | Required | Description |
|----------|----------|-------------|
| `DOCUMO_API_KEY` | ✅ (placeholder if disabled) | Documo mFax API key |
| `DOCUMO_ACCOUNT_ID` | ✅ (placeholder if disabled) | Documo account ID |
| `DOCUMO_OUTBOUND_FAX_NUMBER` | ✅ (placeholder if disabled) | Documo outbound fax number |
| `DOCUMO_WEBHOOK_SECRET` | ✅ (placeholder if disabled) | Documo webhook HMAC secret |
| `DOCUMO_ENABLED` | ✅ | Set `false` to suppress fax in POC environments (synthetic fax ID, full flow still runs) |

### Alerting

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_WEBHOOK_URL` | ✅ | Slack incoming webhook URL |
| `PAGERDUTY_ROUTING_KEY` | ✅ | PagerDuty Events API v2 routing key |

### Sentry

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SENTRY_DSN` | ✅ | Sentry project DSN |
| `SENTRY_AUTH_TOKEN` | CI only | Sentry auth token for source map upload |
| `SENTRY_ORG` | CI only | Sentry organization slug |
| `SENTRY_PROJECT` | CI only | Sentry project slug |

### Application

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | ✅ | 256-bit secret for checkout token signing |
| `APP_BASE_URL` | ✅ | Full app URL — used for SMS/webhook callback URLs (e.g. `https://app.compoundiq.com`) |
| `CRON_SECRET` | ✅ | Bearer token for cron job authentication |
| `CHECKOUT_TOKEN_EXPIRY` | ✅ | Checkout token expiry in seconds (default: `259200` = 72h) |
| `STRIPE_CONNECT_TEST_ACCOUNT_ID` | POC only | Stripe Connect Express account ID for the POC test clinic |
| `PHARMACY_SUBMISSIONS_ENABLED` | — | Kill switch for every pharmacy submission (API, portal, fax). Off unless exactly `true`; only the owner turns it on in production |
| `DEMO_PAYOUTS_ON_APPROVAL` | — | Ops approval gives a clinic without Stripe Connect a demo payout placeholder, so ordering opens. On unless exactly `false` (see CLAUDE.md) |
| `PHASE_C_GROUPS_ENABLED` | — | Multi-prescription payment groups; `true` in production |
| `REQUIRE_MFA` / `MFA_ENFORCED_EMAILS` | — | Multi-factor sign-in for staff roles: on only when exactly `true`, or for the listed accounts |
| `IDLE_TIMEOUT_MINUTES` | — | HIPAA automatic logoff (default 15) |
| `PHI_ACCESS_LOG_HASH_SECRET` | ✅ in production | Key for the HMAC of email, IP and user agent in `phi_access_log` and `epcs_audit_log`. Without it those hashes are left empty |

### AI (optional)

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | — | The face-sheet fill on New patient. Without it the feature is not shown at all |
| `ANTHROPIC_MODEL` | — | Model for the face-sheet read (default in `src/lib/face-sheet/extract.ts`) |
| `FACE_SHEET_AI_ENABLED` | — | `false` turns the face-sheet fill off even with a key |

## Project Structure

```
src/
  app/
    (clinic-app)/       Clinic staff UI (auth-gated: clinic roles)
    (ops-dashboard)/    Ops team UI (auth-gated: ops_admin role)
    (patient-checkout)/ Patient checkout (token-gated, no login)
    pharmacy/           Pharmacy onboarding portal (pharmacy_admin)
    get-started/        Self sign-up (clinic, solo provider, pharmacy)
    onboard/            Accept a clinic or pharmacy invite
    join/ intake/       Patient sign-up link (and QR code), patient intake link (token-gated)
    plan/               Patient chooses a treatment plan from a proposal (token-gated, date of birth first)
    api/                Webhook handlers, cron jobs, API routes
    login/              Email + password login (public)
    unauthorized/       Access denied page with sign-out (public)
    auth/callback/      Supabase PKCE email verification callback (public)
    page.tsx            Root redirect — session → role → destination
  lib/
    adapters/           Pharmacy tier 1/2/3/4 adapter implementations
    auth/               Claims (app_metadata only), MFA, landing routes, checkout token (JWT)
    onboarding/         Clinic onboarding, the approval guard
    signup/             Self sign-up
    team/               Settings > Team (invites, deactivate)
    security/           Same-origin writes, rate limits
    uploads/            The 4 MB limit, file-type sniffing
    face-sheet/         Face-sheet fill (Anthropic)
    audit/              PHI access log, keyed hashes
    coaching/           Setup checklist, first-prescription tips
    proposals/          Patient protocol choice (propose, plan link, choose, sign the choice, expiry)
    orders/             Order state machine, casTransition
    sla/                SLA calculator, creator, resolver
    slack/              Slack alert client and router
    pagerduty/          PagerDuty Events API v2 client
    sentry/             PHI scrubber, user context utilities
    stripe/             Stripe client
    twilio/             Twilio client
    documo/             Documo fax client
    supabase/           Supabase client factories
  types/
    database.types.ts   Auto-generated Supabase TypeScript types
e2e/                    Playwright E2E test suites
supabase/
  migrations/           Timestamped SQL migration files
  migrations/down/      Down (rollback) migration files
docs/                   Technical documentation
```

## POC Setup

To run a proof-of-concept demo environment:

1. **Infrastructure** — Follow `docs/technical/poc-setup.md` for Supabase, Vercel, Stripe, and optional Twilio/Documo setup
2. **Seed data** — Run `npm run seed:poc` to create test users, a demo clinic, pharmacy, and catalog
3. **Validate** — Walk the happy path documented in `docs/qa-reports/poc-validation-log.md`

**Test credentials (after seeding):**

| Role | Email | Password |
|------|-------|----------|
| `ops_admin` | `ops@compoundiq-poc.com` | `POCAdmin2026!` |
| `clinic_admin` | `admin@sunrise-clinic.com` | `POCClinic2026!` |
| `provider` | `dr.chen@sunrise-clinic.com` | `POCProvider2026!` |
| `medical_assistant` | `ma@sunrise-clinic.com` | `POCMA2026!` |

See [docs/technical/poc-setup.md](docs/technical/poc-setup.md) for full infrastructure runbook.

## Architecture

CompoundIQ runs a dual product catalog: the legacy flat `catalog` table and a V3 hierarchical catalog (`ingredients → salt_forms → formulations → formulation_ingredients → pharmacy_formulations`). Seed the V3 catalog (166 products) with `npm run seed:catalog`.

See [docs/technical/erd.md](docs/technical/erd.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md).

## HIPAA Compliance

This application handles Protected Health Information (PHI). Key principles:

- **All PHI stays in Supabase.** Never log or send PHI to Stripe, Sentry, Slack, PagerDuty, or Vercel Logs.
- **Sentry PHI scrubbing is mandatory.** The `phiBeforeSend` hook runs on every event.
- **Vault for credentials.** All pharmacy API keys and portal passwords are stored in Supabase Vault — never in environment variables or plaintext SQL.
- **RLS enforces tenant isolation.** Each clinic can only access its own data.
- **Soft deletes only.** No hard DELETE is permitted on patient, order, or provider data. A signed order cannot be deleted at all (a trigger refuses it).
- **Append-only audit.** `phi_access_log`, `epcs_audit_log`, the onboarding and agreement event tables, `ledger_entries` and `payable_events` refuse UPDATE and DELETE by trigger.
- **Production SQL is Sam's.** No developer, agent or CI job connects to the production database (see DEPLOYMENT.md).
