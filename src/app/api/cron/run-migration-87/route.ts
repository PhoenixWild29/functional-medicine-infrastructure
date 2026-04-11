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

  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
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

    return NextResponse.json({
      ok: true,
      ran_at: new Date().toISOString(),
      columns: verify.rows,
    })
  } catch (err) {
    console.error('[run-migration-87] failed:', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  } finally {
    await client.end().catch(() => {})
  }
}
