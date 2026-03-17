// Environment variable access with runtime validation.
// Server-side vars: accessed only in Server Components, API routes, middleware.
// Client-side vars: NEXT_PUBLIC_ prefix, safe to expose to browser.

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

// ------------------------------------------------------------
// SERVER-SIDE ONLY — never import these in Client Components
// ------------------------------------------------------------
export const serverEnv = {
  // Supabase
  supabaseUrl: () => requireEnv('SUPABASE_URL'),
  supabaseServiceRoleKey: () => requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  databaseUrl: () => requireEnv('DATABASE_URL'),

  // Stripe (server)
  stripeSecretKey: () => requireEnv('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: () => requireEnv('STRIPE_WEBHOOK_SECRET'),

  // Twilio
  twilioAccountSid: () => requireEnv('TWILIO_ACCOUNT_SID'),
  twilioAuthToken: () => requireEnv('TWILIO_AUTH_TOKEN'),
  twilioPhoneNumber: () => requireEnv('TWILIO_PHONE_NUMBER'),
  twilioWebhookSecret: () => requireEnv('TWILIO_WEBHOOK_SECRET'),

  // Documo
  documoApiKey: () => requireEnv('DOCUMO_API_KEY'),
  documoAccountId: () => requireEnv('DOCUMO_ACCOUNT_ID'),
  documoOutboundFaxNumber: () => requireEnv('DOCUMO_OUTBOUND_FAX_NUMBER'),
  documoWebhookSecret: () => requireEnv('DOCUMO_WEBHOOK_SECRET'),

  // Auth
  jwtSecret: () => requireEnv('JWT_SECRET'),
  checkoutTokenExpiry: () => parseInt(requireEnv('CHECKOUT_TOKEN_EXPIRY'), 10),

  // Monitoring
  sentryAuthToken: () => requireEnv('SENTRY_AUTH_TOKEN'),

  // Alerting
  slackWebhookUrl: () => requireEnv('SLACK_WEBHOOK_URL'),
  slackOpsAlertsChannelId: () => requireEnv('SLACK_OPS_ALERTS_CHANNEL_ID'),
  pagerdutyRoutingKey: () => requireEnv('PAGERDUTY_ROUTING_KEY'),

  // Adapter
  adapterTimeoutMs: () => parseInt(requireEnv('ADAPTER_TIMEOUT_MS'), 10),
  retryMaxAttempts: () => parseInt(requireEnv('RETRY_MAX_ATTEMPTS'), 10),
  circuitBreakerThreshold: () => parseFloat(requireEnv('CIRCUIT_BREAKER_THRESHOLD')),
  playwrightHeadless: () => requireEnv('PLAYWRIGHT_HEADLESS') === 'true',
} as const

// ------------------------------------------------------------
// CLIENT-SIDE — safe to use in Client Components and browser
// ------------------------------------------------------------
export const clientEnv = {
  supabaseUrl: process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '',
  supabaseAnonKey: process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '',
  stripePublishableKey: process.env['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'] ?? '',
  sentryDsn: process.env['NEXT_PUBLIC_SENTRY_DSN'] ?? '',
} as const
