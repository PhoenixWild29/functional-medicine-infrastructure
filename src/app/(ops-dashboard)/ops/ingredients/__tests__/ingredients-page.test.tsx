/**
 * @jest-environment node
 *
 * Compliance C8: /ops/ingredients. Every ingredient with its compounding
 * status, commercial equivalent, FDA shortage flag, source and review
 * date, and the controls to change them; the ones that cannot be ordered
 * are counted and marked; recent changes come from the audit log.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { scriptedDb, DB_DOWN, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))

import IngredientsPage from '../page'

const INGREDIENTS = [
  { ingredient_id: 'i1', common_name: 'BPC-157', compounding_status: 'pending_evaluation', commercial_equivalent: false, on_fda_shortage: false, compounding_status_source: 'demo data, not verified', compounding_status_reviewed_at: '2026-10-12T00:00:00Z' },
  { ingredient_id: 'i2', common_name: 'NAD+', compounding_status: 'unverified', commercial_equivalent: false, on_fda_shortage: false, compounding_status_source: null, compounding_status_reviewed_at: null },
  { ingredient_id: 'i3', common_name: 'Semaglutide', compounding_status: 'approved_drug_component', commercial_equivalent: true, on_fda_shortage: false, compounding_status_source: 'FDA, 2026-10-01', compounding_status_reviewed_at: '2026-10-01T00:00:00Z' },
]
const HISTORY = [
  { history_id: 'h1', ingredient_id: 'i3', changed_at: '2026-10-01T00:00:00Z', changed_by: 'u-ops', source: 'FDA, 2026-10-01', old_status: 'unverified', new_status: 'approved_drug_component', ingredients: { common_name: 'Semaglutide' } },
]

function answer(c: ScriptedCall) {
  if (c.table === 'ingredients') return { data: INGREDIENTS }
  if (c.table === 'ingredient_compounding_history') return { data: HISTORY }
  return undefined
}

const html = async () => renderToStaticMarkup(await IngredientsPage())

beforeEach(() => {
  db = scriptedDb(answer)
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('lists every ingredient with its status, flags, source and review date', async () => {
  const out = await html()
  for (const n of ['BPC-157', 'NAD+', 'Semaglutide']) expect(out).toContain(n)
  expect(out).toContain('Pending FDA evaluation: may not be compounded')
  expect(out).toContain('Not verified: may not be ordered')
  expect(out).toContain('Component of an FDA-approved drug')
  expect(out).toContain('demo data, not verified')
  expect(out).toContain('2026-10-01')
})

it('counts and marks the ingredients that cannot be ordered', async () => {
  const out = await html()
  expect(out).toContain('data-testid="ingredients-blocked-count"')
  expect(out).toMatch(/data-testid="ingredients-blocked-count"[^>]*>2 of 3</)
  expect(out).toContain('data-testid="ingredient-blocked-i1"')
  expect(out).toContain('data-testid="ingredient-blocked-i2"')
  expect(out).not.toContain('data-testid="ingredient-blocked-i3"')
})

it('offers the edit controls for each ingredient', async () => {
  const out = await html()
  expect(out.match(/Save review/g)).toHaveLength(3)
  expect(out).toContain('Source (required)')
})

it('shows recent changes from the audit log', async () => {
  const out = await html()
  expect(out).toContain('data-testid="ingredient-history"')
  expect(out).toContain('Semaglutide: unverified → approved_drug_component')
})

it('a read that fails says so', async () => {
  db = scriptedDb(c => (c.table === 'ingredients' ? DB_DOWN : answer(c)))
  const out = await html()
  expect(out).toContain('data-testid="ingredients-error"')
  expect(out).not.toContain('Save review')
})
