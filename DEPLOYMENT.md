# Deployment Runbook

## Deployment Architecture

```
main branch push → Vercel native GitHub integration → build + deploy → Health check
```

Production deploys automatically through **Vercel's native GitHub integration** on every push to `main`. The custom `.github/workflows/deploy.yml` GitHub Actions pipeline is **disabled** and does not run. GitHub Actions still runs CI (lint, type-check, test, build) on pull requests, but deployment is handled entirely by Vercel. Database migrations are applied **manually** with `supabase db push` — they are not automated by CI (see [Database Migration Execution](#database-migration-execution)).

## Pre-Deployment Checklist

Before merging to `main` (production) or `develop` (staging):

- [ ] All CI checks pass on the PR (lint, typecheck, test, build)
- [ ] If schema changed: down migration exists and `database.types.ts` is up to date
- [ ] Environment variables updated in Vercel dashboard if new vars added
- [ ] Stripe webhooks still routing correctly (no endpoint URL changes)
- [ ] No breaking changes to the checkout token JWT schema
- [ ] If middleware `publicRoutes` changed: verify `/api/cron`, `/api/health`, `/api/webhooks`, `/auth/callback` are still in the list

## Standard Deployment

**Automatic** — push to `main`:

> **Route authentication model:** `/api/cron/*` and `/api/health` are public (no Supabase session required). Cron jobs authenticate via `CRON_SECRET` bearer token inside the route handler. `/api/webhooks/*` and `/auth/callback` are also public. All other routes require a valid Supabase session cookie.

1. Commits land on `main` (typically via a merged PR that has passed GitHub Actions CI)
2. Vercel's native GitHub integration detects the push and starts a build
3. Vercel builds and deploys the new version to production
4. Verify: `GET https://functional-medicine-infrastructure.vercel.app/api/health` returns `{"ok":true,...}`

Migrations are **not** run by this flow. If the release includes schema changes, apply them manually with `supabase db push` **before** the deploy goes live (see [Database Migration Execution](#database-migration-execution)).

## Environment Variable Updates

When adding new environment variables:

1. Add to Vercel project settings (Settings → Environment Variables)
2. Add to `.env.example` with a placeholder value and description
3. Add to the README.md environment variables table
4. For CI/CD variables: add as GitHub Actions repository secrets

## POC vs. Production Deployment

For a proof-of-concept deployment, two feature flags reduce dependency on external SMS/fax services:

| Env Var | POC Value | Production Value | Effect |
|---------|-----------|-----------------|--------|
| `TWILIO_ENABLED` | `false` | `true` | Suppresses live SMS; logs metadata to console only |
| `DOCUMO_ENABLED` | `false` | `true` | Suppresses live fax; synthetic fax ID used; full order flow still runs |

> ⚠️ Even when set to `false`, all Twilio and Documo env vars must be set to placeholder values — `requireEnv()` will throw at startup if they are absent.

For the full POC infrastructure setup see [docs/poc-setup.md](docs/poc-setup.md).

## Post-Deployment Verification

After a production deployment:

```bash
# 1. Health check — expected response: {"ok":true,"timestamp":"<ISO>","version":"<sha>"}
curl https://functional-medicine-infrastructure.vercel.app/api/health
# version field reflects the deployed 7-character git commit SHA

# 2. Verify Stripe webhook delivery (Stripe dashboard → Webhooks → recent events)

# 3. Check Sentry for new errors (filter by latest release)

# 4. Confirm no ops alerts fired in Slack #ops-alerts
```

## Rollback Procedure

### Option A — Automated (Preferred)

1. Go to **GitHub Actions → Rollback** workflow → **Run workflow**
2. Select environment: `production` or `staging`
3. Paste the Vercel deployment ID to restore (from Vercel dashboard → Deployments)
4. Set `rollback_migrations: true` if schema changes need reversing
5. Provide `migration_prefix` (14 digits, e.g. `20260319000012`) if rolling back migrations
6. Click **Run workflow** — requires production environment approval

### Option B — Manual

```bash
# 1. Roll back application (Vercel)
npx vercel promote <previous-deployment-id> --scope=your-team

# 2. Roll back database (if needed)
# Find the down migration file
ls supabase/migrations/down/

# Execute the down migration
supabase db execute \
  --db-url "$DATABASE_URL" \
  --file supabase/migrations/down/20260319000012_down.sql

# 3. Verify health
curl https://functional-medicine-infrastructure.vercel.app/api/health
```

> **Important:** Review [docs/migration-guide.md](docs/migration-guide.md) rollback caveats before running down migrations. Some migrations have ordering dependencies or permanent enum additions.

## Database Migration Execution

### Adding a new migration to production

Migrations are **not** run by CI or the Vercel deploy. Applying them manually with `supabase db push` is the standard path for every schema change:

```bash
# 1. Create migration file
supabase/migrations/YYYYMMDDHHMMSS_description.sql

# 2. Apply to production (requires DATABASE_URL)
supabase link --project-ref your-project-ref
supabase db push

# 3. Regenerate types and commit
npm run db:types
git add src/types/database.types.ts supabase/migrations/
git commit -m "chore: add migration + regen types"
git push origin main
```

Apply the migration **before** the code that depends on it reaches production, so the deployed build never runs against a stale schema.

### Verifying migration status

```bash
supabase db remote changes  # Shows unapplied migrations
supabase migration list     # Lists applied migration history
```

## Troubleshooting Deployments

**Build fails with "database.types.ts is stale"**
```bash
npm run db:types
git add src/types/database.types.ts
git commit -m "chore: regen types"
git push
```

**Migration fails (`supabase db push`)**
- Check Supabase project is accessible (verify `SUPABASE_ACCESS_TOKEN` and project ref)
- Check for migration ordering issues (new migration references table not yet created)
- Check for syntax errors: `supabase db lint`

**Vercel deployment fails**
- Check build logs in Vercel dashboard
- Verify all required environment variables are set in Vercel project settings
- Check for type errors: `npm run type-check` locally

**Health check fails post-deploy**
- Check `/api/health` response body for error details
- Verify Supabase connection (check `NEXT_PUBLIC_SUPABASE_URL` in Vercel env)
- Check Vercel function logs for cold-start errors
