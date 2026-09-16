/**
 * WO-104: the favorites model, pure layer.
 *
 *   - presets are builder values, validated and stored canonically
 *   - merging drops duplicates and orders 10 · 20 · 40 units
 *   - chip text is computed: "20 units" + "(1.0 mg) weekly"
 *   - a chip / Custom becomes a structured builder load (no sig at all)
 *   - groups: the selected patient first, categories in a fixed order,
 *     A–Z inside each group; other patients' favorites hidden
 *   - the category mapping and the collapse rule in the migration match
 *   - the price-step duration fallback is legacy-link only
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  builderDurationFromPreset,
  builderLoadFromFavorite,
  CATEGORY_ALIASES,
  compareCategories,
  FAVORITE_CATEGORY_ORDER,
  favoriteCategory,
  groupFavorites,
  mergePresets,
  presetChipText,
  presetDurationFromBuilder,
  presetDurationFromDays,
  presetsFromJson,
  recentFormulations,
  validateDosePreset,
  validateDosePresets,
  type DosePreset,
} from '../favorite-presets'
import { durationDaysForLink } from '../rx-details'

const SEMA = { concentration_value: 5, concentration_unit: 'mg/mL' }
const p = (dose: string, extra: Partial<DosePreset> = {}): DosePreset =>
  ({ dose, unit: 'units', frequency: 'QW', timing: '', duration: '', label: null, ...extra })

describe('validateDosePreset', () => {
  it('normalises codes and numbers to canonical builder values', () => {
    expect(validateDosePreset({ dose: '20.0', unit: 'units', frequency: 'qw', timing: 'morning', duration: '30', label: '  Maintenance ' }))
      .toEqual({ ok: true, preset: { dose: '20', unit: 'units', frequency: 'QW', timing: 'MORNING', duration: '30', label: 'Maintenance' } })
    expect(validateDosePreset({ dose: 0.5, unit: 'mL', duration: 'ongoing' }))
      .toEqual({ ok: true, preset: { dose: '0.5', unit: 'mL', frequency: '', timing: '', duration: 'ONGOING', label: null } })
  })

  it.each([
    [{ dose: '0', unit: 'units' }, /dose/],
    [{ dose: '10', unit: 'troche' }, /unit/],
    [{ dose: '10', unit: 'units', frequency: 'WEEKLY' }, /frequency/],
    [{ dose: '10', unit: 'units', timing: 'NOON' }, /timing/],
    [{ dose: '10', unit: 'units', duration: 'for 30 days' }, /duration/],
    ['10 units', /object/],
  ])('rejects %j', (raw, pattern) => {
    const v = validateDosePreset(raw)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.error).toMatch(pattern)
  })

  it('an array needs at least one dose; invalid stored entries are dropped on read', () => {
    expect(validateDosePresets([]).ok).toBe(false)
    expect(presetsFromJson([p('10'), { dose: 'x' }, null])).toEqual([p('10')])
    expect(presetsFromJson('not an array')).toEqual([])
  })
})

describe('mergePresets', () => {
  it('drops duplicates (first label wins) and orders by unit, then dose ascending', () => {
    expect(mergePresets([p('40'), p('10', { label: 'Starter' })], [p('20'), p('10'), p('0.5', { unit: 'mL' })]))
      .toEqual([p('10', { label: 'Starter' }), p('20'), p('40'), p('0.5', { unit: 'mL' })])
  })

  it('the same dose with a different frequency or duration is a different chip', () => {
    expect(mergePresets([p('10')], [p('10', { frequency: 'Q2W' }), p('10', { duration: '30' })])).toHaveLength(3)
  })
})

describe('presetChipText', () => {
  it('writes the dose out with its computed mg and frequency', () => {
    expect(presetChipText(p('20'), SEMA)).toEqual({ primary: '20 units', secondary: '(1.0 mg) weekly' })
    expect(presetChipText(p('70', { unit: 'mg', frequency: 'Q2W' }), { concentration_value: 200, concentration_unit: 'mg/mL' }))
      .toEqual({ primary: '70 mg', secondary: 'every 2 weeks' })
    expect(presetChipText(p('1', { unit: 'capsule', frequency: 'QHS' }), null)).toEqual({ primary: '1 capsule', secondary: 'at bedtime' })
  })
})

describe('builderLoadFromFavorite — structured end to end', () => {
  const fav = { formulation_id: 'f-sema', pharmacy_id: 'ph-strive', default_refills: 2 }

  it('a dose chip populates amount, unit, frequency, timing and duration', () => {
    expect(builderLoadFromFavorite(fav, p('20', { timing: 'MORNING', duration: '30' }))).toEqual({
      formulationId: 'f-sema', pharmacyId: 'ph-strive',
      doseAmount: '20', doseUnit: 'units', frequency: 'QW', timing: 'MORNING',
      duration: '30', customDurationDays: '', refills: 2,
      sigMode: 'standard', titrationSteps: [],
    })
  })

  it('Custom pre-selects the formulation and pharmacy and leaves the dose empty', () => {
    expect(builderLoadFromFavorite({ ...fav, pharmacy_id: null, default_refills: null }, null)).toEqual({
      formulationId: 'f-sema', pharmacyId: '',
      doseAmount: '', doseUnit: '', frequency: '', timing: '',
      duration: '', customDurationDays: '', refills: 0,
      sigMode: 'standard', titrationSteps: [],
    })
  })

  it('carries no sig text for anything downstream to parse', () => {
    const load = builderLoadFromFavorite(fav, p('20'))
    // WO-105 added sigMode — an enum the builder opens in, never text to
    // parse. No sig TEXT travels: the sig is still generated from the
    // structured values in the builder.
    expect(Object.keys(load).some(k => /sigtext|sig_text/i.test(k))).toBe(false)
    expect(load.sigMode).toBe('standard')
    expect(Object.values(load).every(v => typeof v !== 'string' || v.length < 20)).toBe(true)
  })

  it('WO-105: a titration favorite comes back as a titration, with its steps', () => {
    const steps = [
      { dose: '0.1', unit: 'mL', frequency: 'QHS', weeks: 2 },
      { dose: '0.2', unit: 'mL', frequency: 'QHS', weeks: 2 },
    ]
    const load = builderLoadFromFavorite(
      { ...fav, sig_mode: 'titration', titration_steps: steps },
      null,
    )
    expect(load.sigMode).toBe('titration')
    expect(load.titrationSteps).toEqual(steps)
  })

  it('WO-105: steps on a standard favorite are ignored', () => {
    const load = builderLoadFromFavorite(
      { ...fav, sig_mode: 'standard', titration_steps: [{ dose: '0.1', unit: 'mL', frequency: 'QHS', weeks: 2 }] },
      p('20'),
    )
    expect(load.sigMode).toBe('standard')
    expect(load.titrationSteps).toEqual([])
  })

  it('maps durations between the preset and the builder dropdown', () => {
    expect(builderDurationFromPreset('30')).toEqual({ duration: '30', customDurationDays: '' })
    expect(builderDurationFromPreset('45')).toEqual({ duration: 'CUSTOM', customDurationDays: '45' })
    expect(builderDurationFromPreset('ONGOING')).toEqual({ duration: 'ONGOING', customDurationDays: '' })
    expect(builderDurationFromPreset('')).toEqual({ duration: '', customDurationDays: '' })
    expect(presetDurationFromBuilder('CUSTOM', '45')).toBe('45')
    expect(presetDurationFromBuilder('ONGOING', '')).toBe('ONGOING')
    expect(presetDurationFromBuilder('', '')).toBe('')
    expect(presetDurationFromDays(90)).toBe('90')
    expect(presetDurationFromDays(null)).toBe('')
  })
})

describe('groupFavorites — categories in a fixed order, A–Z, patient first', () => {
  const favs = [
    { label: 'TRT Cyp 200 — Weekly', category: 'Hormones', patient_id: null },
    { label: 'BPC-157 daily cycling', category: 'Peptides', patient_id: null },
    { label: 'Estradiol 0.1% Cream', category: 'Hormones', patient_id: null },
    { label: 'Semaglutide', category: 'Weight Management', patient_id: null },
    { label: 'LDN 4.5 Maintenance', category: null, patient_id: null },
    { label: 'biest 80/20', category: 'Hormones', patient_id: null },
    { label: 'Tadalafil 10 Troche', category: 'Sexual Health', patient_id: null },
    { label: 'Semaglutide — Alex', category: 'Weight Management', patient_id: 'patient-alex' },
    { label: 'Semaglutide — Jordan', category: 'Weight Management', patient_id: 'patient-jordan' },
    { label: 'Zinc', category: 'Nutrition', patient_id: null },
  ]

  it('orders groups and names, with the selected patient\'s favorites first', () => {
    const groups = groupFavorites(favs, { patientId: 'patient-alex', name: 'Alex Demo' })
    expect(groups.map(g => [g.title, g.favorites.map(f => f.label)])).toEqual([
      ['For Alex Demo', ['Semaglutide — Alex']],
      ['Peptides', ['BPC-157 daily cycling']],
      ['Hormones', ['biest 80/20', 'Estradiol 0.1% Cream', 'TRT Cyp 200 — Weekly']],
      ['Weight Management', ['Semaglutide']],
      ['Sexual Health', ['Tadalafil 10 Troche']],
      ['Nutrition', ['Zinc']],
      ['Other', ['LDN 4.5 Maintenance']],
    ])
  })

  it('without a patient, pinned favorites are not shown at all', () => {
    const titles = groupFavorites(favs, null).flatMap(g => g.favorites.map(f => f.label))
    expect(titles).not.toContain('Semaglutide — Alex')
    expect(titles).not.toContain('Semaglutide — Jordan')
  })

  it('derives the category from the catalog therapeutic_category', () => {
    expect(favoriteCategory("Women's Health")).toBe('Hormones')
    expect(favoriteCategory("Men's Health")).toBe('Hormones')
    expect(favoriteCategory('Weight Loss')).toBe('Weight Management')
    expect(favoriteCategory('Peptides')).toBe('Peptides')
    expect(favoriteCategory(null)).toBe('Other')
    expect(compareCategories('Peptides', 'Hormones')).toBeLessThan(0)
    expect(compareCategories('Other', 'Zinc')).toBeGreaterThan(0)
  })
})

describe('recentFormulations', () => {
  it('keeps the newest order per formulation, up to the limit, from structured fields only', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      formulation_id: `f-${i % 10}`,
      pharmacy_id: 'ph',
      created_at: `2026-09-${String(10 + i).padStart(2, '0')}T00:00:00Z`,
      medication_snapshot: { medication_name: `Drug ${i % 10}`, prescribed_dose: `${i + 1} units`, frequency_code: 'QW' },
    }))
    const recent = recentFormulations(rows)
    expect(recent).toHaveLength(8)
    expect(recent[0]).toEqual(expect.objectContaining({ formulation_id: 'f-1', preset: p('12') }))
    expect(recent.map(r => r.formulation_id)).toEqual(['f-1', 'f-0', 'f-9', 'f-8', 'f-7', 'f-6', 'f-5', 'f-4'])
  })
})

describe('migration 20260917000001 mirrors this module', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260917000001_wo104_favorite_presets.sql'), 'utf-8')

  it('maps the same catalog categories', () => {
    for (const [from, to] of Object.entries(CATEGORY_ALIASES)) {
      expect(sql).toContain(`WHEN trim(p_category) = '${from.replace("'", "''")}'`)
      expect(sql).toMatch(new RegExp(`'${from.replace("'", "''")}'\\s+THEN '${to}'`))
    }
    expect(FAVORITE_CATEGORY_ORDER).toEqual(expect.arrayContaining(['Peptides', 'Hormones', 'Weight Management']))
  })

  it('collapses on clinic + formulation + pharmacy + patient and keeps the presets', () => {
    expect(sql).toContain('GROUP BY p.clinic_id, f.formulation_id, f.pharmacy_id, f.patient_id')
    expect(sql).toContain("'dose',      wo104_dose_text(f.dose_amount)")
    // Seeded Semaglutide 20 / 40 units join the 10-unit favorite before the collapse.
    expect(sql).toMatch(/'Semaglutide 1\.0mg weekly', '20'/)
    expect(sql).toMatch(/'Semaglutide 2\.0mg weekly', '40'/)
    expect(sql).toContain('SELECT collapse_provider_favorites();')
  })
})

describe('durationDaysForLink — the sig fallback is legacy-link only', () => {
  it('a structured duration always wins, including "no duration"', () => {
    expect(durationDaysForLink(30, 'Inject 20 units once weekly for 90 days')).toBe(30)
    expect(durationDaysForLink(null, 'Inject 20 units once weekly for 90 days')).toBeNull()
  })

  it('only a link without the parameter reads the sig it carried', () => {
    expect(durationDaysForLink(undefined, 'Inject 20 units once weekly for 90 days')).toBe(90)
    expect(durationDaysForLink(undefined, undefined)).toBeNull()
  })
})
