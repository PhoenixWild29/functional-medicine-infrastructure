// ============================================================
// WO-104: Favorites model — drug → common doses (pure)
// ============================================================
//
// Gina Rooks, 2026-09-11: saving every unit dose of semaglutide as its
// own favorite is "kind of busy"; she wants to click "semaglutide
// injection" and see the common doses written out, add a custom one,
// see the list sorted by category, and have a Recent section she can
// turn into favorites.
//
// A favorite is now a drug + formulation + pharmacy (optionally pinned
// to one patient). Its common doses are `dose_presets`, an array of
// structured presets. Clicking a preset chip opens the builder's dose
// step with every dropdown populated from these fields — the sig is
// generated there, never stored on the favorite and never parsed back.
//
// No React, no I/O. Shared by /api/favorites, the Favorites panel, the
// builder and the tests. The category mapping and order below are
// mirrored in migration 20260917000001 (a jest test keeps them in sync).

import {
  DURATION_OPTIONS,
  FREQUENCY_OPTIONS,
  TIMING_OPTIONS,
} from '@/app/(clinic-app)/new-prescription/_components/structured-sig-builder.types'
import { formatDoseWithMg, formatPlainDose, frequencyShortLabel, isDoseUnit, type ConcentrationSource } from './dose-display'
import { parseTitrationSteps, type TitrationStep, type SigMode } from '@/lib/orders/titration'
import { cycleLengthFrom, cyclePatternFrom, type CycleSchedule } from '@/lib/orders/cycling'

// ── Preset shape ─────────────────────────────────────────────

export interface DosePreset {
  /** "20" — the dose amount, as the builder's Amount field holds it */
  dose:      string
  /** "units" — one of DOSE_UNITS */
  unit:      string
  /** builder frequency code ("QW"), '' when not set */
  frequency: string
  /** builder timing code ("MORNING"), '' for none */
  timing:    string
  /** days as a string ("30", "45"), "ONGOING", or '' for no duration */
  duration:  string
  /** optional name the clinic gave this dose; the chip shows the dose */
  label:     string | null
  /**
   * Cycling dose math: set on a CHIP built from a cycling favorite
   * (favoritePresetsForChips), never stored in dose_presets — the mode
   * and the pattern belong to the favorite. A chip that carries them
   * opens the dose step in cycling mode.
   */
  sigMode?:  SigMode
  cycle?:    CycleSchedule | null
}

export const MAX_DOSE_PRESETS = 20
export const PRESET_LABEL_MAX = 120

export type PresetValidation =
  | { ok: true;  preset: DosePreset }
  | { ok: false; error: string }

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : ''
}

/** Validate one preset. Codes must be builder codes so the dropdowns can hold them. */
export function validateDosePreset(raw: unknown): PresetValidation {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'preset must be an object' }
  const r = raw as Record<string, unknown>
  const n = parseFloat(str(r['dose']))
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'preset dose must be a positive number' }
  const unit = str(r['unit'])
  if (!isDoseUnit(unit)) return { ok: false, error: 'preset unit is not a builder dose unit' }
  const frequency = str(r['frequency']).toUpperCase()
  if (frequency && !FREQUENCY_OPTIONS.some(f => f.code === frequency)) return { ok: false, error: 'preset frequency is not a builder frequency' }
  const timing = str(r['timing']).toUpperCase()
  if (timing && !TIMING_OPTIONS.some(t => t.code === timing)) return { ok: false, error: 'preset timing is not a builder timing' }
  const durationRaw = str(r['duration']).toUpperCase()
  let duration = ''
  if (durationRaw === 'ONGOING') duration = 'ONGOING'
  else if (durationRaw) {
    const days = parseInt(durationRaw, 10)
    if (!/^\d{1,4}$/.test(durationRaw) || days <= 0) return { ok: false, error: 'preset duration must be a number of days or ONGOING' }
    duration = String(days)
  }
  const label = str(r['label'])
  if (label.length > PRESET_LABEL_MAX) return { ok: false, error: `preset label must be at most ${PRESET_LABEL_MAX} characters` }
  return { ok: true, preset: { dose: String(n), unit, frequency, timing, duration, label: label || null } }
}

export function validateDosePresets(raw: unknown): { ok: true; presets: DosePreset[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'dose_presets must be an array' }
  if (raw.length === 0) return { ok: false, error: 'a favorite needs at least one dose' }
  if (raw.length > MAX_DOSE_PRESETS) return { ok: false, error: `at most ${MAX_DOSE_PRESETS} doses per favorite` }
  const presets: DosePreset[] = []
  for (const item of raw) {
    const v = validateDosePreset(item)
    if (!v.ok) return v
    presets.push(v.preset)
  }
  return { ok: true, presets: mergePresets([], presets) }
}

