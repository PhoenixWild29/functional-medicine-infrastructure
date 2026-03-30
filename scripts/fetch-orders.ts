import { createClient } from '@supabase/supabase-js'
import { generateCheckoutToken } from '../src/lib/auth/checkout-token'

async function main() {
  const orderId   = '6413ca63-5890-4fbd-914d-eed548bad561'
  const patientId = 'a3000000-0000-0000-0000-000000000001'
  const clinicId  = 'a1000000-0000-0000-0000-000000000001'

  const token = await generateCheckoutToken(orderId, patientId, clinicId)
  const checkoutUrl = `${process.env['APP_BASE_URL']}/checkout/${token}`
  console.log('Checkout URL:', checkoutUrl)
}

main()
