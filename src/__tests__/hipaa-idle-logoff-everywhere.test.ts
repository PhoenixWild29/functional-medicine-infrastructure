/**
 * HIPAA automatic logoff: every signed-in staff area mounts the idle
 * timeout (clinic app, ops, onboarding, pharmacy portal).
 */

import { readFileSync } from 'fs'
import { join } from 'path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

it.each([
  'src/app/(clinic-app)/layout.tsx',
  'src/app/(ops-dashboard)/ops/layout.tsx',
  'src/app/onboarding/layout.tsx',
  'src/app/pharmacy/layout.tsx',
])('%s mounts the idle logoff', (path) => {
  expect(read(path)).toMatch(/<HipaaTimeout timeoutMinutes=\{serverEnv\.idleTimeoutMinutes\(\)\} \/>/)
})
