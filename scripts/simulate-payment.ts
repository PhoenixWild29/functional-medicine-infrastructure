import { createClient } from '@supabase/supabase-js'

const ORDER_ID = '6413ca63-5890-4fbd-914d-eed548bad561'
const FAKE_PI   = 'pi_poc_simulation_001'

async function main() {
  const sb = createClient(
    process.env['SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!
  )

  // 1. Set a fake payment_intent_id on the order (webhook would do this via checkout)
  const { error: piErr } = await sb.from('orders')
    .update({ stripe_payment_intent_id: FAKE_PI })
    .eq('order_id', ORDER_ID)
  if (piErr) { console.error('PI update failed:', piErr.message); return }
  console.log('✓ stripe_payment_intent_id set')

  // 2. CAS: AWAITING_PAYMENT → PAID_PROCESSING
  const { data: cas1, error: cas1Err } = await sb.from('orders')
    .update({ status: 'PAID_PROCESSING', updated_at: new Date().toISOString() })
    .eq('order_id', ORDER_ID)
    .eq('status', 'AWAITING_PAYMENT')
    .select('order_id, status')
  if (cas1Err) { console.error('CAS1 failed:', cas1Err.message); return }
  if (!cas1?.length) { console.error('CAS1 no-op — order not in AWAITING_PAYMENT'); return }
  console.log('✓ AWAITING_PAYMENT → PAID_PROCESSING')

  // 3. Log status history
  await sb.from('order_status_history').insert({
    order_id: ORDER_ID, old_status: 'AWAITING_PAYMENT',
    new_status: 'PAID_PROCESSING', changed_by: null,
    metadata: { actor: 'poc_simulation', stripe_payment_intent_id: FAKE_PI }
  })
  console.log('✓ status history logged')

  // 4. CAS: PAID_PROCESSING → FAX_QUEUED (Strive is TIER_4_FAX)
  const { data: cas2, error: cas2Err } = await sb.from('orders')
    .update({ status: 'FAX_QUEUED', updated_at: new Date().toISOString() })
    .eq('order_id', ORDER_ID)
    .eq('status', 'PAID_PROCESSING')
    .select('order_id, status')
  if (cas2Err) { console.error('CAS2 failed:', cas2Err.message); return }
  if (!cas2?.length) { console.error('CAS2 no-op — order not in PAID_PROCESSING'); return }
  console.log('✓ PAID_PROCESSING → FAX_QUEUED')

  // 5. Log status history
  await sb.from('order_status_history').insert({
    order_id: ORDER_ID, old_status: 'PAID_PROCESSING',
    new_status: 'FAX_QUEUED', changed_by: null,
    metadata: { actor: 'poc_simulation', tier: 'TIER_4_FAX' }
  })
  console.log('✓ status history logged')

  // 6. Verify final state
  const { data: final } = await sb.from('orders')
    .select('order_id, status, stripe_payment_intent_id, updated_at')
    .eq('order_id', ORDER_ID)
    .single()
  console.log('\nFinal order state:', JSON.stringify(final, null, 2))
}

main()
