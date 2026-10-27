/**
 * @jest-environment node
 *
 * Security B9: no account password is written in e2e/ or scripts/. Every
 * E2E account's password comes from e2ePassword() (e2e/fixtures/
 * test-password.ts) and every POC account's from its POC_*_PASSWORD env
 * var. Merging bundle-ci (whose specs still define users with
 * `password: 'TestPassword123!'`) into bundle-hipaa must not bring one
 * back, including in a file that merges without a conflict (C's dry run 2,
 * problem 3: accessibility-all-routes.spec.ts).
 *
 * Flags `password: '...'` and `PASSWORD = '...'` with a string literal. A
 * deliberate literal that is not an account password (a wrong password
 * sent on purpose, a random new one) carries the marker
 * `e2e-literal-password-ok` with its reason, on the line or the line before.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const LITERAL = /\b(password|PASSWORD)\s*[:=]\s*['"`]/
const MARKER = 'e2e-literal-password-ok'

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') files(p, out) } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) out.push(p)
  }
  return out
}

/** Every unmarked literal password line in these trees. */
function literalPasswords(dirs: string[]): string[] {
  const found: string[] = []
  for (const dir of dirs) {
    for (const file of files(join(ROOT, dir))) {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/)
      lines.forEach((line, i) => {
        if (!LITERAL.test(line)) return
        if (line.includes(MARKER) || (lines[i - 1] ?? '').includes(MARKER)) return
        found.push(`${relative(ROOT, file)}:${i + 1}`)
      })
    }
  }
  return found
}

it('no account password is a literal in e2e/ or scripts/', () => {
  expect(literalPasswords(['e2e', 'scripts'])).toEqual([])
})

it('the pattern catches the forms bundle-ci uses', () => {
  for (const line of [
    "const MA_USER = { email: 'test-a11y-ma@compoundiq.test', password: 'TestPassword123!' }",
    "const PASSWORD = 'nav e2e passphrase 42'",
    '    password: "TestPassword123!",',
    "    { password: 'POCAdmin2026!' }",
  ]) expect(LITERAL.test(line)).toBe(true)
  for (const line of [
    'const PASSWORD = e2ePassword()',
    '  get password() { return e2ePassword() },',
    "password: process.env['POC_OPS_PASSWORD']",
  ]) expect(LITERAL.test(line)).toBe(false)
})
