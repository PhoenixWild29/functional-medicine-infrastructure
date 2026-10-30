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

  // Application
  appBaseUrl: () => requireEnv('APP_BASE_URL'),   // e.g. https://app.compoundiq.com

  // Alerting — Slack
  slackWebhookUrl: () => requireEnv('SLACK_WEBHOOK_URL'),
  slackBotToken: () => requireEnv('SLACK_BOT_TOKEN'),
  slackSigningSecret: () => requireEnv('SLACK_SIGNING_SECRET'),
  slackOpsAlertsChannelId: () => requireEnv('SLACK_OPS_ALERTS_CHANNEL_ID'),
  slackOpsManagerUserId: () => requireEnv('SLACK_OPS_MANAGER_USER_ID'),

  // Alerting — PagerDuty
  pagerdutyRoutingKey: () => requireEnv('PAGERDUTY_ROUTING_KEY'),

  // Adapter
  adapterTimeoutMs: () => parseInt(requireEnv('ADAPTER_TIMEOUT_MS'), 10),
  retryMaxAttempts: () => parseInt(requireEnv('RETRY_MAX_ATTEMPTS'), 10),
  circuitBreakerThreshold: () => parseFloat(requireEnv('CIRCUIT_BREAKER_THRESHOLD')),
  playwrightHeadless: () => requireEnv('PLAYWRIGHT_HEADLESS') === 'true',

  // Kill switch: nothing is sent to a pharmacy (API, portal or fax) unless
  // this is exactly "true". Unset means OFF. See lib/adapters/submission-switch.
  pharmacySubmissionsEnabled: () => process.env['PHARMACY_SUBMISSIONS_ENABLED'] === 'true',

  // Compliance C10: retention jobs delete, null or anonymize nothing
  // unless this is exactly "true". Unset means OFF (dry run, counts only).
  // See lib/retention/switch.
  retentionEnabled: (): boolean => process.env['RETENTION_ENABLED'] === 'true',

  // Compliance C3: multi-factor sign-in. OFF unless REQUIRE_MFA is exactly
  // 'true', so demo accounts and E2E keep signing in with a password until
  // the owner turns it on. MFA_ENFORCED_EMAILS (comma-separated) enforces
  // it for named accounts only, e.g. the dedicated E2E user.
  requireMfa: (): boolean => process.env['REQUIRE_MFA'] === 'true',
  mfaEnforcedEmails: (): string[] =>
    (process.env['MFA_ENFORCED_EMAILS'] ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean),

  // HIPAA B7 (B's review T1, D's verification): the key of the prescription
  // signature binding (lib/orders/signature-binding). null when unset;
  // never logged. RX_BINDING_SECRET_PREVIOUS (optional) is the key before a
  // rotation: it verifies, it never signs. docs/ops/rx-binding-key.md.
  rxBindingSecret: (): string | null => process.env['RX_BINDING_SECRET'] || null,
  rxBindingSecretPrevious: (): string | null => process.env['RX_BINDING_SECRET_PREVIOUS'] || null,
  // ISO time before which an order signed by the pre-binding code is
  // accepted as legacy. Unset: no order is (set it to this code's deploy time).
  rxLegacyCutoff: (): string | null => process.env['RX_LEGACY_CUTOFF']?.trim() || null,

  // Any Vercel deployment: production, preview or vercel dev.
  isVercelDeployment: (): boolean => Boolean(process.env['VERCEL'] || process.env['VERCEL_ENV']),

  // HIPAA automatic logoff (an addressable safeguard; the rule sets no
  // time): minutes of inactivity before sign-out. Default 30 (Sam, Oct 30:
  // no stricter than required); anything that is not a positive whole
  // number is 30.
  idleTimeoutMinutes: (): number => {
    const raw = (process.env['IDLE_TIMEOUT_MINUTES'] ?? '').trim()
    if (!/^\d+$/.test(raw)) return 30
    const minutes = parseInt(raw, 10)
    return minutes > 0 ? minutes : 30
  },
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
