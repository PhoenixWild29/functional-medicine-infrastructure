/**
 * @jest-environment node
 *
 * Self sign-up, decision 1: the sign page and the sign API agree on who
 * may sign because both ask lib/auth/signer. The page must not keep its
 * own role check (a solo admin would see "Provider signature required"
 * while the API let them sign, or the other way round).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

it('the sign page, batch-sign and its check all decide with resolveSigner', () => {
  const page = read('src/app/(clinic-app)/new-prescription/sign/page.tsx')
  expect(page).toContain("from '@/lib/auth/signer'")
  expect(page).toMatch(/resolveSigner\(/)
  expect(page).not.toMatch(/getUserRole\(user\) !== 'provider'/)

  expect(read('src/lib/orders/batch-sign.ts')).toMatch(/resolveSigner\(/)
  const check = read('src/app/api/orders/batch-sign/check/route.ts')
  expect(check).toMatch(/resolveSigner\(/)
  expect(check).not.toMatch(/getUserRole\(user\) !== 'provider'/)
})
