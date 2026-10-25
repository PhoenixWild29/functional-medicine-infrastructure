/**
 * @jest-environment node
 *
 * Every async route handler under src/app/api is exported through
 * withApiErrors (src/lib/api/with-api-errors), so a thrown error returns
 * the JSON 500 instead of Next's empty 500. A new route that exports
 * `async function POST` directly fails here. The only plain exports left
 * are the synchronous 405 stubs and the health probe, which cannot throw.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const API = join(process.cwd(), 'src', 'app', 'api')
const routes: string[] = []
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { if (name !== '__tests__') walk(full); continue }
    if (name === 'route.ts') routes.push(full)
  }
}
walk(API)

const METHOD = '(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)'

it('finds the route handlers', () => {
  expect(routes.length).toBeGreaterThan(130)
})

it.each(routes.map(r => [relative(API, r).split(sep).join('/'), r]))('%s', (_name, file) => {
  const src = readFileSync(file, 'utf8')
  expect(src).not.toMatch(new RegExp(`export\\s+async\\s+function\\s+${METHOD}\\b`))
  expect(src).not.toMatch(new RegExp(`export\\s+const\\s+${METHOD}\\s*=\\s*async`))
  for (const [, method] of src.matchAll(new RegExp(`^export const ${METHOD} = (.*)$`, 'gm'))) {
    const line = src.match(new RegExp(`^export const ${method} = (.*)$`, 'm'))![1]!
    expect({ method, wrapped: /^withApiErrors\('\/api\//.test(line) }).toEqual({ method, wrapped: true })
  }
  // A plain function export must be a synchronous one-line stub (405), or
  // the health probe, which returns a constant body and reads nothing.
  if (_name === 'health/route.ts') return
  for (const m of src.matchAll(new RegExp(`^export function ${METHOD}\\(\\)(.*)$`, 'gm'))) {
    expect(m[2]).toMatch(/status: 405/)
  }
})
