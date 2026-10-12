/**
 * @jest-environment node
 *
 * The "possible duplicate" flag names the other patient. That name used to
 * come from a PostgREST self-embed on patients
 * (duplicate:patients!patients_possible_duplicate_of_fkey(...)) inside the
 * dashboard's orders query, Select Patient's patients query and the status
 * read. A self-referencing foreign key gives PostgREST two relationships
 * for that one constraint (to the referenced patient, and to the patients
 * that reference it), so the hint can be ambiguous and the whole query
 * fails (PGRST201, HTTP 300). Both pages treat a failed query as "no rows":
 * every clinic's dashboard would show no orders and Select Patient no
 * patients. PR #227's E2E ran out its 30 minutes.
 *
 * Now: no query embeds patients in patients. The flag's columns are
 * selected plainly, and the other patients' names come from one separate,
 * clinic-scoped read (loadDuplicateNames).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { scriptedDb, DB_DOWN } from '@/__tests__/helpers/scripted-db'
import { loadDuplicateNames, POSSIBLE_DUPLICATE_COLUMNS } from '../duplicate-names'
import { openPossibleDuplicate } from '../display'

const CLINIC_ID = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : sources(p)
    return /\.(ts|tsx)$/.test(name) ? [p] : []
  })
}

describe('no self-embed of patients', () => {
  it('no source embeds patients through the possible_duplicate_of foreign key', () => {
    const offenders = sources(join(process.cwd(), 'src'))
      .filter(f => /patients!patients_possible_duplicate_of_fkey|patients!possible_duplicate_of|duplicate:patients/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('the flag columns are plain columns', () => {
    expect(POSSIBLE_DUPLICATE_COLUMNS).toBe('possible_duplicate_of, possible_duplicate_dismissed_at')
  })
})

describe('loadDuplicateNames', () => {
  it('no ids: no query', async () => {
    const db = scriptedDb(() => undefined)
    expect((await loadDuplicateNames(db.client, CLINIC_ID, [])).size).toBe(0)
    expect(db.calls).toHaveLength(0)
  })

  it('one read, this clinic only, the distinct ids', async () => {
    const db = scriptedDb(() => ({ data: [{ patient_id: 'p-1', first_name: 'Jane', last_name: 'Smyth', phone: '+15125550123' }] }))
    const names = await loadDuplicateNames(db.client, CLINIC_ID, ['p-1', 'p-1', 'p-2'])
    expect(db.calls).toHaveLength(1)
    expect(db.calls[0]!.table).toBe('patients')
    expect(db.calls[0]!.filters).toEqual(expect.objectContaining({ clinic_id: CLINIC_ID, 'patient_id:in': ['p-1', 'p-2'] }))
    expect(names.get('p-1')).toEqual(expect.objectContaining({ first_name: 'Jane', last_name: 'Smyth' }))
  })

  it('a read failure is not fatal: no names, and the flag still shows ("another patient")', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const db = scriptedDb(() => DB_DOWN)
    const names = await loadDuplicateNames(db.client, CLINIC_ID, ['p-1'])
    expect(names.size).toBe(0)
    expect(openPossibleDuplicate({ possible_duplicate_of: 'p-1', possible_duplicate_dismissed_at: null }, names))
      .toEqual({ patientId: 'p-1', name: 'another patient' })
  })

  it('openPossibleDuplicate names the other patient from the map', () => {
    const names = new Map([['p-1', { first_name: 'Jane', last_name: 'Smyth', phone: null }]])
    expect(openPossibleDuplicate({ possible_duplicate_of: 'p-1', possible_duplicate_dismissed_at: null }, names))
      .toEqual({ patientId: 'p-1', name: 'Jane Smyth' })
  })
})