/** Two presets are the same dose when every structured field matches (the label does not count). */
export function presetKey(p: DosePreset): string {
  const base = [p.dose, p.unit, p.frequency, p.timing, p.duration].join('|')
  // A cycling chip is a different dose from the same amount taken daily.
  if (p.sigMode !== 'cycling') return base
  return `${base}|cycling:${p.cycle ? `${p.cycle.onDays}/${p.cycle.offDays}/${p.cycle.lengthDays ?? 'ongoing'}` : 'none'}`
}

/**
 * Existing presets plus incoming ones, duplicates dropped (the first
 * label wins), ordered by unit in order of first appearance and then by
 * dose ascending — 10 units · 20 units · 40 units.
 */
export function mergePresets(existing: ReadonlyArray<DosePreset>, incoming: ReadonlyArray<DosePreset>): DosePreset[] {
  const seen = new Set<string>()
  const out: DosePreset[] = []
  for (const p of [...existing, ...incoming]) {
    const key = presetKey(p)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  const unitOrder = new Map<string, number>()
  out.forEach(p => { if (!unitOrder.has(p.unit)) unitOrder.set(p.unit, unitOrder.size) })
  return out
    .map((p, i) => ({ p, i }))
    .sort((a, b) =>
      (unitOrder.get(a.p.unit)! - unitOrder.get(b.p.unit)!)
      || (parseFloat(a.p.dose) - parseFloat(b.p.dose))
      || (a.i - b.i))
    .map(x => x.p)
}

/** Presets read from the database. Rows written before validation are tolerated: bad entries are dropped. */
export function presetsFromJson(raw: unknown): DosePreset[] {
  if (!Array.isArray(raw)) return []
  const out: DosePreset[] = []
  for (const item of raw) {
    const v = validateDosePreset(item)
    if (v.ok) out.push(v.preset)
  }
  return out
}

// ── Chip text ────────────────────────────────────────────────

/** Chip text: primary "20 units", secondary "(1.0 mg) weekly". Computed, never typed. */
export function presetChipText(p: DosePreset, concentration: ConcentrationSource | null | undefined): { primary: string; secondary: string } {
  const primary = formatPlainDose(p.dose, p.unit)
  const withMg = formatDoseWithMg(p.dose, p.unit, concentration)
  const mg = withMg.startsWith(primary) ? withMg.slice(primary.length).trim() : ''
  const freq = frequencyShortLabel(p.frequency)
  return { primary, secondary: [mg, freq].filter(Boolean).join(' ') }
}

// ── Builder load (structured end to end) ─────────────────────

/**
 * What the builder's dose step is populated with when a favorite chip,
 * the Custom chip or a Recent item is clicked. Every field is a builder
 * value; there is no sig here, so nothing downstream can parse one.
 */
export interface FavoriteBuilderLoad {
  formulationId:      string
  pharmacyId:         string
  doseAmount:         string
  doseUnit:           string
  frequency:          string
  timing:             string
  /** builder Duration dropdown code: '', '7' … '90', 'ONGOING' or 'CUSTOM' */
  duration:           string
  customDurationDays: string
  refills:            number
  /**
   * WO-105: a titration favorite loads the dose step in titration mode
   * with its step table filled in. Before this, applying "LDN Starter —
   * Titration" produced a standard sig and silently dropped the
   * schedule, which is the opposite of what a saved titration is for.
   */
  sigMode:            SigMode
  titrationSteps:     TitrationStep[]
  /**
   * Cycling dose math: a cycling favorite's pattern and cycle length.
   * null for every other favorite, AND for a cycling favorite saved
   * before the pattern was stored — which still opens in cycling mode
   * and asks for the days on and off rather than dosing daily.
   */
  cycle:              CycleSchedule | null
}

/** Builder Duration dropdown value for a preset duration ("30" → "30"; "45" → CUSTOM + 45). */
export function builderDurationFromPreset(duration: string): { duration: string; customDurationDays: string } {
  if (!duration) return { duration: '', customDurationDays: '' }
  if (duration === 'ONGOING') return { duration: 'ONGOING', customDurationDays: '' }
  if (DURATION_OPTIONS.some(d => d.code === duration && /^\d+$/.test(d.code))) return { duration, customDurationDays: '' }
  return { duration: 'CUSTOM', customDurationDays: duration }
}

/** The reverse: the builder's Duration dropdown (+ custom days) as a preset duration. */
export function presetDurationFromBuilder(duration: string, customDurationDays: string): string {
  if (duration === 'ONGOING') return 'ONGOING'
  const days = parseInt(duration === 'CUSTOM' ? customDurationDays : duration, 10)
  return Number.isFinite(days) && days > 0 ? String(days) : ''
}

/** Preset duration for a structured day count (the margin page's durationDays). */
export function presetDurationFromDays(days: number | null | undefined): string {
  return typeof days === 'number' && Number.isFinite(days) && days > 0 ? String(Math.round(days)) : ''
}

export interface FavoriteLoadSource {
  formulation_id:  string
  pharmacy_id:     string | null
  default_refills: number | null
  /** WO-105: 'titration' + steps for a saved titration. */
  sig_mode?:        string | null
  titration_steps?: unknown
  /** Cycling dose math: the stored pattern and cycle length of a cycling favorite. */
  cycle_on_days?:       number | null
  cycle_off_days?:      number | null
  cycle_duration_days?: number | null
}

/**
 * A cycling favorite's pattern + cycle length, or null (not cycling, or
 * saved before the pattern was stored).
 */
export function favoriteCycle(fav: FavoriteLoadSource): CycleSchedule | null {
  if (fav.sig_mode !== 'cycling') return null
  const pattern = cyclePatternFrom(fav.cycle_on_days, fav.cycle_off_days)
  return pattern ? { ...pattern, lengthDays: cycleLengthFrom(fav.cycle_duration_days) } : null
}

/**
 * The dose-step chips for one favorite: its presets, marked cycling (with
 * the favorite's pattern) when the favorite is. Before this every chip
 * opened in Standard mode.
 */
export function favoritePresetsForChips(fav: FavoriteLoadSource & { dose_presets: ReadonlyArray<DosePreset> }): DosePreset[] {
  if (fav.sig_mode !== 'cycling') return [...fav.dose_presets]
  const cycle = favoriteCycle(fav)
  return fav.dose_presets.map(p => ({ ...p, sigMode: 'cycling' as const, cycle }))
}

/**
 * A preset chip → the dose step with amount, unit, frequency, timing and
 * duration set. `preset === null` is the Custom chip: the formulation and
 * pharmacy are pre-selected and the dose fields are left empty.
 */
export function builderLoadFromFavorite(fav: FavoriteLoadSource, preset: DosePreset | null): FavoriteBuilderLoad {
  const dur = builderDurationFromPreset(preset?.duration ?? '')
  return {
    formulationId:      fav.formulation_id,
    pharmacyId:         fav.pharmacy_id ?? '',
    doseAmount:         preset?.dose ?? '',
    doseUnit:           preset?.unit ?? '',
    frequency:          preset?.frequency ?? '',
    timing:             preset?.timing ?? '',
    duration:           dur.duration,
    customDurationDays: dur.customDurationDays,
    refills:            typeof fav.default_refills === 'number' ? fav.default_refills : 0,
    // Steps only count when the favorite is actually a titration; a
    // stale steps column on a standard favorite is ignored.
    sigMode:            fav.sig_mode === 'titration' ? 'titration' : fav.sig_mode === 'cycling' ? 'cycling' : 'standard',
    titrationSteps:     fav.sig_mode === 'titration' ? parseTitrationSteps(fav.titration_steps) : [],
    cycle:              favoriteCycle(fav),
  }
}

// ── Categories ───────────────────────────────────────────────

/** Fixed display order. Anything else sorts A–Z after these, "Other" last. */
export const FAVORITE_CATEGORY_ORDER = [
  'Peptides',
  'Hormones',
  'Weight Management',
  'Sexual Health',
  'Thyroid',
  'Adrenal',
  'Longevity',
  'Autoimmune',
  'IV Therapy',
  'Dermatology',
  'Hair Restoration',
  'Mental Health',
  'Pain Management',
] as const

export const OTHER_CATEGORY = 'Other'

/** Catalog therapeutic_category → favorite category, where the catalog names differ. */
export const CATEGORY_ALIASES: Readonly<Record<string, string>> = {
  "Women's Health": 'Hormones',
  "Men's Health":   'Hormones',
  'Weight Loss':    'Weight Management',
  'Anti-Aging':     'Longevity',
}

/** Derived from the formulation's ingredient — nothing for the provider to type. */
export function favoriteCategory(therapeuticCategory: string | null | undefined): string {
  const c = (therapeuticCategory ?? '').trim()
  if (!c) return OTHER_CATEGORY
  return CATEGORY_ALIASES[c] ?? c
}

export function compareCategories(a: string, b: string): number {
  const rank = (c: string) => {
    if (c === OTHER_CATEGORY) return FAVORITE_CATEGORY_ORDER.length + 1
    const i = (FAVORITE_CATEGORY_ORDER as ReadonlyArray<string>).indexOf(c)
    return i === -1 ? FAVORITE_CATEGORY_ORDER.length : i
  }
  return (rank(a) - rank(b)) || a.localeCompare(b)
}

export interface GroupableFavorite {
  label:      string
  category:   string | null
  patient_id: string | null
}

export interface FavoriteGroup<T> {
  key:       string
  title:     string
  favorites: T[]
}

const byLabel = <T extends GroupableFavorite>(a: T, b: T) =>
  a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })

