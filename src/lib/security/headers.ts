// ============================================================
// Security headers — Compliance C9
// ============================================================
//
// Two layers, so every response is covered:
//
//   1. STATIC_SECURITY_HEADERS (next.config.ts headers(), every path,
//      static assets included): HSTS, X-Frame-Options, nosniff,
//      Referrer-Policy. These never vary by page.
//
//   2. buildCsp() + permissionsPolicy() (src/middleware.ts, every page and
//      API response the middleware sees): an ENFORCED Content-Security-
//      Policy with a fresh nonce per request, and a Permissions-Policy.
//      Both vary by area: only patient checkout may load Stripe.js, frame
//      Stripe, or use the payment feature.
//
// Scripts: 'self' plus the per-request nonce. Never 'unsafe-inline'. The
// nonce reaches Next.js through the request's content-security-policy
// header (middleware forwards it), and Next stamps it on every script it
// renders. That only works for dynamically rendered pages, which is why the
// root layout calls connection(). 'unsafe-eval' is added in development
// only (React's dev tooling needs it).
//
// Styles: 'unsafe-inline' stays for style-src. React renders style={{…}}
// as inline style attributes throughout the app, and Stripe Elements
// injects styles. Inline STYLE cannot run code; inline SCRIPT is what the
// policy forbids.
//
// Allowed outside origins, and nothing else:
//   - Supabase (NEXT_PUBLIC_SUPABASE_URL): browser auth/API calls, storage images
//   - Sentry ingest (origin of NEXT_PUBLIC_SENTRY_DSN): error reports
//   - Stripe, on /checkout only: js.stripe.com (script + frames),
//     hooks.stripe.com (3-D Secure frames), api.stripe.com (Elements API)
// No analytics, tracking or replay host is allowed anywhere.

export const STATIC_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  // Two years, all subdomains. Not 'preload': submitting the domain to the
  // browser preload list is a separate, hard-to-reverse owner decision.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Frame-Options',           value: 'DENY' },
  { key: 'X-Content-Type-Options',    value: 'nosniff' },
  { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
]

const STRIPE = {
  script:  ['https://js.stripe.com', 'https://*.js.stripe.com'],
  frame:   ['https://js.stripe.com', 'https://*.js.stripe.com', 'https://hooks.stripe.com'],
  connect: ['https://api.stripe.com'],
  img:     ['https://*.stripe.com'],
}

/** Patient checkout: the only area that loads Stripe. */
export function isCheckoutPath(pathname: string): boolean {
  return pathname === '/checkout' || pathname.startsWith('/checkout/')
}

/**
 * Paths that may use the camera. EMPTY on purpose: no page needs it yet.
 * The planned license-scan page will need camera=(self); add its path here
 * (and only its path) when it lands, with a test.
 */
const CAMERA_PATHS: ReadonlyArray<string> = []

function originOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** 16 random bytes, base64. Edge-safe (no Buffer). */
export function newNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export function buildCsp(params: { nonce: string; pathname: string; dev?: boolean; secure?: boolean }): string {
  const { nonce, pathname } = params
  const dev = params.dev ?? process.env.NODE_ENV === 'development'
  const checkout = isCheckoutPath(pathname)

  const supabase = originOf(process.env['NEXT_PUBLIC_SUPABASE_URL'])
  const sentry   = originOf(process.env['NEXT_PUBLIC_SENTRY_DSN'])
  const own = (...xs: Array<string | null>) => xs.filter((x): x is string => Boolean(x))

  const directives: Record<string, string[]> = {
    'default-src':     ["'self'"],
    'script-src':      ["'self'", `'nonce-${nonce}'`, ...(dev ? ["'unsafe-eval'"] : []), ...(checkout ? STRIPE.script : [])],
    'style-src':       ["'self'", "'unsafe-inline'"],
    'img-src':         ["'self'", 'data:', 'blob:', ...own(supabase), ...(checkout ? STRIPE.img : [])],
    'font-src':        ["'self'", 'data:'],
    'connect-src':     ["'self'", ...own(supabase, sentry), ...(checkout ? STRIPE.connect : []), ...(dev ? ['ws:'] : [])],
    'frame-src':       checkout ? STRIPE.frame : ["'none'"],
    'frame-ancestors': ["'none'"],
    'object-src':      ["'none'"],
    'base-uri':        ["'self'"],
    'form-action':     ["'self'"],
  }

  const policy = Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`)
  // Only for a page served over https (production, previews; HSTS already
  // keeps those on https). On plain http — a local or E2E production build
  // on http://localhost — WebKit applies it to localhost and rewrites every
  // /_next script, CSS file and font to https://localhost, which fails: no
  // page hydrates (#195 E2E, cut off at 15 min).
  if (!dev && params.secure === true) policy.push('upgrade-insecure-requests')
  return policy.join('; ')
}

export function permissionsPolicy(pathname: string): string {
  const camera = CAMERA_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`)) ? '(self)' : '()'
  // Stripe's PaymentElement offers Apple Pay / Google Pay from its iframe,
  // which needs the payment feature delegated to js.stripe.com.
  const payment = isCheckoutPath(pathname) ? '(self "https://js.stripe.com")' : '()'
  return [
    `camera=${camera}`,
    'microphone=()',
    'geolocation=()',
    `payment=${payment}`,
    'usb=()',
    'serial=()',
    'hid=()',
    'bluetooth=()',
    'midi=()',
    'magnetometer=()',
    'gyroscope=()',
    'accelerometer=()',
    'display-capture=()',
    'browsing-topics=()',
  ].join(', ')
}
