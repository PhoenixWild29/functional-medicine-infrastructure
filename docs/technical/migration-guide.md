# CompoundIQ — Supabase Migration Guide

## Overview

All database migrations live in `supabase/migrations/` as timestamped SQL files.
Down (rollback) migrations live in `supabase/migrations/down/`.

Migrations run automatically as part of the deploy pipeline (`supabase db push`).
**Never edit a migration that has already been applied to production.**
Instead, create a new migration to amend it.

---

## Migration File Naming

```
YYYYMMDDHHMMSS_description.sql
```

Example: `20260319000012_wo37_catalog_upload_history.sql`

The timestamp prefix determines execution order. Files are applied in ascending order.
All timestamps use UTC.

> **Postgres version**: This project targets **PostgreSQL 15** (Supabase default).
> `CREATE TRIGGER IF NOT EXISTS` requires PG17+; use `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`
> for idempotent trigger creation.

### Known Gap: 20260319000004

There is intentionally no `20260319000004_*.sql` file. The WO that was originally
slotted at that position was merged into adjacent migrations. Do not create a file
at that prefix — the gap is expected and the sequence is correct.

---

## Dependency Order

Migrations must be applied in this sequence to satisfy foreign key constraints:

| Phase | Files | Description |
|-------|-------|-------------|
| 1 | `20260317000001_*` | All 10 enum types |
| 2 | `20260317000002_*` | V1.0 tables in FK order |
| 3 | `20260317000003_*` | V2.0 adapter tables |
| 4 | `20260317000004_*` | Triggers & RLS policies |
| 5 | `20260317000005_*` | Vault credential columns |
| 6 | `20260318000001_*` — `20260318000014_*` | Incremental V1/V2 fixes |
| 7 | `20260319000001_*` — `20260319000012_*` | Phase 5–8 feature tables (note: no 000004) |

**V1.0 table FK dependency order** (within phase 2):
```
clinics
  └── providers
  └── patients
pharmacies
  └── pharmacy_state_licenses
  └── catalog
      └── catalog_history
orders (references clinics, providers, patients, pharmacies, catalog)
  └── order_status_history
  └── order_sla_deadlines
webhook_events
inbound_fax_queue
sms_log, sms_templates, transfer_failures, disputes
```

---

## Five-Phase Zero-Downtime Pattern

For any schema change that affects live production data, follow these phases:

### Phase 1 — Additive Only
Add new nullable columns, new tables, or new indexes. No NOT NULL constraints yet.
Application still reads/writes the old schema.

```sql
-- CORRECT: nullable column, no default required
ALTER TABLE orders ADD COLUMN new_column TEXT;

-- CORRECT: new index with CONCURRENTLY (no table lock)
CREATE INDEX CONCURRENTLY idx_orders_new_column ON orders(new_column)
  WHERE deleted_at IS NULL;
```

### Phase 2 — Dual-Write
Deploy application code that writes to **both** old and new columns.
Reads still use the old column.

### Phase 3 — Backfill
Run a data migration script to populate the new column from old data.
Do this in batches to avoid locking:

```sql
-- Batch backfill (run in loops outside a single transaction)
UPDATE orders
SET new_column = old_column
WHERE new_column IS NULL
  AND id IN (SELECT id FROM orders WHERE new_column IS NULL LIMIT 1000);
```

### Phase 4 — Tighten Constraints
Add NOT NULL constraints, remove temporary defaults, add CHECK constraints.

```sql
ALTER TABLE orders ALTER COLUMN new_column SET NOT NULL;
```

### Phase 5 — Cleanup
Drop old columns, remove dual-write code from the application.

```sql
ALTER TABLE orders DROP COLUMN old_column;
```

---

## Index Creation

**All indexes must use `CONCURRENTLY`** to avoid table locks in production:

```sql
CREATE INDEX CONCURRENTLY idx_orders_clinic_status
  ON orders(clinic_id, status)
  WHERE deleted_at IS NULL;
```

Never use plain `CREATE INDEX` on a live production table.

### CONCURRENTLY Inside Supabase Migrations

`CREATE INDEX CONCURRENTLY` cannot run inside a transaction block. Supabase wraps
each migration file in a transaction by default. To opt out, add this directive as
the **first line** of the migration file:

