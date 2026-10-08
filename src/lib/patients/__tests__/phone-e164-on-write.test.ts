/**
 * @jest-environment node
 *
 * patients.phone_e164 is the form a STOP reply and the duplicate-patient
 * check match on. Every write that sets patients.phone must set it too,
 * with the same rule (toE164), or that patient's STOP never matches.
 */

import fs from 'node:fs'
import path from 'node:path'
import { withPhoneE164 } from '../phone'

describe('withPhoneE164', () => {
  it('adds phone_e164 from phone with the toE164 rule', () => {
    expect(withPhoneE164({ first_name: 'Maya', phone: '(212) 555-0111' })).toEqual({ first_name: 'Maya', phone: '(212) 555-0111', phone_e164: '+12125550111' })
    expect(withPhoneE164({ phone: '+15125550199' }).phone_e164).toBe('+15125550199')
  })

  it('null when the phone is blank or not one toE164 accepts', () => {
    expect(withPhoneE164({ phone: '' }).phone_e164).toBeNull()
    expect(withPhoneE164({ phone: null }).phone_e164).toBeNull()
    expect(withPhoneE164({ phone: '555-0111' }).phone_e164).toBeNull()
  })

  it('leaves a write that does not touch phone alone', () => {
    expect(withPhoneE164({ nkda: true })).toEqual({ nkda: true })
  })
})

// ── Every patients write in the codebase ──────────────────────

const ROOT = path.resolve(__dirname, '../../../..')
const DIRS = ['src', 'scripts', 'e2e']

function files(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue
      out.push(...files(p))
    } else if (/\.(ts|tsx|mjs|js|sql)$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

/** The argument text of the call that opens at `open` (a "(" index). */
function callArgs(src: string, open: number): string {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')' && --depth === 0) return src.slice(open, i + 1)
  }
  return src.slice(open)
}

it('every insert, upsert or update of patients that sets phone also sets phone_e164', () => {
  const offenders: string[] = []
  for (const dir of DIRS) {
    for (const file of files(path.join(ROOT, dir))) {
      const src = fs.readFileSync(file, 'utf8')
      const rel = path.relative(ROOT, file).split(path.sep).join('/')
      if (file.endsWith('.sql')) {
        const re = /INSERT\s+INTO\s+(?:public\.)?patients\s*\(([^)]*)\)/gi
        for (const m of src.matchAll(re)) {
          const cols = m[1]!.split(',').map(c => c.trim())
          if (cols.includes('phone') && !cols.includes('phone_e164')) offenders.push(`${rel}: INSERT INTO patients`)
        }
        continue
      }
      const re = /from\(\s*['"]patients['"]\s*\)\s*\.(insert|upsert|update)\s*\(/g
      for (const m of src.matchAll(re)) {
        const args = callArgs(src, m.index! + m[0].length - 1)
        if (/\bphone\s*:/.test(args) && !/phone_e164|withPhoneE164/.test(args)) offenders.push(`${rel}: .${m[1]}()`)
      }
    }
  }
  expect(offenders).toEqual([])
})
