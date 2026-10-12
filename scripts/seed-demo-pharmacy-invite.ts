// ============================================================
// Seed: the demo pharmacy invite
// ============================================================
//
// Creates (or, run again, reissues) the invite for "Demo Compounding
// Pharmacy" and prints its link. The link is shown only here: CompoundIQ
// stores only its hash. It works once and expires in 7 days.
//
//   npm run seed:pharmacy-invite        (reads .env.local)
//
// Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
// APP_BASE_URL for the environment the link is for.

import { createClient } from '@supabase/supabase-js'
import { seedDemoPharmacyInvite, DEMO_INVITE } from '../src/lib/pharmacy-onboarding/demo-invite'

async function main() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key || !process.env['APP_BASE_URL']) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and APP_BASE_URL.')
    process.exit(1)
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const r = await seedDemoPharmacyInvite(db)
  if (!r.ok) {
    console.error(`The demo invite could not be seeded: ${r.error}`)
    process.exit(1)
  }
  if (r.action === 'already_accepted') {
    console.info(`The demo invite for ${DEMO_INVITE.adminEmail} was already used. Sign in as that account, or create a new invite in Ops.`)
    return
  }
  console.info(`Demo invite ${r.action} for ${DEMO_INVITE.pharmacyName} <${DEMO_INVITE.adminEmail}>:`)
  console.info(r.link)
  console.info('It works once and expires in 7 days. This is the only time the link is shown.')
}

void main()
