# Deployment Runbook

## Deployment Architecture

```
main branch push → Vercel native GitHub integration → build + deploy → Health check
```

Production deploys automatically through **Vercel's native GitHub integration** on every push to `main`. The custom `.github/workflows/deploy.yml` GitHub Actions pipeline is **disabled** and does not run.

GitHub Actions runs CI:
- Lint (`eslint . --max-warnings=0`: any warning fails), type-check, Jest and Build run on pull requests and pushes to main.
- E2E runs on pull requests that change more than documentation, nightly at 07:30 UTC, and by hand. It does not run on pushes to main.

Database migrations are applied **manually**. Sam runs every production SQL statement; nothing in CI or the deploy touches the production database (see [Database Migration Execution](#database-migration-execution)).

## Pre-Deployment Checklist

Before merging to `main` (production) or `develop` (staging):

- [ ] All CI checks pass on the PR (lint, typecheck, test, build)
- [ ] If schema changed: down migration exists and `database.types.ts` is up to date
- [ ] Environment variables updated in Vercel dashboard if new vars added
- [ ] Stripe webhooks still routing correctly (no endpoint URL changes)
- [ ] No breaking changes to the checkout token JWT schema
- [ ] If middleware `publicRoutes` changed: verify `/api/cron`, `/api/health`, `/api/webhooks`, `/auth/callback` are still in the list. The file is `src/middleware.ts` until the Next 16 rename to `src/proxy.ts` (#266) merges.
- [ ] If the PR has a migration: Sam has applied it on production **before** merge, and the PR merges before any other PR runs E2E (see below)

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

Only Sam runs this. With `rollback_migrations: true` it executes SQL against production, and production SQL is Sam's alone. Agents never trigger it.

1. Go to **GitHub Actions → Rollback** workflow → **Run workflow**
2. Select environment: `production` or `staging`
3. Paste the Vercel deployment ID to restore (from Vercel dashboard → Deployments)
4. Set `rollback_migrations: true` if schema changes need reversing
5. Provide `migration_prefix` (14 digits, e.g. `20260319000012`) if rolling back migrations
6. Click **Run workflow** — requires production environment approval

### Option B — Manual

Sam only, for the same reason (step 2 runs SQL against production).

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

Migrations are **not** run by CI or the Vercel deploy. **Sam runs every SQL statement against production.** Agents, CI and scripts never connect to the production database.

The handoff for a schema change:

1. The PR adds `supabase/migrations/YYYYMMDD0000NN_description.sql` and `supabase/migrations/down/YYYYMMDD0000NN_down.sql`.
   - Pick the next free number across main **and** every pushed branch: `git ls-tree origin/<branch> supabase/migrations/`.
   - The PR or commit report carries the full SQL.
2. The migration is tested against all migrations (PGlite, or the E2E project through the PR's E2E run).
3. Sam applies it on production in the Supabase SQL editor, after confirming the project by its name in the dashboard header.
   - `current_database()` says `postgres` on every project, and the migration ledger is not a reliable way to tell projects apart.
4. Only then does the PR merge, so the deployed build never runs against a stale schema.
5. `src/types/database.types.ts` is updated in the same PR (`npm run db:types`, or by hand for a small change).

**Migration order and the shared E2E database.** Every E2E run applies all of `supabase/migrations/` to the one shared E2E Supabase project (`npx supabase@2.120.0 db push`). A PR with a migration changes that shared schema on its first E2E run. Other PRs' E2E runs then test against a schema their branch does not have, and can fail or pass for the wrong reason. So a migration PR merges **before** any other PR runs E2E; the others rebase or merge main afterwards.

**Production test data** is removed by `scripts/cleanup/2026-10-24-test-data-cleanup.sql` (on the `test-data-cleanup-script` branch). Sam runs it once, after Lauren has reviewed the test data. Run it first with its last line changed to ROLLBACK (a dry run that shows the preview and verification), then with COMMIT. Files it lists under Storage are removed through the Storage API.

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

**Lint fails in CI but passed locally**
- CI lints with `--max-warnings=0`, so a warning fails the job. Run `npm run lint`, not `npx eslint`. Run `npm ci` first, so your local eslint-config-next (16.4.3, react-hooks 7.1) matches the lockfile.
- CI lints the merge with current main. Merge main and lint again.

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
