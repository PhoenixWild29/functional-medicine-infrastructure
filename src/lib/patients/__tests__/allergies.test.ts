/**
 * WO-97 patient allergies — pure helpers.
 *
 * Pins the three chip states (NKDA / recorded / not recorded), the
 * payload string used by the Rx PDF and pharmacy transformers, list
 * normalisation, and the PATCH body validation that guards the
 * NKDA-excludes-allergies rule at the API boundary.
 */

import {
  allergyStatus,
  allergyChipLabel,
  allergiesForPayload,
  hasRecordedAllergies,
  normalizeAllergies,
  validateAllergiesPatch,
  MAX_ALLERGY_ENTRIES,
  MAX_ALLERGY_ENTRY_LENGTH,
} from '../allergies'

describe('allergyStatus — three states', () => {
  it('NKDA wins whenever the flag is set', () => {
    expect(allergyStatus({ nkda: true, allergies: [] })).toEqual({ kind: 'nkda' })
    expect(allergyStatus({ nkda: true, allergies: null })).toEqual({ kind: 'nkda' })
  })

  it('a non-empty list is "recorded"', () => {
    expect(allergyStatus({ nkda: false, allergies: ['penicillin', 'sulfa'] }))
      .toEqual({ kind: 'recorded', allergies: ['penicillin', 'sulfa'] })
  })

  it('nothing recorded: null, empty, whitespace-only, missing fields, or no patient', () => {
    expect(allergyStatus({ nkda: false, allergies: null })).toEqual({ kind: 'not_recorded' })
    expect(allergyStatus({ nkda: false, allergies: [] })).toEqual({ kind: 'not_recorded' })
    expect(allergyStatus({ nkda: false, allergies: ['  '] })).toEqual({ kind: 'not_recorded' })
    expect(allergyStatus({})).toEqual({ kind: 'not_recorded' })
    expect(allergyStatus(null)).toEqual({ kind: 'not_recorded' })
    expect(allergyStatus(undefined)).toEqual({ kind: 'not_recorded' })
  })

  it('hasRecordedAllergies is true for NKDA and for a list, false otherwise', () => {
    expect(hasRecordedAllergies({ nkda: true })).toBe(true)
    expect(hasRecordedAllergies({ allergies: ['sulfa'] })).toBe(true)
    expect(hasRecordedAllergies({ allergies: [] })).toBe(false)
    expect(hasRecordedAllergies(undefined)).toBe(false)
  })
})

describe('allergyChipLabel — chip copy for the selector card and session banner', () => {
  it('Alex Demo (NKDA)', () => {
    expect(allergyChipLabel({ nkda: true, allergies: [] })).toBe('NKDA')
  })
  it('Jordan Rivera (sulfa) and a multi-entry list', () => {
    expect(allergyChipLabel({ nkda: false, allergies: ['sulfa'] })).toBe('Allergies: sulfa')
    expect(allergyChipLabel({ nkda: false, allergies: ['penicillin', 'sulfa'] })).toBe('Allergies: penicillin, sulfa')
  })
  it('everyone else', () => {
    expect(allergyChipLabel({ nkda: false, allergies: null })).toBe('Allergies: not recorded')
    expect(allergyChipLabel(undefined)).toBe('Allergies: not recorded')
  })
})

describe('allergiesForPayload — Rx PDF line and pharmacy payload string', () => {
  it('maps the three states', () => {
    expect(allergiesForPayload({ nkda: true })).toBe('NKDA')
    expect(allergiesForPayload({ allergies: ['penicillin', 'sulfa'] })).toBe('penicillin, sulfa')
    expect(allergiesForPayload({ allergies: [] })).toBe('Not recorded')
    expect(allergiesForPayload(null)).toBe('Not recorded')
  })
})

describe('normalizeAllergies', () => {
  it('splits on commas, semicolons and newlines; trims; drops blanks', () => {
    expect(normalizeAllergies('penicillin, sulfa;latex\n  \n aspirin ')).toEqual(['penicillin', 'sulfa', 'latex', 'aspirin'])
  })
  it('collapses internal whitespace and dedupes case-insensitively, first spelling wins', () => {
    expect(normalizeAllergies(['Penicillin', 'penicillin', 'PENICILLIN  G', 'Penicillin G'])).toEqual(['Penicillin', 'PENICILLIN G'])
  })
  it('caps entry length and tolerates null / undefined / non-strings', () => {
    const long = 'x'.repeat(MAX_ALLERGY_ENTRY_LENGTH + 40)
    expect(normalizeAllergies([long])[0]).toHaveLength(MAX_ALLERGY_ENTRY_LENGTH)
    expect(normalizeAllergies(null)).toEqual([])
    expect(normalizeAllergies(undefined)).toEqual([])
    expect(normalizeAllergies([42 as unknown as string, 'sulfa'])).toEqual(['sulfa'])
  })
})

describe('validateAllergiesPatch — API boundary', () => {
  it('accepts a list (array or delimited string) and clears nkda', () => {
    expect(validateAllergiesPatch({ allergies: ['sulfa', ' Sulfa ', 'penicillin'] }))
      .toEqual({ ok: true, value: { allergies: ['sulfa', 'penicillin'], nkda: false } })
    expect(validateAllergiesPatch({ allergies: 'sulfa, penicillin', nkda: false }))
      .toEqual({ ok: true, value: { allergies: ['sulfa', 'penicillin'], nkda: false } })
  })

  it('accepts NKDA with an empty or omitted list', () => {
    expect(validateAllergiesPatch({ nkda: true })).toEqual({ ok: true, value: { allergies: [], nkda: true } })
    expect(validateAllergiesPatch({ nkda: true, allergies: [] })).toEqual({ ok: true, value: { allergies: [], nkda: true } })
    expect(validateAllergiesPatch({ nkda: true, allergies: '  ,  ' })).toEqual({ ok: true, value: { allergies: [], nkda: true } })
  })

  it('an empty body clears to "not recorded"', () => {
    expect(validateAllergiesPatch({})).toEqual({ ok: true, value: { allergies: [], nkda: false } })
  })

  it('rejects NKDA together with a non-empty list (mirrors the CHECK constraint)', () => {
    const r = validateAllergiesPatch({ nkda: true, allergies: ['sulfa'] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/nkda cannot be true/)
  })

  it('rejects malformed input', () => {
    expect(validateAllergiesPatch(null).ok).toBe(false)
    expect(validateAllergiesPatch('sulfa').ok).toBe(false)
    expect(validateAllergiesPatch([]).ok).toBe(false)
    expect(validateAllergiesPatch({ allergies: 42 }).ok).toBe(false)
    expect(validateAllergiesPatch({ allergies: ['sulfa', 7] }).ok).toBe(false)
    expect(validateAllergiesPatch({ nkda: 'yes' }).ok).toBe(false)
    expect(validateAllergiesPatch({ allergies: Array.from({ length: MAX_ALLERGY_ENTRIES + 1 }, (_, i) => `a${i}`) }).ok).toBe(false)
  })
})
