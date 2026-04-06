// Get the checkout URL for the most recent AWAITING_PAYMENT order.
// Usage: npx dotenv -e .env.local -- npx tsx scripts/get-checkout-url.ts

import { createClient } from '@supabase/supabase-js'

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function generateToken(orderId: string, patientId: string, clinicId: string): Promise<string> {
  const secret = process.env.JWT_SECRET!
  const encoder = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const now = Math.floor(Date.now() / 1000)
  const payload = { orderId, patientId, clinicId, iat: now, exp: now + 259200 } // 72h
  const headerB64 = bytesToBase64url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const payloadB64 = bytesToBase64url(encoder.encode(JSON.stringify(payload)))
  const signingInput = `${headerB64}.${payloadB64}`
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(signingInput))
  return `${signingInput}.${bytesToBase64url(new Uint8Array(sig))}`
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
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

  const baseUrl = (process.env.APP_BASE_URL ?? '').replace(/\/$/, '')
  const token = await generateToken(order.order_id, order.patient_id, order.clinic_id)

  console.log('')
  console.log('=== CHECKOUT URL ===')
  console.log(`${baseUrl}/checkout/${token}`)
  console.log('====================')
}

main()
