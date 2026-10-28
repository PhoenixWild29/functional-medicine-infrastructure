/**
 * @jest-environment node
 *
 * Decision 11 follow-up, on a real Postgres (PGlite) with every migration
 * applied (20261028000001_favorites_soft_delete included): a soft-deleted
 * favorite is invisible to a staff JWT, still there for the service role,
 * and collapse_provider_favorites() neither merges it nor merges into it.
 */

import { runPlan, type StepResult } from './helpers/pglite-migrated'

jest.setTimeout(900_000)

const CLINIC = 'b1000000-0000-4000-8000-000000000001'
const PROVIDER = 'b2000000-0000-4000-8000-000000000001'
const USER = 'b0000000-0000-4000-8000-0000000000a2'
const FORM = 'e0000000-0000-4000-8000-000000000003'
const LIVE_A = 'b5000000-0000-4000-8000-00000000000a'
const LIVE_B = 'b5000000-0000-4000-8000-00000000000b'
const GONE = 'b5000000-0000-4000-8000-00000000000c'

const SEED = `
  INSERT INTO dosage_forms (dosage_form_id, name) VALUES ('e0000000-0000-4000-8000-000000000001', 'Form');
  INSERT INTO routes_of_administration (route_id, name, abbreviation, sig_prefix) VALUES ('e0000000-0000-4000-8000-000000000002', 'Route', 'RT', 'Take');
  INSERT INTO formulations (formulation_id, name, dosage_form_id, route_id) VALUES ('${FORM}', 'Formulation', 'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002');
  INSERT INTO clinics (clinic_id, name, stripe_connect_status) VALUES ('${CLINIC}', 'Sunrise', 'ACTIVE');
  INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ('${USER}', 'dr@test', '{"app_role":"provider","clinic_id":"${CLINIC}"}');
  INSERT INTO providers (provider_id, clinic_id, first_name, last_name, npi_number, license_state, license_number, user_id) VALUES
    ('${PROVIDER}', '${CLINIC}', 'Sarah', 'Chen', '1234567890', 'TX', 'TX-1', '${USER}');
  INSERT INTO provider_favorites (favorite_id, provider_id, formulation_id, label, dose_presets, use_count, deleted_at) VALUES
    ('${LIVE_A}', '${PROVIDER}', '${FORM}', 'A', '[{"dose":"10","unit":"units"}]', 5, NULL),
    ('${LIVE_B}', '${PROVIDER}', '${FORM}', 'B', '[{"dose":"20","unit":"units"}]', 1, NULL),
    ('${GONE}',   '${PROVIDER}', '${FORM}', 'C', '[{"dose":"40","unit":"units"}]', 9, now());
  SELECT 1;
`

const staff = { sub: USER, role: 'authenticated', aal: 'aal1', app_metadata: { app_role: 'provider', clinic_id: CLINIC } }

let results: Map<string, StepResult>
beforeAll(async () => {
  results = await runPlan([
    { id: 'seed', sql: SEED, persist: true },
    { id: 'staff:ids', claims: staff, sql: 'SELECT favorite_id FROM public.provider_favorites ORDER BY favorite_id' },
    { id: 'service:count', role: 'service_role', sql: 'SELECT count(*)::int AS n FROM public.provider_favorites' },
    {
      id: 'collapse',
      sql: `SELECT collapse_provider_favorites() AS merged;
            SELECT favorite_id, deleted_at IS NOT NULL AS deleted, dose_presets FROM public.provider_favorites ORDER BY favorite_id`,
    },
  ])
})

const rows = (id: string) => {
  const r = results.get(id)
  if (!r) throw new Error(`no result for ${id}`)
  if (r.error) throw new Error(`${id}: ${r.error}`)
  return r.rows!
}

it('a staff JWT reads the live favorites, not the deleted one', () => {
  expect(rows('staff:ids').map(r => r['favorite_id'])).toEqual([LIVE_A, LIVE_B])
})

it('the deleted row is still there (service role)', () => {
  expect(rows('service:count')).toEqual([{ n: 3 }])
})

it('collapse merges the two live cards and leaves the deleted one alone', () => {
  const after = rows('collapse') as Array<{ favorite_id: string; deleted: boolean; dose_presets: Array<{ dose: string }> }>
  expect(after.map(r => [r.favorite_id, r.deleted])).toEqual([[LIVE_A, false], [GONE, true]])
  const survivor = after.find(r => r.favorite_id === LIVE_A)!
  expect(survivor.dose_presets.map(p => p.dose)).toEqual(['10', '20'])
  const gone = after.find(r => r.favorite_id === GONE)!
  expect(gone.dose_presets.map(p => p.dose)).toEqual(['40'])
})