/**
 * Panel sections: the selected patient's own favorites first, then one
 * group per category in the fixed order, A–Z by name inside every group.
 * Favorites pinned to a different patient are not shown.
 */
export function groupFavorites<T extends GroupableFavorite>(
  favorites: ReadonlyArray<T>,
  patient: { patientId: string; name: string } | null,
): FavoriteGroup<T>[] {
  const groups: FavoriteGroup<T>[] = []
  const mine = patient ? favorites.filter(f => f.patient_id === patient.patientId) : []
  if (patient && mine.length > 0) {
    groups.push({ key: `patient:${patient.patientId}`, title: `For ${patient.name}`, favorites: [...mine].sort(byLabel) })
  }
  const byCategory = new Map<string, T[]>()
  for (const f of favorites) {
    if (f.patient_id) continue
    const c = favoriteCategory(f.category)
    byCategory.set(c, [...(byCategory.get(c) ?? []), f])
  }
  for (const c of [...byCategory.keys()].sort(compareCategories)) {
    groups.push({ key: `category:${c}`, title: c, favorites: byCategory.get(c)!.sort(byLabel) })
  }
  return groups
}

// ── Recent ───────────────────────────────────────────────────

export const RECENT_LIMIT = 8

export interface RecentOrderRow {
  formulation_id:      string | null
  pharmacy_id:         string | null
  created_at:          string
  medication_snapshot: unknown
}

