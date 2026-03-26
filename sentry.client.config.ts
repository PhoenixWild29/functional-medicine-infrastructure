import * as Sentry from '@sentry/nextjs'
import { phiBeforeSend } from '@/lib/sentry/phi-scrubber'

// Sentry client-side initialization.
// PHI scrubbing is MANDATORY — phiBeforeSend runs on every event before transmission.
// DSN is NEXT_PUBLIC_ scoped — safe to expose (it's a write-only ingest key).

Sentry.init({
  dsn: process.env['NEXT_PUBLIC_SENTRY_DSN'],

  // Associate errors with the exact Git commit deployed (required for source map correlation)
  release: process.env['NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA'],

  // Capture 10% of transactions in production (consistent with server/edge configs)
  tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.1 : 1.0,

  // Do not capture replays — session replay captures form inputs and may contain PHI
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // PHI scrubbing — runs before every event is sent to Sentry
  beforeSend: phiBeforeSend,

  // Suppress console noise in development
  debug: false,

  // Do not send events from localhost in development
  enabled: process.env['NODE_ENV'] === 'production',
})
