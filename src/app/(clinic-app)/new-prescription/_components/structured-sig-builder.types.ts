// ============================================================
// WO-84: Structured Sig Builder — Shared Types & Constants
// ============================================================

// ── Frequency codes (NCPDP-aligned) ─────────────────────────

export const FREQUENCY_OPTIONS = [
  { code: 'QD', display: 'Once daily', sig: 'once daily' },
  { code: 'BID', display: 'Twice daily', sig: 'twice daily' },
  { code: 'TID', display: 'Three times daily', sig: 'three times daily' },
  { code: 'QID', display: 'Four times daily', sig: 'four times daily' },
  { code: 'QHS', display: 'At bedtime', sig: 'at bedtime' },
  { code: 'QW', display: 'Once weekly', sig: 'once weekly' },
  { code: 'Q2W', display: 'Every 2 weeks', sig: 'every 2 weeks' },
  { code: 'QOD', display: 'Every other day', sig: 'every other day' },
  { code: 'MF', display: 'Mon-Fri (weekends off)', sig: 'Monday through Friday, weekends off' },
  { code: 'TIW', display: '2-3 times per week', sig: '2-3 times per week' },
  { code: 'PRN', display: 'As needed', sig: 'as needed' },
] as const

// ── Timing options ──────────────────────────────────────────

export const TIMING_OPTIONS = [
  { code: '', display: '(no timing)', sig: '' },
  { code: 'BEDTIME', display: 'At bedtime', sig: 'at bedtime' },
  { code: 'MORNING', display: 'In the morning', sig: 'in the morning' },
  { code: 'WITH_BREAKFAST', display: 'With breakfast', sig: 'with breakfast' },
  { code: 'WITH_FOOD', display: 'With food', sig: 'with food' },
  { code: 'EMPTY_STOMACH', display: 'On an empty stomach', sig: 'on an empty stomach' },
  { code: 'BEFORE_MEALS', display: '30 min before meals', sig: '30 minutes before meals' },
  { code: 'AFTER_MEALS', display: 'After meals', sig: 'after meals' },
  { code: 'EVENING', display: 'In the evening', sig: 'in the evening' },
] as const

// ── Duration options ────────────────────────────────────────

export const DURATION_OPTIONS = [
  { code: '', display: '(no duration)', sig: '' },
  { code: '7', display: 'For 7 days', sig: 'for 7 days' },
  { code: '14', display: 'For 14 days', sig: 'for 14 days' },
  { code: '30', display: 'For 30 days', sig: 'for 30 days' },
  { code: '60', display: 'For 60 days', sig: 'for 60 days' },
  { code: '90', display: 'For 90 days', sig: 'for 90 days' },
  { code: 'ONGOING', display: 'Ongoing', sig: 'ongoing' },
  { code: 'CUSTOM', display: 'Custom...', sig: '' },
] as const

// ── Titration step intervals ────────────────────────────────

export const TITRATION_INTERVALS = [
  { code: 'Q3-4D', display: 'Every 3-4 days', sig: 'every 3-4 days' },
  { code: 'QW', display: 'Every week', sig: 'every week' },
  { code: 'Q2W', display: 'Every 2 weeks', sig: 'every 2 weeks' },
  { code: 'Q4W', display: 'Every 4 weeks', sig: 'every 4 weeks' },
  { code: 'CUSTOM', display: 'Custom...', sig: '' },
] as const

// ── Type interfaces ─────────────────────────────────────────

export interface FormulationSigData {
  concentration_value: number | null
  concentration_unit: string | null
  dosage_forms: { name: string } | null
  routes_of_administration: {
    name: string
    abbreviation: string
    sig_prefix: string
  } | null
}

export interface TitrationConfig {
  startDose: string
  startUnit: string
  increment: string
  incrementUnit: string
  interval: string
  customInterval: string
  targetDose: string
  targetUnit: string
}

export interface CyclingConfig {
  onDays: string
  offDays: string
  cycleDuration: string
  cycleDurationUnit: string
  restPeriod: string
}

// ── NCPDP sig character limit ───────────────────────────────

export const NCPDP_SIG_LIMIT = 1000
export const NCPDP_SIG_WARNING = 900
