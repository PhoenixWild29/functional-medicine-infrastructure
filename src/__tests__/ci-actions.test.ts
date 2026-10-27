/**
 * @jest-environment node
 *
 * CI hygiene (October 2026). Every workflow action is on a major that runs
 * on Node 24 (GitHub forces Node 20 actions onto Node 24 and warns on every
 * run), and the jobs that depend on OS packages or a pinned CLI binary run
 * on an explicit image, so ubuntu-latest moving to Ubuntu 26.04 (from
 * 2026-10-19) cannot change them silently.
 *
 * supabase/setup-cli stays on v1 (node20) on purpose: v3 installs the CLI
 * from npm instead of GitHub releases, a change to the deploy and rollback
 * paths that needs its own test (see deploy.yml).
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), '.github', 'workflows')
const read = (f: string) => readFileSync(join(DIR, f), 'utf8').replace(/\r\n/g, '\n')
const files = readdirSync(DIR).filter(f => f.endsWith('.yml'))

/** A job's text: from "  <job>:" to the next top-level job (or the end). */
function job(file: string, id: string): string {
  const text = read(file)
  const start = text.search(new RegExp(`^ {2}${id}:\\n`, 'm'))
  if (start === -1) return ''
  const after = text.slice(start + 1)
  const next = after.search(/^ {2}[a-z][a-z0-9_-]*:\n/m)
  return next === -1 ? text.slice(start) : text.slice(start, start + 1 + next)
}

const ALLOWED: Record<string, string> = {
  'actions/checkout':        'v7',
  'actions/setup-node':      'v7',
  'actions/cache':           'v6',
  'actions/upload-artifact': 'v7',
  'supabase/setup-cli':      'v1',
}

it('every action is on its Node 24 major (setup-cli v1 is the one deliberate exception)', () => {
  const uses = files.flatMap(f => [...read(f).matchAll(/^\s*(?:-\s*)?uses:\s*([\w./-]+)@(\S+)/gm)].map(m => ({ file: f, name: m[1]!, ref: m[2]! })))
  expect(uses.length).toBeGreaterThan(0)
  expect(uses.filter(u => ALLOWED[u.name] !== u.ref)).toEqual([])
})

it.each([
  ['ci.yml', 'e2e'],
  ['docs-build.yml', 'build'],
  ['deploy.yml', 'migrate'],
  ['rollback.yml', 'rollback'],
])('%s %s runs on an explicit Ubuntu 24.04 image, not ubuntu-latest', (file, id) => {
  expect(job(file, id)).toMatch(/\n {4}runs-on: ubuntu-24\.04\n/)
})

it('deploy and rollback keep the pinned Supabase CLI', () => {
  for (const file of ['deploy.yml', 'rollback.yml']) {
    expect(read(file)).toMatch(/uses: supabase\/setup-cli@v1\n\s+with:\n\s+version: 1\.171\.0/)
  }
})
