# Contributing to CompoundIQ

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Production — protected, requires PR + passing CI |
| `develop` | Staging — merge target for feature branches |
| `feature/*` | Individual feature work |
| `fix/*` | Bug fixes |

**Never commit directly to `main`.** All changes require a pull request.

## Development Workflow

```bash
# 1. Create a feature branch from develop
git checkout develop
git pull origin develop
git checkout -b feature/wo-XX-short-description

# 2. Make changes, commit frequently
git add src/specific-file.ts
git commit -m "feat: add X for WO-XX"

# 3. Run all checks locally before pushing
npm run lint
npm run type-check
npm run test
npm run build

# 4. Push and open a PR to develop
git push -u origin feature/wo-XX-short-description
```

## PR Process

1. **All CI checks must pass** — lint, typecheck, test, build
2. **At least one approval** required before merge
3. **Squash merge** preferred for feature branches; rebase merge for fix branches
4. **Delete branch** after merge

### PR Description Template

```markdown
## What
[Brief description of what changed]

## Why
[WO number and link, or reason for change]

## Testing
- [ ] Unit tests added/updated
- [ ] E2E test covers the critical path (if applicable)
- [ ] Tested locally against staging Supabase

## Checklist
- [ ] `npm run lint` passes
- [ ] `npm run type-check` passes
- [ ] `npm run test` passes (80% coverage maintained)
- [ ] `npm run db:types` regenerated if schema changed
- [ ] Down migration created if up migration added
- [ ] No PHI in Sentry extra context, Slack messages, or PagerDuty details
```

## Code Review Checklist

**Security**
- [ ] No PHI in logs, Sentry, Slack, or PagerDuty payloads
- [ ] No hardcoded secrets or API keys
- [ ] Vault UUIDs used for pharmacy credentials (not plaintext)
- [ ] New API routes validate authentication and authorization
- [ ] Middleware `publicRoutes` list is correct — new public routes (cron, health) explicitly listed; protected routes not accidentally exposed
- [ ] Auth metadata (`app_role`, `clinic_id`) read from `user_metadata`, not `app_metadata`

**Database**
- [ ] New indexes use `CREATE INDEX CONCURRENTLY` with `-- supabase: no transaction` directive
- [ ] New migrations have a corresponding down migration in `supabase/migrations/down/`
- [ ] RLS policies applied when creating new tables
- [ ] `npm run db:types` output committed alongside migration

**Application**
- [ ] Server-side Supabase client (`service.ts`) used in API routes, never in client components
- [ ] Order status transitions go through `casTransition()` — not raw UPDATE
- [ ] Snapshot fields on `orders` not modified after `locked_at` is set
- [ ] Error handling doesn't expose internal details to client

## Commit Message Conventions

```
feat: add X feature for WO-XX
fix: correct Y behavior in Z
refactor: simplify adapter routing logic
test: add E2E for checkout flow
docs: update migration guide with CONCURRENTLY note
chore: regenerate database types
```

## Testing Requirements

| Test type | Required for |
|-----------|-------------|
| Unit tests (Jest) | `src/lib/` utilities, state machine logic, SLA calculator |
| E2E tests (Playwright) | New critical user flows (order creation, checkout, ops triage) |
| Manual testing | Webhook flows (use Stripe CLI / ngrok for local testing) |
| POC feature flag testing | Set `TWILIO_ENABLED=false` and `DOCUMO_ENABLED=false` in `.env.local` — verify SMS/fax suppress gracefully without crashing |

### Running Tests

```bash
# Unit tests
npm run test

# Unit tests with coverage (must stay above 80%)
npm run test:coverage

# E2E tests (requires local dev server or PLAYWRIGHT_BASE_URL)
npm run test:e2e

# Single E2E spec
npx playwright test e2e/clinic-app.spec.ts
```

## Environment Setup for Local Webhook Testing

```bash
# Stripe webhooks
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# Twilio webhooks (requires ngrok or similar)
ngrok http 3000
# Then set Twilio webhook URL in dashboard to: https://YOUR_NGROK_URL/api/webhooks/twilio/status
```

### Seeding POC data locally

```bash
# Seed test users, clinic, pharmacy, and catalog into your local Supabase project
npm run seed:poc
# Safe to run multiple times — fully idempotent (deterministic UUIDs)

# To reset POC seed data, delete the deterministic-UUID rows in Supabase dashboard
# then re-run npm run seed:poc
```

## Adding a New Migration

1. Create file: `supabase/migrations/YYYYMMDDHHMMSS_description.sql`
2. Create down file: `supabase/migrations/down/YYYYMMDDHHMMSS_down.sql`
3. Apply locally: `npm run db:migrate`
4. Regenerate types: `npm run db:types`
5. Commit both files together

See [docs/migration-guide.md](docs/migration-guide.md) for full migration guide.
