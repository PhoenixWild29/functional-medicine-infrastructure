/**
 * @jest-environment node
 *
 * Compliance C9: no analytics, tracking or session-replay code on any
 * signed-in clinic or ops page or on patient checkout.
 *
 * Static guard over the source and the dependency list, so a tracker
 * cannot arrive in a later PR without this test failing:
 *   - no tracker / analytics / replay SDK in package.json;
 *   - no import of one anywhere in src (app, components, lib);
 *   - no next/script and no <script src=...> in any app route or shared
 *     component (the CSP would block a third-party one anyway; this makes
 *     the attempt fail in CI, not silently in a browser);
 *   - no Sentry Replay integration anywhere.
 *
 * Stripe.js is the one third-party script, loaded by @stripe/stripe-js
 * only from the checkout payment component.
 */

import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '..', '..')
const SRC = path.join(ROOT, 'src')

const TRACKER_PACKAGES = [
  '@vercel/analytics', '@vercel/speed-insights', 'posthog-js', 'posthog-node',
  '@segment/analytics-next', 'analytics-node', '@segment/analytics-node', 'react-ga', 'react-ga4',
  'react-gtm-module', '@next/third-parties', 'mixpanel-browser', '@amplitude/analytics-browser',
  'amplitude-js', '@fullstory/browser', 'logrocket', 'hotjar', 'react-hotjar', '@hotjar/browser',
  '@datadog/browser-rum', '@intercom/messenger-js-sdk', 'heap-api', '@heap/react', 'smartlook-client',
  '@microsoft/clarity', 'mouseflow',
]

const TRACKER_IMPORT = new RegExp(
  `from\\s+['"](${TRACKER_PACKAGES.map(p => p.replace(/[/\\^$*+?.()|[\]{}@-]/g, '\\$&')).join('|')})(/[^'"]*)?['"]`,
)
const TRACKER_HOSTS = /(googletagmanager\.com|google-analytics\.com|segment\.(io|com)|posthog\.com|hotjar\.com|fullstory\.com|clarity\.ms|mixpanel\.com|amplitude\.com|logrocket\.(io|com)|doubleclick\.net|facebook\.net|connect\.facebook)/

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      walk(full, out)
    } else if (/\.(tsx?|jsx?|mjs)$/.test(entry.name) && !/\.test\.(tsx?|jsx?)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

const sourceFiles = walk(SRC)
const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, '/')

describe('no third-party tracking', () => {
  it('no tracker, analytics or replay SDK is a dependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>; devDependencies?: Record<string, string>
    }
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    expect(deps.filter(d => TRACKER_PACKAGES.includes(d))).toEqual([])
  })

  it('no source file imports one', () => {
    const hits = sourceFiles.filter(f => TRACKER_IMPORT.test(fs.readFileSync(f, 'utf8'))).map(rel)
    expect(hits).toEqual([])
  })

  it('no source file references a tracking host', () => {
    const hits = sourceFiles.filter(f => TRACKER_HOSTS.test(fs.readFileSync(f, 'utf8'))).map(rel)
    expect(hits).toEqual([])
  })

  it('no app route or component loads a script tag (next/script or <script src>)', () => {
    const ui = sourceFiles.filter(f => /[\\/](app|components)[\\/]/.test(f))
    const hits = ui.filter(f => {
      const text = fs.readFileSync(f, 'utf8')
      return /from\s+['"]next\/script['"]/.test(text) || /<script[^>]*\bsrc=/i.test(text)
    }).map(rel)
    expect(hits).toEqual([])
  })

  it('no Sentry session replay anywhere (configs included)', () => {
    const files = [
      ...sourceFiles,
      ...['sentry.client.config.ts', 'sentry.server.config.ts', 'sentry.edge.config.ts', 'instrumentation-client.ts', 'instrumentation.ts']
        .map(f => path.join(ROOT, f)).filter(f => fs.existsSync(f)),
    ]
    const hits = files.filter(f => /replayIntegration|new\s+Replay\(|replayCanvasIntegration/.test(fs.readFileSync(f, 'utf8'))).map(rel)
    expect(hits).toEqual([])
  })

  it('Stripe.js is loaded only by the checkout payment component', () => {
    const hits = sourceFiles.filter(f => /from\s+['"]@stripe\/(stripe-js|react-stripe-js)['"]/.test(fs.readFileSync(f, 'utf8'))).map(rel)
    // src/__type-checks__ holds compile-time SDK type smoke tests (WO-92); never bundled.
    for (const f of hits) expect(f).toMatch(/^src\/(app\/checkout|__type-checks__)\//)
  })
})
