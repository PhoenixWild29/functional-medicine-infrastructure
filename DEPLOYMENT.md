# Deployment Runbook

## Deployment Architecture

```
main branch push → GitHub Actions CI → Supabase migrate → Vercel deploy → Health check → Slack notify
develop branch push → Same pipeline → staging environment
```

Production and staging deployments are fully automated via `.github/workflows/deploy.yml`. No manual steps are required for a standard deployment.

## Pre-Deployment Checklist

Before merging to `main` (production) or `develop` (staging):

- [ ] All CI checks pass on the PR (lint, typecheck, test, build)
- [ ] If schema changed: down migration exists and `database.types.ts` is up to date
- [ ] Environment variables updated in Vercel dashboard if new vars added
- [ ] Stripe webhooks still routing correctly (no endpoint URL changes)
- [ ] No breaking changes to the checkout token JWT schema
- [ ] If middleware `publicRoutes` changed: verify `/api/cron`, `/api/health`, `/api/webhooks`, `/auth/callback` are still in the list

## Standard Deployment

**Automatic** — push to `main` or `develop`:

> **Route authentication model:** `/api/cron/*` and `/api/health` are public (no Supabase session required). Cron jobs authenticate via `CRON_SECRET` bearer token inside the route handler. `/api/webhooks/*` and `/auth/callback` are also public. All other routes require a valid Supabase session cookie.

1. GitHub Actions `deploy.yml` triggers
2. **migrate** job: `supabase link` → `supabase db push` → type-check diff (fails if stale)
3. **deploy** job: `vercel pull` → `vercel build` → `vercel deploy --prebuilt`
4. **verify** job: GET `/api/health` — 5 retries, 10s apart
5. **notify** job: Slack `#deployments` with status of all jobs

If any job fails, the pipeline stops and Slack is notified with the failure.

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
# 1. Health check — expected response: {"status":"ok","db":"ok","version":"<git-sha>"}
curl https://app.compoundiq.com/api/health
# If db is "error", the Supabase connection is down (check SUPABASE_URL and pooler config)
# version field reflects VERCEL_GIT_COMMIT_SHA for the deployed build

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
curl https://app.compoundiq.com/api/health
```

> **Important:** Review [docs/migration-guide.md](docs/migration-guide.md) rollback caveats before running down migrations. Some migrations have ordering dependencies or permanent enum additions.

## Database Migration Execution

### Adding a new migration to production

Migrations run automatically in the CI/CD pipeline. For emergency hotfix migrations:

```bash
# 1. Create migration file
supabase/migrations/YYYYMMDDHHMMSS_hotfix_description.sql

# 2. Apply to production (requires DATABASE_URL)
supabase link --project-ref your-project-ref
supabase db push

# 3. Regenerate types and commit
npm run db:types
git add src/types/database.types.ts supabase/migrations/
git commit -m "chore: hotfix migration + regen types"
git push origin main
```

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

**Migration fails in CI**
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
