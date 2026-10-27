/**
 * @jest-environment node
 *
 * no-phi-in-logs (Compliance C9).
 *
 * A console.* call may not print a patient field: names, DOB, phone,
 * email, address, allergies, sig, diagnosis, medication name, or a whole
 * patient object. Server logs go to Vercel's log drain, which is not where
 * PHI belongs; log ids (order_id, patient_id) instead.
 *
 * The rule looks at every argument of console.log/info/warn/error/debug/
 * trace: member access to a patient field (`patient.first_name`), a bare
 * identifier with a patient-field name (`email`, `toNumber`), an object
 * key with one (`{ phone }`, `{ dob: x }`), and a bare patient object
 * (`patient`, `patients`). Ids pass (`patient.patient_id`).
 */

import { RuleTester } from 'eslint'
import path from 'path'
import { readFileSync } from 'fs'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tsParser = require('@typescript-eslint/parser')
import rule from '../no-phi-in-logs'

const tester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
})

tester.run('no-phi-in-logs', rule, {
  valid: [
    { code: "console.info(`[orders] created | order=${order.order_id}`)" },
    { code: "console.error('[orders] insert failed:', error.message)" },
    { code: "console.info('[patients] loaded', patient.patient_id, rows.length)" },
    { code: "console.warn(`[sms] sent | order=${orderId} | template=${templateName}`)" },
    { code: "console.log({ orderId, status })" },
    // Not a console call.
    { code: "logger.info(patient.first_name)" },
    { code: "const first_name = patient.first_name" },
  ],
  invalid: [
    { code: "console.log(patient.first_name)",                         errors: [{ messageId: 'phi' }] },
    { code: "console.error(`dob=${p.date_of_birth}`)",                 errors: [{ messageId: 'phi' }] },
    { code: "console.info('to', email)",                               errors: [{ messageId: 'phi' }] },
    { code: "console.warn({ phone })",                                 errors: [{ messageId: 'phi' }] },
    { code: "console.info({ dob: x })",                                errors: [{ messageId: 'phi' }] },
    { code: "console.log(patient)",                                    errors: [{ messageId: 'phi' }] },
    { code: "console.debug(`to=...${params.toNumber.slice(-4)}`)",     errors: [{ messageId: 'phi' }] },
    { code: "console.error('sig', order.sig_text)",                    errors: [{ messageId: 'phi' }] },
    { code: "console.log(row['address_line1'])",                       errors: [{ messageId: 'phi' }] },
    { code: "console.error(`from=${fax.fromNumber}`)",                 errors: [{ messageId: 'phi' }] },
    { code: "console.trace(patients)",                                 errors: [{ messageId: 'phi' }] },
    { code: "console.info(`${data.lastName}, ${data.firstName}`)",     errors: [{ messageId: 'phi' }, { messageId: 'phi' }] },
  ],
})

describe('wired into the repo lint config', () => {
  // Read from the config file itself. This used to ask a child Node
  // process what ESLint resolves for a src file (execFileSync): a cold
  // ESLint config load that took 7 s alone, 65 s under --coverage, and
  // 1,321 s in a loaded full run (B-2026-10-26-10). Being synchronous, it
  // blocked the worker, so jest's per-test timeout could not stop it. The
  // lint job (eslint . --max-warnings=0) is what enforces the rule; this
  // checks that the config wires it, as an error, for src.
  const config = readFileSync(path.resolve(__dirname, '..', '..', 'eslint.config.mjs'), 'utf8')

  it('the flat config has a block for src that registers the rule and sets it to error', () => {
    expect(config).toMatch(/import noPhiInLogs from '\.\/eslint-rules\/no-phi-in-logs\.js'/)
    // The block: from its files line to its closing brace.
    const block = /\{\s*files:\s*\['src\/\*\*\/\*\.\{ts,tsx\}'\][\s\S]*?\n {2}\}/.exec(
      config.slice(config.indexOf("'no-phi-in-logs': noPhiInLogs") - 400),
    )?.[0] ?? ''
    expect(block).toContain("plugins: { phi: { rules: { 'no-phi-in-logs': noPhiInLogs } } }")
    expect(block).toMatch(/'phi\/no-phi-in-logs':\s*'error'/)
  })

  it('the block is in the exported config array', () => {
    const exportedAt = config.indexOf('export default config')
    const blockAt = config.indexOf("'phi/no-phi-in-logs'")
    const arrayEnd = config.lastIndexOf(']', exportedAt)
    expect(blockAt).toBeGreaterThan(0)
    expect(blockAt).toBeLessThan(arrayEnd)
  })
})
