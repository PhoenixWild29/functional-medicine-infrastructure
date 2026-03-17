import type { NextConfig } from 'next'

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

export default nextConfig
