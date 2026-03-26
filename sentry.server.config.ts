import * as Sentry from '@sentry/nextjs'
import { phiBeforeSend } from '@/lib/sentry/phi-scrubber'

// Sentry server-side initialization.
// PHI scrubbing is MANDATORY — phiBeforeSend runs on every event before transmission.
//
// Never include in errors: Stripe metadata, Documo payloads, Twilio message bodies,
// pharmacy API responses, or Supabase Vault secret IDs.

Sentry.init({
  dsn: process.env['NEXT_PUBLIC_SENTRY_DSN'],

  // Associate errors with the exact Git commit deployed (required for source map correlation)
  release: process.env['VERCEL_GIT_COMMIT_SHA'],

  // Capture 10% of server-side transactions in production
  tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.1 : 1.0,

  // PHI scrubbing — runs before every event is sent to Sentry
  beforeSend: phiBeforeSend,

  debug: false,

  enabled: process.env['NODE_ENV'] === 'production',
})
