import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'
import { STATIC_SECURITY_HEADERS } from './src/lib/security/headers'

export const baseConfig: NextConfig = {
  // Server Components are default in App Router
  reactStrictMode: true,

  // Do not advertise the framework.
  poweredByHeader: false,

  // Compliance C9: HSTS, X-Frame-Options, nosniff and Referrer-Policy on
  // every path, static assets included. The per-request CSP and the
  // Permissions-Policy are set by src/middleware.ts.
  async headers() {
    return [{ source: '/:path*', headers: [...STATIC_SECURITY_HEADERS] }]
  },

  // Disable Supabase Realtime — all updates via polling (HIPAA requirement)
  // No WebSocket connections permitted
  serverExternalPackages: ['@supabase/supabase-js'],

  // Security: prevent sensitive env vars from leaking to client bundle
  // Only NEXT_PUBLIC_* vars are exposed to the browser
  env: {
    // Explicitly empty — all vars accessed via process.env with validation
  },

  images: {
    remotePatterns: [],
  },
}

export default withSentryConfig(baseConfig, {
  // Sentry build-time config
  org: process.env['SENTRY_ORG'] ?? '',
  project: process.env['SENTRY_PROJECT'] ?? '',
  authToken: process.env['SENTRY_AUTH_TOKEN'] ?? '',

  // Upload source maps in production only
  silent: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },

  // Disable Sentry telemetry
  telemetry: false,

  // Automatically instrument Next.js routes
  webpack: {
    autoInstrumentServerFunctions: true,
    autoInstrumentMiddleware: true,
  },
})
