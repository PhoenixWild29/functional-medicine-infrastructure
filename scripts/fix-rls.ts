import { createClient } from '@supabase/supabase-js'

async function main() {
  const sb = createClient(
    process.env['SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!
  )

  const { data, error } = await sb.auth.admin.updateUserById(
    '87b7374d-e3bc-4c4a-b3ab-d8712c4cf36f',
    { password: 'POCAdmin2026!' }
  )
  console.log(JSON.stringify({ email: data?.user?.email, error }, null, 2))
}

main()
