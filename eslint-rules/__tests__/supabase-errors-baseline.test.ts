/**
 * @jest-environment node
 *
 * The committed baseline (eslint-baselines/supabase-errors.json) skips
 * only what it lists. A NEW unchecked Supabase call in a file that is
 * already on the baseline still fails Lint — the baseline is not a
 * per-file exemption.
 *
 * Runs the real rule against the real baseline file, linting text as if
 * it were src/app/api/favorites/recent/route.ts (on the baseline: GET's
 * `const { data: provider } = await supabase`). Batch 3 PR 3 fixed the
 * favorites PATCH site this test used before; when a later PR fixes this
 * one, point the test at a site that is still listed.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ESLint } from 'eslint'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tsParser = require('@typescript-eslint/parser')
import rule from '../no-unchecked-supabase-error'

const BASELINE = 'eslint-baselines/supabase-errors.json'
const FILE = 'src/app/api/favorites/recent/route.ts'

function lint(code: string) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: {
      files: ['**/*.ts'],
      languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
      plugins: { supabase: { rules: { 'no-unchecked-supabase-error': rule } } },
      rules: { 'supabase/no-unchecked-supabase-error': ['error', { baselineFile: BASELINE }] },
    },
  })
  return eslint.lintText(code, { filePath: join(process.cwd(), FILE) })
}

describe('the committed baseline', () => {
  const entries = (JSON.parse(readFileSync(join(process.cwd(), BASELINE), 'utf8')) as { entries: Array<{ file: string; function: string; line: string }> }).entries

  it('lists the site this test relies on', () => {
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: FILE, function: 'GET', line: 'const { data: provider } = await supabase' }),
    ]))
  })

  it('skips the listed site, and fails a new one in the same file and function', async () => {
    const [result] = await lint([
      'export async function GET(supabase: any) {',
      '  const { data: provider } = await supabase',
      "    .from('providers').select('provider_id')",
      "  const { data: extra } = await supabase.from('providers').select('id')",
      '  return [provider, extra]',
      '}',
    ].join('\n'))
    const messages = result!.messages.filter(m => m.ruleId === 'supabase/no-unchecked-supabase-error')
    expect(messages).toHaveLength(1)
    expect(messages[0]!.line).toBe(4)
  })

  it('every entry names a file, a function and a line, never a line number', () => {
    for (const e of entries) {
      expect(Object.keys(e).sort()).toEqual(['count', 'file', 'function', 'line'])
      expect(e.line.length).toBeGreaterThan(0)
    }
  })
})
