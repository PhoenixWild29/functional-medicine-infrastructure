// ============================================================
// Patient allergies / NKDA — WO-97
// ============================================================
//
// Pure helpers shared by the chip (patient selector card, session
// banner), the Review & Send notice, the PATCH /api/patients/[id]/
// allergies route, the Rx PDF and every pharmacy payload transformer.
//
// The patient row carries three columns (migration 20260912000002):
//   allergies            text[]      — one entry per allergen
//   nkda                 boolean     — No Known Drug Allergies confirmed
//   allergies_updated_at timestamptz — NULL = never recorded
//
// Exactly one of three states is derived from them:
//   nkda          — nkda = true
//   recorded      — one or more allergies listed
//   not_recorded  — neither (amber chip, non-blocking Review notice)
//
// Phase 21 rule 4: allergies are stored once on the patient and
// attached to every Rx automatically — nothing here is per-order.

// ── Types ─────────────────────────────────────────────────────

/** The allergy columns as they come off a `patients` row (or a session copy). */
export interface PatientAllergyFields {
  allergies?: readonly string[] | null
  nkda?:      boolean | null
}

export type AllergyStatus =
  | { kind: 'nkda' }
  | { kind: 'recorded'; allergies: string[] }
  | { kind: 'not_recorded' }

/** Validated body for PATCH /api/patients/[patientId]/allergies. */
export interface AllergiesPatch {
  allergies: string[]
  nkda:      boolean
}

// ── Limits ────────────────────────────────────────────────────

/** Hard caps so a paste of a whole chart cannot land on the row. */
export const MAX_ALLERGY_ENTRIES      = 50
export const MAX_ALLERGY_ENTRY_LENGTH = 120

// ── Normalisation ─────────────────────────────────────────────

/**
 * Turn free-form input — a comma / semicolon / newline separated string,
 * or an already-split array — into a clean list: trimmed, empty entries
 * dropped, internal whitespace collapsed, case-insensitive duplicates
 * removed (first spelling wins), entry length capped.
 */
export function normalizeAllergies(input: string | readonly string[] | null | undefined): string[] {
  if (input == null) return []
  const parts = typeof input === 'string' ? input.split(/[,;\n]/) : input
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of parts) {
    if (typeof raw !== 'string') continue
    const entry = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_ALLERGY_ENTRY_LENGTH)
    if (!entry) continue
    const key = entry.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
  }
  return out
}

// ── Status ────────────────────────────────────────────────────

export function allergyStatus(patient: PatientAllergyFields | null | undefined): AllergyStatus {
  if (!patient) return { kind: 'not_recorded' }
  if (patient.nkda === true) return { kind: 'nkda' }
  const allergies = normalizeAllergies(patient.allergies)
  if (allergies.length > 0) return { kind: 'recorded', allergies }
  return { kind: 'not_recorded' }
}

/** True when the clinic has recorded something (NKDA or a list). */
export function hasRecordedAllergies(patient: PatientAllergyFields | null | undefined): boolean {
  return allergyStatus(patient).kind !== 'not_recorded'
}

// ── Display ───────────────────────────────────────────────────

/** Chip text: "NKDA" · "Allergies: penicillin, sulfa" · "Allergies: not recorded". */
export function allergyChipLabel(patient: PatientAllergyFields | null | undefined): string {
  const status = allergyStatus(patient)
  switch (status.kind) {
    case 'nkda':         return 'NKDA'
    case 'recorded':     return `Allergies: ${status.allergies.join(', ')}`
    case 'not_recorded': return 'Allergies: not recorded'
  }
}

/**
 * Value printed on the Rx PDF and sent in pharmacy payloads as a single
 * string: "NKDA" · "penicillin, sulfa" · "Not recorded".
 */
export function allergiesForPayload(patient: PatientAllergyFields | null | undefined): string {
  const status = allergyStatus(patient)
  switch (status.kind) {
    case 'nkda':         return 'NKDA'
    case 'recorded':     return status.allergies.join(', ')
    case 'not_recorded': return 'Not recorded'
  }
}

// ── Validation (API boundary) ─────────────────────────────────

export type AllergiesPatchResult =
  | { ok: true;  value: AllergiesPatch }
  | { ok: false; error: string }

/**
 * Validate and normalise a PATCH body. Accepts `allergies` as an array
 * or a delimited string and `nkda` as a boolean; either may be omitted.
 * NKDA and a non-empty list are mutually exclusive (mirrors the CHECK
 * constraint): sending both is rejected rather than silently resolved,
 * so a stale client cannot wipe a recorded allergy by ticking NKDA.
 */
export function validateAllergiesPatch(body: unknown): AllergiesPatchResult {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Body must be a JSON object' }
  }
  const b = body as Record<string, unknown>

  let allergies: string[] = []
  if (b['allergies'] !== undefined && b['allergies'] !== null) {
    const raw = b['allergies']
    if (typeof raw !== 'string' && !Array.isArray(raw)) {
      return { ok: false, error: 'allergies must be an array of strings or a comma-separated string' }
    }
    if (Array.isArray(raw) && raw.some(x => typeof x !== 'string')) {
      return { ok: false, error: 'allergies must contain only strings' }
    }
    allergies = normalizeAllergies(raw as string | string[])
    if (allergies.length > MAX_ALLERGY_ENTRIES) {
      return { ok: false, error: `allergies may list at most ${MAX_ALLERGY_ENTRIES} entries` }
    }
  }

  let nkda = false
  if (b['nkda'] !== undefined && b['nkda'] !== null) {
    if (typeof b['nkda'] !== 'boolean') {
      return { ok: false, error: 'nkda must be a boolean' }
    }
    nkda = b['nkda']
  }

  if (nkda && allergies.length > 0) {
    return { ok: false, error: 'nkda cannot be true when allergies are listed' }
  }

  return { ok: true, value: { allergies, nkda } }
}
