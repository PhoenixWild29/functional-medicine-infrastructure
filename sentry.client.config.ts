import * as Sentry from '@sentry/nextjs'
import { phiBeforeSend } from '@/lib/sentry/phi-scrubber'

// Sentry client-side initialization.
// PHI scrubbing is MANDATORY — phiBeforeSend runs on every event before transmission.
// DSN is NEXT_PUBLIC_ scoped — safe to expose (it's a write-only ingest key).

Sentry.init({
  dsn: process.env['NEXT_PUBLIC_SENTRY_DSN'],

  // Capture 5% of transactions in production to avoid excess quota usage
  tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.05 : 1.0,

  // Do not capture replays — session replay may capture PHI in form inputs
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // PHI scrubbing — runs before every event is sent to Sentry
  beforeSend: phiBeforeSend,

  // Suppress console noise in development
  debug: false,

  // Do not send events from localhost in development
  enabled: process.env['NODE_ENV'] === 'production',
})
