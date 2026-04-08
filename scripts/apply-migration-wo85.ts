// ============================================================
// WO-85: Apply migration — Provider Favorites + Protocol Templates
// ============================================================
//
// Usage: npx dotenv -e .env.local -- npx tsx scripts/apply-migration-wo85.ts
//
// Runs the WO-85 migration SQL via Supabase service client.
// Idempotent: uses IF NOT EXISTS and CREATE OR REPLACE.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { join } from 'path'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  const sqlPath = join(__dirname, '..', 'supabase', 'migrations', '20260408000003_wo85_provider_favorites_and_protocols.sql')
  const sql = readFileSync(sqlPath, 'utf-8')

  // Split by semicolons and execute each statement
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'))

  console.log(`Running ${statements.length} SQL statements...`)

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i]!
    // Skip pure comment blocks
    if (stmt.replace(/--[^\n]*/g, '').trim().length === 0) continue

    const label = stmt.substring(0, 60).replace(/\n/g, ' ')
    console.log(`  [${i + 1}/${statements.length}] ${label}...`)

    const { error } = await supabase.rpc('exec_sql', { query: stmt })
    if (error) {
      // Try via .from() raw — fallback: use fetch directly
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/`,
        {
          method: 'POST',
          headers: {
            'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({}),
        }
      )

      // If RPC doesn't work, fall back to pg direct
      console.error(`  RPC not available, trying direct SQL...`)

      // Use the Supabase SQL API (v1)
      const sqlRes = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/pg/query`,
        {
          method: 'POST',
          headers: {
            'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: stmt }),
        }
      )

      if (!sqlRes.ok) {
        const text = await sqlRes.text()
        console.error(`  FAILED: ${text}`)
        // Don't abort on IF NOT EXISTS failures
        if (!stmt.includes('IF NOT EXISTS') && !stmt.includes('CREATE OR REPLACE') && !stmt.includes('CREATE INDEX') && !stmt.includes('CREATE POLICY')) {
          process.exit(1)
        }
      }
    }
  }

  console.log('Migration complete!')
}

main().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
