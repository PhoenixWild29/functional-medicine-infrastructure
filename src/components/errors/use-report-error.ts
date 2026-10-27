'use client'

// Reports an error caught by an error boundary: to Sentry (its beforeSend
// scrubs PHI) and to the console by name and digest only, never the
// message, which can carry a raw database error.

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export function useReportError(error: Error & { digest?: string }, boundary: string) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { boundary } })
    console.error(`[${boundary}] error boundary | error=${error.name}${error.digest ? ` digest=${error.digest}` : ''}`)
  }, [error, boundary])
}
