/**
 * @jest-environment node
 *
 * lib/api/input: the shared zod (v4) parsing for route handlers. Bad input
 * is a 400 with a short reason, never a thrown 500, and the reply never
 * echoes the submitted values (they can be PHI).
 */

import { z } from 'zod'
import { NextRequest } from 'next/server'
import { uuid, boundedText, parseJsonBody, parseParams, parseQuery, parseInput, UUID_RE } from '../input'

const ID = '45e03578-e208-468d-a35b-ab9bc82320ae'
const DEMO_ID = 'a4000000-0000-0000-0000-000000000001'   // seeded ids are not RFC 4122 v4

function post(body: string) {
  return new NextRequest('http://localhost/api/x', { method: 'POST', body, headers: { 'content-type': 'application/json' } })
}

describe('uuid()', () => {
  it('accepts any 8-4-4-4-12 hex id, including the seeded demo ids', () => {
    expect(uuid().safeParse(ID).success).toBe(true)
    expect(uuid().safeParse(DEMO_ID).success).toBe(true)
    expect(UUID_RE.test(DEMO_ID)).toBe(true)
  })
  it.each(['', 'not-a-uuid', `${ID}x`, "1' or '1'='1", 42, null])('rejects %p', v => {
    expect(uuid().safeParse(v).success).toBe(false)
  })
})

describe('boundedText()', () => {
  it('trims and bounds', () => {
    expect(boundedText(5).parse('  abc  ')).toBe('abc')
    expect(boundedText(5).safeParse('abcdef').success).toBe(false)
  })
})

describe('parseJsonBody()', () => {
  const schema = z.object({ orderId: uuid(), note: boundedText(10).optional() })

  it('returns the parsed data', async () => {
    const r = await parseJsonBody(post(JSON.stringify({ orderId: ID, note: 'hi' })), schema)
    expect(r).toEqual({ ok: true, data: { orderId: ID, note: 'hi' } })
  })

  it('invalid JSON is a 400, not a throw', async () => {
    const r = await parseJsonBody(post('{nope'), schema)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.response.status).toBe(400)
      expect(await r.response.json()).toEqual({ error: 'Invalid JSON body' })
    }
  })

  it('a schema failure is a 400 naming the fields, without echoing values', async () => {
    const r = await parseJsonBody(post(JSON.stringify({ orderId: 'SECRET-NAME', note: 'x'.repeat(50) })), schema)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.response.status).toBe(400)
      const body = await r.response.json()
      expect(body.error).toBe('Invalid request')
      expect(body.fields).toEqual(expect.arrayContaining(['orderId', 'note']))
      expect(JSON.stringify(body)).not.toContain('SECRET-NAME')
    }
  })
})

describe('parseParams()', () => {
  it('a bad id param is a 400', async () => {
    const r = await parseParams({ params: Promise.resolve({ orderId: 'abc' }) }, z.object({ orderId: uuid() }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(400)
  })
  it('a good id passes', async () => {
    expect(await parseParams({ params: Promise.resolve({ orderId: ID }) }, z.object({ orderId: uuid() })))
      .toEqual({ ok: true, data: { orderId: ID } })
  })
})

describe('parseQuery()', () => {
  it('reads search params into the schema', () => {
    const r = parseQuery(new URL(`http://x/?patientId=${ID}&q=ab`).searchParams, z.object({ patientId: uuid(), q: boundedText(5) }))
    expect(r).toEqual({ ok: true, data: { patientId: ID, q: 'ab' } })
  })
  it('a bad query is a 400', () => {
    const r = parseQuery(new URL('http://x/?patientId=zz').searchParams, z.object({ patientId: uuid() }))
    expect(r.ok).toBe(false)
  })
})

describe('parseInput()', () => {
  it('validates an already-read value', () => {
    expect(parseInput(z.object({ n: z.number().int().min(1).max(3) }), { n: 9 }).ok).toBe(false)
  })
})
