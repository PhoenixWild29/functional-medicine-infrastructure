/**
 * @jest-environment node
 *
 * Every cron route authenticates the same way, and fails hard when
 * CRON_SECRET is not set. Seven crons compared the header with
 * `Bearer ${process.env.CRON_SECRET}`: with the variable unset that is
 * the string "Bearer undefined", which anyone can send.
 *
 *   - CRON_SECRET unset or blank: 500, logged, the job does not run;
 *   - a wrong or missing header: 401;
 *   - the right header: the job runs.
 */

import fs from 'node:fs'
import path from 'node:path'
import { cronAuthFailure } from '../auth'

const req = (auth: string | null) => ({ headers: { get: (h: string) => (h.toLowerCase() === 'authorization' ? auth : null) } }) as never

const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
afterAll(() => errorSpy.mockRestore())

describe('cronAuthFailure', () => {
  afterEach(() => { delete process.env['CRON_SECRET'] })

  it('CRON_SECRET unset: 500, even for "Bearer undefined"', async () => {
    delete process.env['CRON_SECRET']
    for (const auth of ['Bearer undefined', 'Bearer ', null]) {
      const res = cronAuthFailure(req(auth), 'test-cron')
      expect(res?.status).toBe(500)
    }
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[test-cron] CRON_SECRET is not set'))
  })

  it('CRON_SECRET blank: 500', () => {
    process.env['CRON_SECRET'] = '   '
    expect(cronAuthFailure(req('Bearer    '), 'test-cron')?.status).toBe(500)
  })

  it('a wrong or missing header: 401', () => {
    process.env['CRON_SECRET'] = 's3cret'
    expect(cronAuthFailure(req('Bearer nope'), 'test-cron')?.status).toBe(401)
    expect(cronAuthFailure(req(null), 'test-cron')?.status).toBe(401)
  })

  it('the right header: null (run the job)', () => {
    process.env['CRON_SECRET'] = 's3cret'
    expect(cronAuthFailure(req('Bearer s3cret'), 'test-cron')).toBeNull()
  })
})

it('every cron route uses cronAuthFailure and never builds "Bearer ${process.env...}"', () => {
  const dir = path.join(process.cwd(), 'src', 'app', 'api', 'cron')
  const routes = fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== '__tests__')
    .map(d => path.join(dir, d.name, 'route.ts'))
    .filter(f => fs.existsSync(f))
  expect(routes.length).toBeGreaterThanOrEqual(12)
  const offenders = routes.filter(f => {
    const src = fs.readFileSync(f, 'utf8')
    return !/cronAuthFailure\(request, '[a-z-]+'\)/.test(src) || /Bearer \$\{process\.env/.test(src) || /process\.env(\.|\[')CRON_SECRET/.test(src)
  }).map(f => path.relative(process.cwd(), f))
  expect(offenders).toEqual([])
})
