import * as Sentry from '@sentry/nextjs'
import { phiBeforeSend } from '@/lib/sentry/phi-scrubber'

// Sentry Edge Runtime initialization (middleware, edge API routes).
// Same PHI scrubbing rules apply — phiBeforeSend is mandatory.

Sentry.init({
  dsn: process.env['NEXT_PUBLIC_SENTRY_DSN'],

  tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.1 : 1.0,

  beforeSend: phiBeforeSend,

  debug: false,

  enabled: process.env['NODE_ENV'] === 'production',
})
