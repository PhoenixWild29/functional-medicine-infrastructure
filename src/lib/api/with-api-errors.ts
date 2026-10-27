// ============================================================
// Route handlers: a thrown error becomes a JSON 500, never a blank body
// ============================================================
//
// Next.js answers an uncaught throw in a route handler with an empty 500.
// The client's res.json() then fails too, and the page shows nothing useful.
// Every async handler under src/app/api is wrapped with withApiErrors (pinned
// by src/app/api/__tests__/route-error-wrapper.test.ts), so a thrown error
// returns the stable shape every route already uses for its own refusals:
//
//   500 { error: 'Something went wrong. Please try again.', code: 'INTERNAL_ERROR' }
//
// The thrown message is never sent to the client (it can be a raw database
// error). It is logged, and reported to Sentry (whose beforeSend scrubs
// PHI). Next's own control-flow errors (redirect(), notFound(), dynamic
// rendering bail-outs) are rethrown untouched.

import * as Sentry from '@sentry/nextjs'
import { unstable_rethrow } from 'next/navigation'
import { NextResponse } from 'next/server'

export const INTERNAL_ERROR_MESSAGE = 'Something went wrong. Please try again.'
export const INTERNAL_ERROR_CODE = 'INTERNAL_ERROR'

export function internalErrorResponse(): NextResponse {
  return NextResponse.json(
    { error: INTERNAL_ERROR_MESSAGE, code: INTERNAL_ERROR_CODE },
    { status: 500, headers: { 'Cache-Control': 'no-store' } },
  )
}

export function withApiErrors<A extends unknown[], R extends Response>(
  route: string,
  handler: (...args: A) => Promise<R>,
): (...args: A) => Promise<R | NextResponse> {
  return async (...args: A) => {
    try {
      return await handler(...args)
    } catch (err) {
      unstable_rethrow(err)
      const method = args[0] instanceof Request ? args[0].method : 'unknown'
      const name = err instanceof Error ? err.name : typeof err
      console.error(`[api] unhandled error | route=${route} method=${method} error=${name}`)
      Sentry.captureException(err, { tags: { route, method } })
      return internalErrorResponse()
    }
  }
}
