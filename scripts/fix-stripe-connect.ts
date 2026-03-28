import { createClient } from '@supabase/supabase-js'

async function main() {
  const supabase = createClient(
    process.env['SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!
  )

  const { data, error } = await supabase
    .from('clinics')
    .update({
      stripe_connect_status: 'ACTIVE',
      stripe_connect_account_id: 'poc_placeholder',
    })
    .eq('name', 'Sunrise Functional Medicine')
    .select('clinic_id, name, stripe_connect_status')

  console.log(JSON.stringify({ data, error }, null, 2))
}

main()
