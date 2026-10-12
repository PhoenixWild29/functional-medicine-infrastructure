/**
 * @jest-environment node
 *
 * The public legal pages:
 * - are public in middleware (trailing-slash convention, like '/onboard/'),
 *   so a visitor with no session is never sent to /login and no auth
 *   client is built for them;
 * - never use dangerouslySetInnerHTML anywhere on their render path.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

jest.mock('@/lib/auth/checkout-token', () => ({ verifyCheckoutToken: jest.fn() }))
jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(() => ({ auth: { getUser: async () => ({ data: { user: null } }) } })),
}))
process.env['NEXT_PUBLIC_SUPABASE_URL']      = 'http://localhost'
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon'

import { middleware } from '../middleware'

const ROOT = process.cwd()
const req = (path: string) => new NextRequest(new URL(`http://localhost${path}`), { method: 'GET' })

describe('middleware', () => {
  beforeEach(() => jest.clearAllMocks())

  it.each(['/legal/privacy', '/legal/patient-terms'])('%s is public: no redirect, no auth client', async path => {
    const res = await middleware(req(path))
    expect(res.headers.get('location')).toBeNull()
    expect(res.status).toBe(200)
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('lists the legal pages with a trailing slash, as the other prefixes', () => {
    const src = readFileSync(join(ROOT, 'src', 'middleware.ts'), 'utf8')
    expect(src).toMatch(/const publicRoutes = \[[^\]]*'\/legal\/'/)
  })

  it('a path that only starts with "/legal" is still gated', async () => {
    const res = await middleware(req('/legalese'))
    expect(res.headers.get('location')).toContain('/login')
  })
})

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
}

it('no dangerouslySetInnerHTML on the legal pages, the footer or LegalMarkdown', () => {
  const paths = [
    ...files(join(ROOT, 'src', 'app', 'legal')),
    ...files(join(ROOT, 'src', 'components', 'legal')),
    join(ROOT, 'src', 'components', 'onboarding', 'legal-markdown.tsx'),
    join(ROOT, 'src', 'lib', 'legal', 'public-documents.ts'),
  ].filter(p => /\.(ts|tsx)$/.test(p) && !/__tests__/.test(p))
  expect(paths.length).toBeGreaterThanOrEqual(6)
  for (const p of paths) {
    // Comments may say "never dangerouslySetInnerHTML"; code may not use it.
    const code = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect({ p, uses: /dangerouslySetInnerHTML/.test(code) }).toEqual({ p, uses: false })
  }
})
