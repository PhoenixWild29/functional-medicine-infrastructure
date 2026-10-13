// ============================================================
// Payments ledger backfill — scripts/backfill-ledger.ts
// ============================================================
//
// Writes ledger lines and pharmacy payables for paid orders that predate
// the ledger (lib/payments/backfill). DRY RUN BY DEFAULT: it only counts.
//
//   npm run ledger:backfill              # dry run: counts only
//   npm run ledger:backfill -- --apply   # writes the missing lines
//
// Record-only: no Stripe calls, no money moved. Keyed 'backfill:<order_id>',
// so running it twice writes nothing twice. Reads SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY; check which project they point at first.

import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database.types'
import { backfillLedger } from '../src/lib/payments/backfill'

async function main(): Promise<void> {
  const url = process.env['SUPABASE_URL'] ?? process.env['NEXT_PUBLIC_SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
    process.exit(1)
  }
  const apply = process.argv.includes('--apply')
  console.info(`Project: ${new URL(url).host} | mode: ${apply ? 'APPLY (writes)' : 'dry run (counts only)'}`)

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const result = await backfillLedger(supabase as never, { apply })
  console.info(JSON.stringify(result, null, 2))
  if (result.failed > 0) process.exit(2)
}

main().catch(err => {
  console.error('Backfill failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
