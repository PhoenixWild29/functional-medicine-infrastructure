/**
 * @jest-environment node
 *
 * Decision 12, option B (docs/decisions/before-real-patients-2026-10-25.md):
 * the support address comes from NEXT_PUBLIC_SUPPORT_EMAIL, so prod and
 * demo point to their own inbox. Shown in Help and wherever the app says
 * "Contact CompoundIQ". Unset (or not an email address): the current
 * generic text, unchanged.
 */

const ENV = 'NEXT_PUBLIC_SUPPORT_EMAIL'
const saved = process.env[ENV]
afterEach(() => { if (saved === undefined) delete process.env[ENV]; else process.env[ENV] = saved })

function load<T>(path: string): T {
  let mod: T | undefined
  jest.isolateModules(() => { mod = jest.requireActual(path) as T })
  return mod!
}
type Contact = typeof import('../contact')
type Topics = typeof import('@/lib/help/topics')

describe('contactCompoundIQ', () => {
  it('unset: the generic text', () => {
    delete process.env[ENV]
    const { contactCompoundIQ, supportEmail } = load<Contact>('../contact')
    expect(supportEmail()).toBeNull()
    expect(contactCompoundIQ()).toBe('Contact CompoundIQ')
    expect(contactCompoundIQ({ lower: true })).toBe('contact CompoundIQ')
  })

  it('set: names the address', () => {
    process.env[ENV] = '  support@compoundiq.example  '
    const { contactCompoundIQ, supportEmail } = load<Contact>('../contact')
    expect(supportEmail()).toBe('support@compoundiq.example')
    expect(contactCompoundIQ()).toBe('Contact CompoundIQ at support@compoundiq.example')
    expect(contactCompoundIQ({ lower: true })).toBe('contact CompoundIQ at support@compoundiq.example')
  })

  it('a value that is not an email address is ignored', () => {
    for (const bad of ['support', 'a b@c.d', '<script>@x.y', 'x@y', '']) {
      process.env[ENV] = bad
      expect(load<Contact>('../contact').supportEmail()).toBeNull()
    }
  })
})

describe('Help, Who to contact', () => {
  it('unset: the current generic line, no address', () => {
    delete process.env[ENV]
    const contact = JSON.stringify(load<Topics>('@/lib/help/topics').helpTopic('contact'))
    expect(contact).toContain('Contact CompoundIQ through your CompoundIQ account contact.')
    expect(contact).not.toMatch(/@/)
  })

  it('set: the address', () => {
    process.env[ENV] = 'support@compoundiq.example'
    const contact = JSON.stringify(load<Topics>('@/lib/help/topics').helpTopic('contact'))
    expect(contact).toContain('Contact CompoundIQ at support@compoundiq.example.')
  })
})

it('every "Contact CompoundIQ" in the app comes from contactCompoundIQ()', () => {
  const { readFileSync, readdirSync, statSync } = jest.requireActual('node:fs') as typeof import('node:fs')
  const { join, relative } = jest.requireActual('node:path') as typeof import('node:path')
  const root = join(process.cwd(), 'src')
  const walk = (d: string, out: string[] = []): string[] => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) { if (n !== '__tests__') walk(p, out) } else if (/\.(ts|tsx)$/.test(n)) out.push(p)
    }
    return out
  }
  const literal = /contact CompoundIQ/i
  const offenders = walk(root)
    .filter(f => !f.endsWith(join('lib', 'support', 'contact.ts')))
    .flatMap(f => readFileSync(f, 'utf8').split(/\r?\n/).map((l, i) => [f, l, i] as const))
    .filter(([, l]) => literal.test(l) && !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .map(([f, , i]) => `${relative(root, f)}:${i + 1}`)
  expect(offenders).toEqual([])
})