```sql
-- supabase: no transaction

CREATE INDEX CONCURRENTLY idx_orders_clinic_status
  ON orders(clinic_id, status)
  WHERE deleted_at IS NULL;
```

**Existing migrations** (20260317–20260319 series) used plain `CREATE INDEX IF NOT EXISTS`
because they were written before the CONCURRENTLY requirement was enforced. Those indexes
are already applied and cannot be retroactively changed without dropping and recreating
them. Use `CONCURRENTLY` for all new migrations going forward.

---

## Running Migrations Locally

```bash
# Link to your Supabase project (run once)
supabase link --project-ref your-project-ref

# Apply all pending migrations
supabase db push

# Regenerate TypeScript types after migration
npm run db:types
```

---

## Running Migrations in CI/CD

The deploy workflow (`deploy.yml`) runs `supabase db push` automatically before
deploying the application. The type-check step in the deploy workflow will fail
if `src/types/database.types.ts` is stale — regenerate locally and commit.

---

## Rolling Back a Migration

**Production rollbacks require manual approval** (the rollback workflow has an
`environment: production` gate in GitHub Actions).

### Using the Rollback Workflow

1. Go to GitHub Actions → **Rollback** workflow → **Run workflow**
2. Select `production` environment
3. Provide the Vercel deployment ID to restore (from the Vercel dashboard)
4. Set `rollback_migrations: true` if DB rollback is needed
5. Provide the 14-digit migration prefix to roll back

### Manual Rollback

```bash
# Find the down migration file
ls supabase/migrations/down/

# Execute the down migration
supabase db execute \
  --db-url "$DATABASE_URL" \
  --file supabase/migrations/down/20260319000012_down.sql
```

Down migrations execute in reverse order of the up migrations.

All up migrations in the `20260317`, `20260318`, and `20260319` series have
corresponding down migration files in `supabase/migrations/down/`. See those files
for the exact rollback steps for each migration.

**Caveats for specific migrations:**

- `20260317000001_down.sql` — drops all 10 enum types with CASCADE; intended for full
  schema teardown only.

- `20260318000001_down.sql` — rolling back 000001 without also rolling back 000004 leaves
  `orders` with no status-history trigger. Always roll back 000004 first (or together).

- `20260318000007_down.sql` — depends on `fn_alert_sms_failed()` still existing. Do NOT
  roll back `20260318000005` before rolling back 000007. This down migration is not
  idempotent (the `CREATE TRIGGER` fails if run twice).

- `20260318000008_down.sql` — standalone; can be rolled back independently of 000005.

- `20260318000009_down.sql` — partial rollback only: removes `circuit_breaker_state`
  table and adapter config columns, but enum values added to `adapter_submission_status_enum`
  (`ACKNOWLEDGED`, `REJECTED`, `SUBMISSION_FAILED`, `CANCELLED`), `webhook_source_enum`
  (`TWILIO`), and `integration_tier_enum` (`TIER_3_SPEC`) cannot be removed.

- `20260318000010_down.sql` and `20260318000013_down.sql` — delete storage buckets;
  ensure buckets are empty before running in production. Both files are wrapped in an
  explicit transaction so a non-empty bucket failure rolls back the column/index changes.

- `20260318000013_down.sql` — roll back `20260318000014` first to remove the
  `ops_admin read` storage policy before deleting the `adapter-screenshots` bucket.

- `20260319000003_down.sql` — must be run **after** `20260319000009_down.sql`. Running
  000003 first deletes the `payment_link` template row before 000009 can revert its body,
  leaving 000009's `UPDATE` as a silent no-op.

- `20260319000011_down.sql` — no-op; Postgres does not support removing enum values from
  `fax_queue_status_enum`.

---

## Type Generation

After any migration that changes the schema, regenerate TypeScript types:

```bash
npm run db:types
```

This runs:
```bash
supabase gen types typescript --project-id your-project-ref > src/types/database.types.ts
```

Commit the updated `src/types/database.types.ts` alongside the migration file.
The CI pipeline will fail if the types file is stale.

---

## HIPAA Notes

- Never store PHI in migration scripts (no test patient data, no real credentials)
- Use `supabase vault` for all pharmacy credentials — never plain-text in SQL
- RLS policies must be applied in the same migration as the table creation or immediately after
- All `order_status_history` writes happen via trigger — never bypass triggers in migrations
