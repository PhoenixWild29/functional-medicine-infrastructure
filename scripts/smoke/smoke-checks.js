// ============================================================
// Pure checks for the prod public smoke (scripts/smoke/prod-public-smoke.mjs)
// ============================================================
//
// CommonJS (no "type" in package.json, so .js is CommonJS) so the .mjs script and Jest (src/__tests__/prod-public-smoke.test.ts)
// both load it. No network and no Playwright in here: argument parsing and
// the header, robots and page-text rules, each returning
// { ok, observed } so the script prints what it saw.

'use strict'

const USAGE = 'Usage: node scripts/smoke/prod-public-smoke.mjs --base https://functional-medicine-infrastructure.vercel.app'

/** `--base <url>` (or `--base=<url>`): an http(s) origin, without a trailing slash. */
function parseArgs(argv) {
  let base = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') return { help: true, usage: USAGE }
    if (a === '--base') { base = argv[i + 1] ?? null; i++; continue }
    if (a.startsWith('--base=')) { base = a.slice('--base='.length); continue }
    return { error: `Unknown argument: ${a}`, usage: USAGE }
  }
  if (!base) return { error: 'Missing --base', usage: USAGE }
  let url
  try { url = new URL(base) } catch { return { error: `Not a URL: ${base}`, usage: USAGE } }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: `Not an http(s) URL: ${base}`, usage: USAGE }
  if (url.pathname !== '/' || url.search || url.hash) return { error: `--base must be an origin only (no path or query): ${base}`, usage: USAGE }
  return { base: url.origin }
}

const show = v => (v === null || v === undefined ? '(absent)' : String(v))

/** An enforced CSP whose script-src carries a per-request nonce. */
function checkCsp(value) {
  const scriptSrc = (value ?? '').split(';').map(s => s.trim()).find(s => s.startsWith('script-src ')) ?? ''
  return { ok: /'nonce-[A-Za-z0-9+/=_-]{8,}'/.test(scriptSrc) && !/'unsafe-inline'/.test(scriptSrc), observed: scriptSrc || show(value) }
}

/** HSTS: two years, all subdomains (src/lib/security/headers.ts). */
function checkHsts(value) {
  return { ok: /(^|;)\s*max-age=63072000\s*(;|$)/i.test(value ?? '') && /includeSubDomains/i.test(value ?? ''), observed: show(value) }
}

function checkFrameOptions(value) {
  return { ok: (value ?? '').trim().toUpperCase() === 'DENY', observed: show(value) }
}

/** One of the accepted Referrer-Policy values; `which` says which matched. */
function checkReferrer(value, accepted) {
  const v = (value ?? '').trim().toLowerCase()
  const which = accepted.find(a => a === v) ?? null
  return { ok: which !== null, which, observed: show(value) }
}

/** Cache-Control that keeps the page out of shared and browser caches. */
function checkNoStore(value) {
  const v = (value ?? '').toLowerCase()
  return { ok: /\bprivate\b/.test(v) && /\bno-store\b/.test(v), observed: show(value) }
}

/** noindex from the X-Robots-Tag header or the robots meta tag. */
function checkNoindex(header, metaContent) {
  const h = /\bnoindex\b/i.test(header ?? ''), m = /\bnoindex\b/i.test(metaContent ?? '')
  return { ok: h || m, header: h, meta: m, observed: `X-Robots-Tag=${show(header)}; meta robots=${show(metaContent)}` }
}

/** robots.txt: every path disallowed for User-agent: *. */
function checkRobotsTxt(text, paths) {
  const lines = (text ?? '').split(/\r?\n/).map(l => l.trim())
  let inAll = false
  const disallowed = new Set()
  for (const l of lines) {
    const ua = /^user-agent:\s*(.+)$/i.exec(l)
    if (ua) { inAll = ua[1].trim() === '*'; continue }
    const d = /^disallow:\s*(.*)$/i.exec(l)
    if (d && inAll) disallowed.add(d[1].trim())
  }
  const missing = paths.filter(p => !disallowed.has(p))
  return { ok: missing.length === 0, missing, observed: `disallow: ${[...disallowed].join(' ') || '(none)'}` }
}

/** Anything that looks like a stack trace or a framework error page. */
function hasStackTrace(text) {
  return /Unhandled Runtime Error|Application error: a (client|server)-side exception|\n\s*at [\w.<>$]+ \(.*:\d+:\d+\)|Error: .*\n\s+at /.test(text ?? '')
}

/** One output line. */
function line(status, name, observed) {
  return `${status.padEnd(4)} ${name}${observed === undefined ? '' : `: ${observed}`}`
}

module.exports = { USAGE, parseArgs, checkCsp, checkHsts, checkFrameOptions, checkReferrer, checkNoStore, checkNoindex, checkRobotsTxt, hasStackTrace, line }
