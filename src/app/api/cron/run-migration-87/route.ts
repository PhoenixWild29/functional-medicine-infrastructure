// ============================================================
// One-shot migration runner — WO-87 (B1 hotfix)
// GET /api/cron/run-migration-87
// ============================================================
//
// TEMPORARY endpoint: applies the orders.formulation_id schema
// change to the live database, then verifies the result. Delete
// this file after the migration has been applied successfully.
//
// Auth: CRON_SECRET bearer (same recovery pattern as the
// credential sync cron — works even when no one can log in).
//
// Why this exists: the direct postgres hostname is not resolvable
// from outside Vercel's network on this Supabase project, so we
// can't run the migration from a developer machine. Vercel
// functions already have DB connectivity, so we piggyback on that.

import { NextRequest, NextResponse } from 'next/server'
import { Client } from 'pg'

const MIGRATION_SQL = `
ALTER TABLE orders
  ALTER COLUMN catalog_item_id DROP NOT NULL;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS formulation_id UUID REFERENCES formulations(formulation_id);

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_catalog_or_formulation_required;

ALTER TABLE orders
  ADD CONSTRAINT orders_catalog_or_formulation_required
  CHECK (
    (catalog_item_id IS NOT NULL AND formulation_id IS NULL) OR
    (catalog_item_id IS NULL     AND formulation_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_orders_formulation_id
  ON orders (formulation_id)
  WHERE deleted_at IS NULL AND formulation_id IS NOT NULL;
`

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env['CRON_SECRET']}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) {
    return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 })
  }

  // The direct hostname `db.<ref>.supabase.co` doesn't resolve over IPv4 from
  // Vercel. We rewrite it to the Supavisor pooler hostname, which is IPv4-
  // reachable. Region is unknown ahead of time, so we try a list of common
  // regions until one connects.
  const directMatch = databaseUrl.match(/^postgresql:\/\/([^:]+):([^@]+)@db\.([a-z0-9]+)\.supabase\.co:(\d+)\/(.+)$/)
  if (!directMatch) {
    return NextResponse.json(
      { error: 'DATABASE_URL not in expected supabase format' },
      { status: 500 }
    )
  }
  const [, , password, projectRef, , database] = directMatch
  const regions = ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'eu-west-1', 'eu-central-1']

  let lastError: string | null = null
  for (const region of regions) {
    const poolerUrl =
      `postgresql://postgres.${projectRef}:${password}` +
      `@aws-0-${region}.pooler.supabase.com:6543/${database}`

    const client = new Client({
      connectionString: poolerUrl,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
    })

    try {
      await client.connect()
      await client.query(MIGRATION_SQL)

      const verify = await client.query(`
        SELECT column_name, is_nullable, data_type
        FROM information_schema.columns
        WHERE table_name = 'orders'
          AND column_name IN ('catalog_item_id', 'formulation_id')
        ORDER BY column_name
      `)

      await client.end().catch(() => {})
      return NextResponse.json({
        ok: true,
        ran_at: new Date().toISOString(),
        region,
        columns: verify.rows,
      })
    } catch (err) {
      lastError = err instanceof Error ? `${region}: ${err.message}` : `${region}: ${String(err)}`
      console.error(`[run-migration-87] ${lastError}`)
      await client.end().catch(() => {})
    }
  }

  return NextResponse.json(
    { ok: false, error: 'no pooler region accepted the connection', lastError },
    { status: 500 }
  )
}
