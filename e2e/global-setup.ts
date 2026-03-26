// ============================================================
// Playwright Global Setup — WO-42
// ============================================================
//
// Runs once before any test suite.
// Creates Supabase Auth test users idempotently via the admin API.
// Users are reused across all test runs — no teardown needed.
//
// Uses listUsers() to check for existence before create,
// so re-runs are safe even if users already exist.

import { createClient } from '@supabase/supabase-js'
import { TEST_USERS, TEST_IDS, seedStaticData } from './fixtures/seed'

export default async function globalSetup(): Promise<void> {
  const supabase = createClient(
    process.env['SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!
  )

  // Seed static reference data (clinic, pharmacy, catalog, patient)
  await seedStaticData()

  // Create Auth users idempotently
  const { data: existingUsers } = await supabase.auth.admin.listUsers()
  for (const user of Object.values(TEST_USERS)) {
    const alreadyExists = existingUsers?.users.some((u) => u.email === user.email)
    if (alreadyExists) continue

    // NB-2 (cowork): app_role and clinic_id must be in user_metadata, not app_metadata.
    // The application reads session.user.user_metadata['app_role'] in middleware and all
    // layouts. Supabase does not merge app_metadata into user_metadata on the client SDK,
    // so using app_metadata would result in undefined app_role at runtime.
    const { error } = await supabase.auth.admin.createUser({
      email:          user.email,
      password:       user.password,
      email_confirm:  true,
      user_metadata: {
        app_role:  user.role,
        ...(user.clinicId && { clinic_id: user.clinicId }),
        // Map to the profile row that will be created by the auth trigger
        ...(user.role === 'provider' && { profile_id: TEST_IDS.provider }),
      },
    })

    if (error) {
      // createUser returns an error if the user was created between the listUsers check
      // and this call (race condition in parallel setup). Ignore duplicate-email errors.
      if (!error.message.toLowerCase().includes('already registered')) {
        throw new Error(`Failed to create test user ${user.email}: ${error.message}`)
      }
    }
  }
}