export interface RecentFormulation {
  formulation_id:  string
  pharmacy_id:     string | null
  medication_name: string
  last_prescribed_at: string
  /** the last prescribed dose as a preset, or null when the order carried none */
  preset:          DosePreset | null
}

const PURE_DOSE = /^\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)\s*$/

/**
 * The last `limit` distinct formulations from a provider's orders
 * (newest first), each with the pharmacy and structured dose of its most
 * recent order. The dose comes from medication_snapshot.prescribed_dose /
 * frequency_code — the structured inputs — never from sig_text.
 */
export function recentFormulations(rows: ReadonlyArray<RecentOrderRow>, limit = RECENT_LIMIT): RecentFormulation[] {
  const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const seen = new Set<string>()
  const out: RecentFormulation[] = []
  for (const row of sorted) {
    if (!row.formulation_id || seen.has(row.formulation_id)) continue
    seen.add(row.formulation_id)
    const snap = (row.medication_snapshot ?? {}) as Record<string, unknown>
    const doseMatch = PURE_DOSE.exec(typeof snap['prescribed_dose'] === 'string' ? snap['prescribed_dose'] : '')
    const candidate = doseMatch
      ? validateDosePreset({
          dose: doseMatch[1], unit: normaliseUnit(doseMatch[2]!),
          frequency: typeof snap['frequency_code'] === 'string' ? snap['frequency_code'] : '',
          timing: '', duration: '', label: null,
        })
      : null
    out.push({
      formulation_id:     row.formulation_id,
      pharmacy_id:        row.pharmacy_id,
      medication_name:    typeof snap['medication_name'] === 'string' ? snap['medication_name'] : 'Medication',
      last_prescribed_at: row.created_at,
      preset:             candidate?.ok ? candidate.preset : null,
    })
    if (out.length >= limit) break
  }
  return out
}

function normaliseUnit(u: string): string {
  const l = u.toLowerCase()
  if (l.startsWith('unit')) return 'units'
  if (l === 'ml') return 'mL'
  if (l.startsWith('tablet')) return 'tablet'
  if (l.startsWith('capsule')) return 'capsule'
  if (l.startsWith('click')) return 'click'
  return l
}
