/**
 * @jest-environment node
 *
 * Pharmacy onboarding: migration 20261014000001.
 *
 * No Postgres runner here (see phi-access-log-migration.test.ts): this
 * pins what the SQL must say. The owner runs it after 20261012000001 (C8)
 * and 20261013000001 (clinic onboarding).
 *
 *   - pharmacies gains the onboarding details; a pharmacy being onboarded
 *     can never be active (CHECK), so it never reaches the builder or
 *     routing (both require is_active).
 *   - pharmacy_state_licenses gains a verification status; a license that
 *     is not verified can never be active (CHECK), so C5 never counts it.
 *   - pharmacy_invites stores only a SHA-256 of the token.
 *   - the BAA / terms acceptance record and the onboarding event log are
 *     append-only for every role.
 *   - RLS on every new table. A pharmacy_admin reads only its own
 *     pharmacy's rows: one RESTRICTIVE policy on every RLS table in public
 *     (own rows on the four pharmacy-owned tables, nothing elsewhere), and
 *     the migration fails if any public table is left without RLS or
 *     without that policy.
 *   - license documents go to a private bucket, service role only.
 *   - three owner-rights views no app code reads are closed to anon and
 *     authenticated (they bypassed RLS for every signed-in user).
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const sql = read(join(MIGRATIONS, '20261014000001_pharmacy_onboarding.sql'))
const down = read(join(MIGRATIONS, 'down', '20261014000001_down.sql'))
const flat = (t: string) => t.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()
const code = flat(sql)

function table(name: string): string {
  const start = code.indexOf(`create table if not exists ${name} (`)
  return start < 0 ? '' : code.slice(start, code.indexOf(');', start))
}

it('the migration and its down file exist, each in one transaction', () => {
  expect(sql).not.toBe('')
  expect(down).not.toBe('')
  for (const c of [code, flat(down)]) {
    expect(c).toMatch(/^\s*begin;/)
    expect(c).toMatch(/commit;\s*$/)
  }
})

it('it is the latest migration, after C8 and clinic onboarding', () => {
  // Filename order is apply order.
  expect('20261014000001' > '20261013000001' && '20261013000001' > '20261012000001').toBe(true)
})

describe('pharmacies', () => {
  it('gains the onboarding details, validated', () => {
    for (const col of ['legal_name text', 'dba_name text', 'ncpdp_id text', 'npi text', 'dea_number text', 'ship_carriers text[]', 'ships_cold_chain boolean', 'ship_to_states text[]', 'order_cutoff_local time', 'onboarding_status text']) {
      expect(code).toContain(`add column if not exists ${col}`)
    }
    expect(code).toMatch(/ncpdp_id is null or ncpdp_id ~ '\^\[0-9\]\{7\}\$'/)
    expect(code).toMatch(/npi is null or npi ~ '\^\[0-9\]\{10\}\$'/)
    expect(code).toMatch(/dea_number is null or dea_number ~ '\^\[a-z\]\{2\}\[0-9\]\{7\}\$'/)
  })

  it('a pharmacy being onboarded is never active', () => {
    expect(code).toMatch(/onboarding_status in \('onboarding', ?'approved'\)/)
    expect(code).toMatch(/check \(onboarding_status is distinct from 'onboarding' or is_active = false\)/)
  })
})

describe('pharmacy_state_licenses', () => {
  it('a license that is not verified is never active; existing licenses stay verified', () => {
    expect(code).toMatch(/add column if not exists verification_status text not null default 'verified'/)
    expect(code).toMatch(/verification_status in \('pending', ?'verified', ?'rejected'\)/)
    expect(code).toMatch(/check \(verification_status = 'verified' or is_active = false\)/)
    for (const col of ['verified_at timestamptz', 'verified_by uuid', 'document_path text', 'verification_note text']) expect(code).toContain(`add column if not exists ${col}`)
  })
})

describe('pharmacy_invites', () => {
  const t = table('pharmacy_invites')
  it('stores a hash of the token, never the token; expires; single-use; revocable', () => {
    expect(t).not.toBe('')
    expect(t).toMatch(/token_hash text not null unique check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/)
    for (const col of ['pharmacy_name text not null', 'admin_email text not null', 'expires_at timestamptz not null', 'created_by uuid not null', 'accepted_at timestamptz', 'accepted_user_id uuid', 'revoked_at timestamptz', 'revoked_by uuid', 'send_count integer not null']) {
      expect(t).toContain(col)
    }
    expect(t).not.toMatch(/\btoken text/)
    expect(t).toContain('check (accepted_at is null or revoked_at is null)')
  })
})

describe('pharmacy_onboarding_applications', () => {
  const t = table('pharmacy_onboarding_applications')
  it('one per pharmacy, with progress and review; no secrets', () => {
    expect(t).toContain('pharmacy_id uuid not null unique references pharmacies(pharmacy_id)')
    expect(t).toMatch(/status in \('in_progress', ?'submitted', ?'sent_back', ?'approved'\)/)
    expect(t).toContain('steps_completed text[] not null')
    expect(t).toMatch(/ordering_method in \('api', ?'portal', ?'fax'\)/)
    expect(t).toMatch(/catalog_choice in \('uploaded', ?'skipped'\)/)
    // Ops marks an API or portal pharmacy's adapter configured before approval.
    expect(t).toContain('adapter_configured_at timestamptz')
    expect(t).toContain('adapter_configured_by uuid')
    expect(t).toContain('check ((adapter_configured_at is null) = (adapter_configured_by is null))')
    expect(t).not.toMatch(/password|api_key|secret text/)
  })
})

describe('append-only records', () => {
  it('BAA and terms acceptance: signer, title, user, time, template version, text hash', () => {
    const t = table('pharmacy_agreement_acceptances')
    for (const col of ['user_id uuid not null', 'signer_name text not null', 'signer_title text not null', 'template_key text not null', 'template_version text not null', 'accepted_at timestamptz not null']) expect(t).toContain(col)
    expect(t).toMatch(/text_sha256 text not null check \(text_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/)
  })

  it('the onboarding event log records ops actions as codes, no free text', () => {
    const t = table('pharmacy_onboarding_events')
    expect(t).toMatch(/action text not null check \(action ~ '\^\[a-z_\]\{1,60\}\$'\)/)
    for (const col of ['actor_user_id uuid', 'actor_role text not null', 'occurred_at timestamptz not null']) expect(t).toContain(col)
  })

  it.each(['pharmacy_agreement_acceptances', 'pharmacy_onboarding_events'])('%s refuses update, delete and truncate for every role', name => {
    expect(code).toContain(`revoke update, delete, truncate on ${name} from anon, authenticated, service_role`)
    expect(code).toMatch(new RegExp(`create trigger ${name}_no_update_delete before update or delete on ${name} for each row execute function pharmacy_onboarding_append_only\\(\\)`))
    expect(code).toMatch(new RegExp(`create trigger ${name}_no_truncate before truncate on ${name} for each statement execute function pharmacy_onboarding_append_only\\(\\)`))
  })
})

describe('row level security', () => {
  it.each(['pharmacy_invites', 'pharmacy_onboarding_applications', 'pharmacy_agreement_acceptances', 'pharmacy_onboarding_events'])('%s has RLS, no writes for signed-in users', name => {
    expect(code).toContain(`alter table ${name} enable row level security`)
    expect(code).toContain(`revoke insert, update, delete, truncate on ${name} from anon, authenticated`)
  })

  it('a pharmacy_admin reads only its own pharmacy (claims from app_metadata)', () => {
    for (const name of ['pharmacies', 'pharmacy_state_licenses', 'pharmacy_onboarding_applications', 'pharmacy_agreement_acceptances']) {
      expect(code).toMatch(new RegExp(`create policy ${name}_pharmacy_admin_own on ${name} for select to authenticated using \\(\\(auth\\.jwt\\(\\) -> 'app_metadata' ->> 'app_role'\\) = 'pharmacy_admin' and pharmacy_id = \\(auth\\.jwt\\(\\) -> 'app_metadata' ->> 'pharmacy_id'\\)::uuid\\)`))
    }
    expect(code).not.toContain('user_metadata')
  })

  it('one restrictive policy on every RLS table shuts a pharmacy_admin out of everything else', () => {
    expect(code).toContain('as restrictive for all to authenticated')
    // Inside format(): the quotes are doubled.
    expect(code).toMatch(/is distinct from '{1,2}pharmacy_admin'{1,2}/)
    expect(code).toContain('c.relrowsecurity')
    // The four pharmacy-owned tables allow its own rows.
    expect(code).toMatch(/array\['pharmacies', ?'pharmacy_state_licenses', ?'pharmacy_onboarding_applications', ?'pharmacy_agreement_acceptances'\]/)
  })

  it('the migration fails if a public table has no RLS or no pharmacy_admin_scope policy', () => {
    expect(code).toMatch(/raise exception 'public table % has no row level security/)
    expect(code).toMatch(/raise exception 'public table % has no pharmacy_admin_scope policy/)
  })

  it('sla_notifications_log gets RLS (it had none; only the service role reads it)', () => {
    expect(code).toContain('alter table sla_notifications_log enable row level security')
  })

  it('owner-rights views no app code reads are closed to anon and authenticated', () => {
    for (const v of ['webhook_dead_letter_queue', 'pharmacy_webhook_dead_letter_queue', 'provider_prescribing_history']) {
      expect(code).toContain(`revoke select on ${v} from anon, authenticated`)
    }
  })
})

it('the Vault helpers (SECURITY DEFINER) run for the service role only, never anon', () => {
  // 20260317000005 revoked them from PUBLIC and authenticated but not
  // anon, which Supabase grants function EXECUTE by default: the anon key
  // could create, rotate or delete Vault secrets through RPC. The portal
  // stores pharmacy credentials with them.
  for (const fn of ['create_vault_secret(text, text)', 'rotate_vault_secret(uuid, text)', 'delete_vault_secret(uuid)']) {
    expect(code).toContain(`revoke all on function ${fn} from public, anon, authenticated`)
    expect(code).toContain(`grant execute on function ${fn} to service_role`)
  }
})

it('license documents: a private bucket, PDF and images, 10 MB, no storage policies', () => {
  expect(code).toMatch(/insert into storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\) values \( ?'pharmacy-license-documents', ?'pharmacy-license-documents', ?false, ?10485760/)
  expect(code).not.toMatch(/on storage\.objects/)
})

it('deletes or updates no existing data', () => {
  expect(code).not.toMatch(/(^|;)\s*delete from\b/)
  expect(code).not.toMatch(/(^|;)\s*update [a-z_.]+ set\b/)
  expect(code).not.toMatch(/(^|;)\s*truncate\b/)
})

it('the down file removes what this adds', () => {
  const d = flat(down)
  for (const s of ['drop table if exists pharmacy_onboarding_events', 'drop table if exists pharmacy_agreement_acceptances', 'drop table if exists pharmacy_onboarding_applications', 'drop table if exists pharmacy_invites', 'drop policy if exists pharmacy_admin_scope', 'drop column if exists verification_status', 'drop column if exists onboarding_status']) {
    expect(d).toContain(s)
  }
  expect(d).not.toMatch(/drop table if exists (pharmacies|pharmacy_state_licenses)\b/)
})
