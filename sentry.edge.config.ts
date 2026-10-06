import * as Sentry from '@sentry/nextjs'
import { phiBeforeSend, phiBeforeBreadcrumb } from '@/lib/sentry/phi-scrubber'

// Sentry Edge Runtime initialization (middleware, edge API routes).
// Same PHI scrubbing rules apply — phiBeforeSend is mandatory.

Sentry.init({
  dsn: process.env['NEXT_PUBLIC_SENTRY_DSN'],

  // Associate errors with the exact Git commit deployed (required for source map correlation)
  release: process.env['VERCEL_GIT_COMMIT_SHA'],

  tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.1 : 1.0,

  beforeSend: phiBeforeSend,
  beforeBreadcrumb: phiBeforeBreadcrumb,

  // Compliance C9: never attach IPs, cookies or request bodies automatically.
  sendDefaultPii: false,

  // No session replay, whatever the SDK's default integrations are.
  integrations: (defaults) => defaults.filter((i) => !i.name.startsWith('Replay')),

  debug: false,

  enabled: process.env['NODE_ENV'] === 'production',
})
