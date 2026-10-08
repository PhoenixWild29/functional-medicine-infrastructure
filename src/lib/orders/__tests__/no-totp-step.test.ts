/**
 * @jest-environment node
 *
 * C6 refuses every controlled line in checkBatch, before signing starts,
 * so the EPCS second-factor step after it (a TOTP code, then EPCS audit
 * rows) can never run, and the Review / Sign TOTP gate is never shown.
 * Unreachable code that looks like a working EPCS path is removed: the
 * batch-sign TOTP step and its audit writes, the route's totpCode, and
 * EpcsTotpGate.
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

it('batch-sign has no TOTP step and writes no EPCS audit rows', () => {
  const src = read('src/lib/orders/batch-sign.ts')
  expect(src).not.toMatch(/verifyProviderTotp|totpCode|TOTP_REQUIRED|TOTP_INVALID|writeEpcsAudit/)
})

it('the batch-sign route does not take a totpCode', () => {
  expect(read('src/app/api/orders/batch-sign/route.ts')).not.toMatch(/totpCode/)
})

it('EpcsTotpGate is gone', () => {
  expect(fs.existsSync(path.join(ROOT, 'src/app/(clinic-app)/new-prescription/_components/epcs-totp-gate.tsx'))).toBe(false)
})
