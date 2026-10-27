/**
 * @jest-environment node
 *
 * withApiErrors: a thrown error in a route handler becomes the stable JSON
 * 500, never an empty body, and never carries the thrown message. Next's
 * control-flow errors (notFound(), redirect()) still reach Next.
 */

import { NextRequest, NextResponse } from 'next/server'
import { notFound, redirect } from 'next/navigation'

const captureException = jest.fn()
jest.mock('@sentry/nextjs', () => ({ captureException: (...a: unknown[]) => captureException(...a) }))

import { withApiErrors, INTERNAL_ERROR_MESSAGE } from '../with-api-errors'

const req = () => new NextRequest('https://app.test/api/x', { method: 'POST' })
let consoleError: jest.SpyInstance
beforeEach(() => {
  captureException.mockClear()
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => consoleError.mockRestore())

it('passes a normal response through unchanged', async () => {
  const handler = withApiErrors('/api/x', async () => NextResponse.json({ ok: true }, { status: 201 }))
  const res = await handler()
  expect(res.status).toBe(201)
  expect(await res.json()).toEqual({ ok: true })
})

it('a thrown error: 500 JSON in the stable shape, no-store, nothing of the message', async () => {
  const handler = withApiErrors('/api/x', async (): Promise<NextResponse> => {
    throw new Error('duplicate key value violates unique constraint "patients_pkey" for jane@example.com')
  })
  const res = await handler()
  expect(res.status).toBe(500)
  expect(res.headers.get('content-type')).toContain('application/json')
  expect(res.headers.get('cache-control')).toBe('no-store')
  const body = await res.json()
  expect(body).toEqual({ error: INTERNAL_ERROR_MESSAGE, code: 'INTERNAL_ERROR' })
  expect(JSON.stringify(body)).not.toContain('duplicate')
})

it('reports to Sentry with the route, and logs the route, method and error name only', async () => {
  const err = new TypeError('Cannot read properties of undefined (reading patient_id)')
  const handler = withApiErrors('/api/orders/[orderId]', async (r: NextRequest): Promise<NextResponse> => { throw Object.assign(err, { at: r.url }) })
  await handler(req())
  expect(captureException).toHaveBeenCalledWith(err, { tags: { route: '/api/orders/[orderId]', method: 'POST' } })
  const logged = consoleError.mock.calls.flat().join(' ')
  expect(logged).toBe('[api] unhandled error | route=/api/orders/[orderId] method=POST error=TypeError')
})

it('a thrown non-Error value is handled the same way', async () => {
  const res = await withApiErrors('/api/x', async (): Promise<NextResponse> => { throw 'boom' })()
  expect(res.status).toBe(500)
  expect(consoleError.mock.calls.flat().join(' ')).toContain('method=unknown error=string')
})

it("Next's notFound() and redirect() are rethrown for Next to handle", async () => {
  await expect(withApiErrors('/api/x', async (): Promise<NextResponse> => notFound())()).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK') })
  await expect(withApiErrors('/api/x', async (): Promise<NextResponse> => redirect('/login'))()).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
  expect(captureException).not.toHaveBeenCalled()
})

it('keeps the params argument (dynamic routes)', async () => {
  const handler = withApiErrors('/api/x/[id]', async (_r: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
    NextResponse.json({ id: (await ctx.params).id }))
  const res = await handler(req(), { params: Promise.resolve({ id: 'abc' }) })
  expect(await res.json()).toEqual({ id: 'abc' })
})
