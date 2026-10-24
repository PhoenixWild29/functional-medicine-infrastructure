/**
 * @jest-environment node
 *
 * Face-sheet fill is available only when FACE_SHEET_AI_ENABLED is not
 * "false" AND ANTHROPIC_API_KEY is set (non-empty). The server decides;
 * the client gets only that boolean (no key, no reason).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { faceSheetAvailable } from '../config'

const saved = { ...process.env }
afterEach(() => { process.env = { ...saved } })

const env = (flag: string | undefined, key: string | undefined) => {
  if (flag === undefined) delete process.env['FACE_SHEET_AI_ENABLED']; else process.env['FACE_SHEET_AI_ENABLED'] = flag
  if (key === undefined) delete process.env['ANTHROPIC_API_KEY']; else process.env['ANTHROPIC_API_KEY'] = key
}

it.each([
  [undefined, 'sk-ant-x', true],
  ['true', 'sk-ant-x', true],
  ['TRUE', 'sk-ant-x', true],
  ['false', 'sk-ant-x', false],
  [' False ', 'sk-ant-x', false],
  [undefined, undefined, false],
  [undefined, '', false],
  [undefined, '   ', false],
  ['false', undefined, false],
])('flag %p, key %p: %p', (flag, key, expected) => {
  env(flag, key)
  expect(faceSheetAvailable()).toBe(expected)
})

it('New Prescription passes only the boolean to the client', () => {
  const page = readFileSync(join(process.cwd(), 'src', 'app', '(clinic-app)', 'new-prescription', 'page.tsx'), 'utf8')
  expect(page).toMatch(/faceSheetAvailable=\{faceSheetAvailable\(\)\}/)
  expect(page).not.toMatch(/ANTHROPIC_API_KEY/)
})
