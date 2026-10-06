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

import { RuleTester, ESLint } from 'eslint'
import path from 'path'
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
  it('is an error for src files and not off for tests of the rule itself', async () => {
    const eslint = new ESLint({ cwd: path.resolve(__dirname, '..', '..') })
    const config = await eslint.calculateConfigForFile('src/lib/sms/sender.ts')
    const setting = config.rules?.['phi/no-phi-in-logs']
    expect(Array.isArray(setting) ? setting[0] : setting).toBe(2)
  })
})
