import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const nextConfig: NextConfig = {
  // Server Components are default in App Router
  reactStrictMode: true,

  // Disable Supabase Realtime — all updates via polling (HIPAA requirement)
  // No WebSocket connections permitted
  experimental: {
    serverComponentsExternalPackages: ['@supabase/supabase-js'],
  },

  // Security: prevent sensitive env vars from leaking to client bundle
  // Only NEXT_PUBLIC_* vars are exposed to the browser
  env: {
    // Explicitly empty — all vars accessed via process.env with validation
  },

  images: {
    remotePatterns: [],
  },
}

export default withSentryConfig(nextConfig, {
  // Sentry build-time config
  org: process.env['SENTRY_ORG'],
  project: process.env['SENTRY_PROJECT'],
  authToken: process.env['SENTRY_AUTH_TOKEN'],

  // Upload source maps in production only
  silent: true,
  hideSourceMaps: true,

  // Disable Sentry telemetry
  telemetry: false,

  // Automatically instrument Next.js routes
  autoInstrumentServerFunctions: true,
  autoInstrumentMiddleware: true,
})
