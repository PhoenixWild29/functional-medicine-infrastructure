// ============================================================
// POC Credential Sync — shared upsert logic
// ============================================================
//
// Iterates the canonical user list and forces every account to the
// canonical password + metadata. Mirrors the createAuthUsers() upsert
// path in scripts/seed-poc.ts so behavior is identical regardless of
// trigger (local seed, cron, or in-app button).
//
// Returns a per-user result so the caller can render or log.

import type { SupabaseClient } from '@supabase/supabase-js'
import { POC_CANONICAL_USERS, userMetadataFor, type PocUserLabel } from './canonical-users'
import { enrollDemoProvider, type DemoTotpEnrollmentResult } from './totp-enrollment'
import { refreshDemoData, type DemoDataRefreshReport } from './refresh-demo-data'

export interface PocSyncResult {
  label:   PocUserLabel
  email:   string
  action:  'created' | 'synced' | 'skipped'
  error?:  string
}

export interface PocSyncReport {
  ran_at:  string
  results: PocSyncResult[]
  totp_enrollment?:   DemoTotpEnrollmentResult
  demo_data_refresh?: DemoDataRefreshReport
  ok:      boolean
}

export async function syncPocCredentials(supabase: SupabaseClient): Promise<PocSyncReport> {
  const ranAt: string = new Date().toISOString()
  const results: PocSyncResult[] = []

  // NB-01: page size 1000 to avoid silent truncation (matches seed-poc.ts).
  const { data: list, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (listError) {
    return {
      ran_at:  ranAt,
      results: [],
      ok:      false,
    }
  }

  const existingByEmail = new Map(list.users.map(u => [u.email, u]))

  for (const user of POC_CANONICAL_USERS) {
    const existing = existingByEmail.get(user.email)
    if (existing) {
      const { error } = await supabase.auth.admin.updateUserById(existing.id, {
        password:      user.password,
        user_metadata: userMetadataFor(user),
      })
      if (error) {
        results.push({ label: user.label, email: user.email, action: 'skipped', error: error.message })
      } else {
        results.push({ label: user.label, email: user.email, action: 'synced' })
      }
      continue
    }

    const { error } = await supabase.auth.admin.createUser({
      email:         user.email,
      password:      user.password,
      user_metadata: userMetadataFor(user),
      email_confirm: true,
    })
    if (error) {
      results.push({ label: user.label, email: user.email, action: 'skipped', error: error.message })
    } else {
      results.push({ label: user.label, email: user.email, action: 'created' })
    }
  }

  // Pre-enroll the demo provider's EPCS TOTP so controlled-substance
  // signings in investor demos never trigger the first-time enrollment
  // UI (cowork review #6 finding A2). Gated internally on POC_MODE so
  // this is a safe no-op if the cron ever runs against a non-POC
  // deployment.
  const totpEnrollment = await enrollDemoProvider(supabase)

  // Refresh time-sensitive demo seed data: fax triage rows with
  // "minutes ago" timestamps + 200 recent adapter submissions so
  // the Adapter Health cards classify green/yellow, not idle (cowork
  // review PR #5 finding B2). Also gated internally on POC_MODE.
  // This is the daily safety-net path; the primary demo-time path
  // is the "Refresh Demo Data" button on /ops/demo-tools.
  const demoDataRefresh = await refreshDemoData(supabase)

  const ok = results.every(r => !r.error) && demoDataRefresh.ok
  return {
    ran_at:             ranAt,
    results,
    totp_enrollment:    totpEnrollment,
    demo_data_refresh:  demoDataRefresh,
    ok,
  }
}
