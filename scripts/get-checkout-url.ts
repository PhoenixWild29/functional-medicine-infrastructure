// Get the checkout URL for the most recent AWAITING_PAYMENT order.
//
// DEPRECATED as the primary demo path — the clinic-app order drawer now
// has a "Copy Payment Link" button (PR #1 of demo-readiness campaign).
// Kept as a local-dev backup for debugging and for cases where operators
// need terminal access (e.g., generating links for testing without going
// through the UI).
//
// Usage: npx dotenv -e .env.local -- npx tsx scripts/get-checkout-url.ts
//
// NOTE: this imports `generateCheckoutToken` from src/lib/auth/checkout-token
// rather than re-implementing the signing logic. Prevents drift between the
// production token format and the backup script's format, which was a real
// risk before PR #1. If you need to change the JWT schema, change it in one
// place (the lib) and both paths stay in sync.

import { createClient } from '@supabase/supabase-js'
import { generateCheckoutToken } from '@/lib/auth/checkout-token'

async function main() {
  const supabase = createClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!
  )

  const { data: order, error } = await supabase
    .from('orders')
    .select('order_id, patient_id, clinic_id, status, created_at')
    .eq('status', 'AWAITING_PAYMENT')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) { console.error('DB error:', error.message); process.exit(1) }
  if (!order) {
    console.log('No orders in AWAITING_PAYMENT status.')
    console.log('Create a new order via the clinic app first.')
    process.exit(0)
  }

  console.log(`Order:   ${order.order_id}`)
  console.log(`Status:  ${order.status}`)
  console.log(`Created: ${order.created_at}`)

  const baseUrl = (process.env['APP_BASE_URL'] ?? '').replace(/\/$/, '')
  const token = await generateCheckoutToken(order.order_id, order.patient_id, order.clinic_id)

  console.log('')
  console.log('=== CHECKOUT URL ===')
  console.log(`${baseUrl}/checkout/${token}`)
  console.log('====================')
}

main()
