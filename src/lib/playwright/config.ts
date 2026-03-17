import type { BrowserContextOptions, LaunchOptions } from 'playwright'
import { serverEnv } from '@/lib/env'

// Playwright browser launch config for Tier 2 portal automation.
// Headless: true in production (PLAYWRIGHT_HEADLESS=true), may be false in local dev.
// Timeout: 30s max per portal submission (matches ADAPTER_TIMEOUT_MS).
//
// Screenshots: stored in Supabase Storage bucket "adapter-screenshots" with 72h auto-delete.
// Credentials: retrieved from Supabase Vault using username_vault_id / password_vault_id
//              from pharmacy_portal_configs — never hardcoded.

export const PLAYWRIGHT_TIMEOUT_MS = 30_000

export function getBrowserLaunchOptions(): LaunchOptions {
  return {
    headless: serverEnv.playwrightHeadless(),
    timeout: PLAYWRIGHT_TIMEOUT_MS,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', // prevent OOM crashes in containerized environments
    ],
  }
}

export function getBrowserContextOptions(): BrowserContextOptions {
  return {
    // Disable permissions that pharmacies don't need
    permissions: [],
    // Block geolocation to avoid leaking server location
    geolocation: undefined,
    // Use a realistic viewport
    viewport: { width: 1280, height: 900 },
    // Ignore HTTPS errors only in dev — never in production
    ignoreHTTPSErrors: process.env['NODE_ENV'] !== 'production',
  }
}

// Screenshot storage config — Supabase Storage bucket
export const SCREENSHOT_BUCKET = 'adapter-screenshots'
// Supabase Storage lifecycle rule: 72h auto-delete (configure in Supabase dashboard)
export const SCREENSHOT_TTL_HOURS = 72
