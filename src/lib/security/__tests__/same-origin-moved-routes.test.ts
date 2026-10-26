/**
 * @jest-environment node
 *
 * L6 follow-up (Oct 24 security review): the routes that carried their own
 * inline Sec-Fetch-Site check use lib/security/same-origin refuseCrossSite.
 * Same rule as every other write: "same-site" and "cross-site" are refused
 * with 403 before any session is read; "same-origin", "none" or no header
 * pass. Each route keeps the 403 wording it had.
 *
 * The Keragon connection routes used to refuse only "cross-site"; like the
 * pharmacy onboarding writes (D, L6), they now refuse "same-site" too.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'

const sessionRead = jest.fn(() => { throw new Error('the session was read before the same-origin check') })
jest.mock('@/lib/supabase/server', () => ({ createServerClient: () => sessionRead() }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => { throw new Error('the service client was made before the same-origin check') } }))
jest.spyOn(console, 'error').mockImplementation(() => {})
// group-and-send checks its feature flag first (503 when off), as before.
process.env['PHASE_C_GROUPS_ENABLED'] = 'true'

const ID = '11111111-1111-4111-8111-111111111111'
const NOT_PERMITTED = 'Cross-site requests are not permitted'

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
type Route = [name: string, method: string, load: () => Promise<Handler>, params: Record<string, string>, wording: string]
const ROUTES: Route[] = [
  ['POST /api/orders/[orderId]/checkout-link', 'POST', async () => (await import('@/app/api/orders/[orderId]/checkout-link/route')).POST as unknown as Handler, { orderId: ID }, NOT_PERMITTED],
  ['POST /api/orders/[orderId]/group-and-send', 'POST', async () => (await import('@/app/api/orders/[orderId]/group-and-send/route')).POST as unknown as Handler, { orderId: ID }, NOT_PERMITTED],
  ['POST /api/orders/batch-sign', 'POST', async () => (await import('@/app/api/orders/batch-sign/route')).POST as unknown as Handler, {}, NOT_PERMITTED],
  ['DELETE /api/patients/[patientId]/duplicate-flag', 'DELETE', async () => (await import('@/app/api/patients/[patientId]/duplicate-flag/route')).DELETE as unknown as Handler, { patientId: ID }, NOT_PERMITTED],
  ['POST /api/patients/[patientId]/intake-link', 'POST', async () => (await import('@/app/api/patients/[patientId]/intake-link/route')).POST as unknown as Handler, { patientId: ID }, NOT_PERMITTED],
  ['POST /api/patients/face-sheet', 'POST', async () => (await import('@/app/api/patients/face-sheet/route')).POST as unknown as Handler, {}, NOT_PERMITTED],
  ['POST /api/patients', 'POST', async () => (await import('@/app/api/patients/route')).POST as unknown as Handler, {}, NOT_PERMITTED],
  ['POST /api/patients/import', 'POST', async () => (await import('@/app/api/patients/import/route')).POST as unknown as Handler, {}, NOT_PERMITTED],
  ['POST /api/patients/import/parse', 'POST', async () => (await import('@/app/api/patients/import/parse/route')).POST as unknown as Handler, {}, NOT_PERMITTED],
  ['POST /api/patients/import/validate', 'POST', async () => (await import('@/app/api/patients/import/validate/route')).POST as unknown as Handler, {}, NOT_PERMITTED],
  ['POST /api/settings/signup-link', 'POST', async () => (await import('@/app/api/settings/signup-link/route')).POST as unknown as Handler, {}, NOT_PERMITTED],
  ['POST /api/team/invites', 'POST', async () => (await import('@/app/api/team/invites/route')).POST as unknown as Handler, {}, NOT_PERMITTED],
  ['POST /api/team/invites/[inviteId]', 'POST', async () => (await import('@/app/api/team/invites/[inviteId]/route')).POST as unknown as Handler, { inviteId: ID }, NOT_PERMITTED],
  ['POST /api/team/members/[userId]', 'POST', async () => (await import('@/app/api/team/members/[userId]/route')).POST as unknown as Handler, { userId: ID }, NOT_PERMITTED],
  ['POST /api/team/providers', 'POST', async () => (await import('@/app/api/team/providers/route')).POST as unknown as Handler, {}, NOT_PERMITTED],
  ['DELETE /api/integrations/keragon/connection', 'DELETE', async () => (await import('@/app/api/integrations/keragon/connection/route')).DELETE as unknown as Handler, {}, 'Forbidden'],
  ['POST /api/integrations/keragon/connection/secret', 'POST', async () => (await import('@/app/api/integrations/keragon/connection/secret/route')).POST as unknown as Handler, {}, 'Forbidden'],
]

describe.each(ROUTES)('%s', (_name, method, load, params, wording) => {
  it.each(['same-site', 'cross-site'])('Sec-Fetch-Site %s: 403 with its wording, before any session read', async site => {
    sessionRead.mockClear()
    const handler = await load()
    const req = new NextRequest('https://app.test/api/x', { method, headers: { 'sec-fetch-site': site, 'content-type': 'application/json' }, body: '{}' })
    const res = await handler(req, { params: Promise.resolve(params) })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: wording })
    expect(sessionRead).not.toHaveBeenCalled()
  })

  it('Sec-Fetch-Site same-origin: not refused here (the route goes on to read the session)', async () => {
    sessionRead.mockClear()
    const handler = await load()
    const req = new NextRequest('https://app.test/api/x', { method, headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: '{}' })
    await handler(req, { params: Promise.resolve(params) }).catch(() => undefined)
    expect(sessionRead).toHaveBeenCalled()
  })
})

it('the face-sheet refusal keeps its no-store header', async () => {
  const { POST } = await import('@/app/api/patients/face-sheet/route')
  const res = await (POST as unknown as Handler)(new NextRequest('https://app.test/api/patients/face-sheet', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } }), { params: Promise.resolve({}) })
  expect(res.status).toBe(403)
  expect(res.headers.get('cache-control')).toBe('no-store')
})

it('intake-link GET is a read: not refused on Sec-Fetch-Site', async () => {
  sessionRead.mockClear()
  const { GET } = await import('@/app/api/patients/[patientId]/intake-link/route')
  const req = new NextRequest(`https://app.test/api/patients/${ID}/intake-link`, { method: 'GET', headers: { 'sec-fetch-site': 'cross-site' } })
  await (GET as unknown as Handler)(req, { params: Promise.resolve({ patientId: ID }) }).catch(() => undefined)
  expect(sessionRead).toHaveBeenCalled()
})

it('no route or library reads Sec-Fetch-Site itself any more', () => {
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') walk(full); continue }
      if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name)) continue
      if (full.endsWith(join('lib', 'security', 'same-origin.ts'))) continue
      if (/\.get\(\s*['"]sec-fetch-site['"]/i.test(readFileSync(full, 'utf8'))) offenders.push(full)
    }
  }
  walk(join(process.cwd(), 'src'))
  expect(offenders).toEqual([])
})
