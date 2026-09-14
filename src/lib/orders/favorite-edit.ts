// ============================================================
// WO-103 / WO-104: editable favorite — body validation (pure)
// ============================================================
//
// Shared by PATCH /api/favorites and its tests. A favorite's name,
// pharmacy, common doses (WO-104 dose_presets) and patient scope may be
// edited from the Favorites panel; the formulation is fixed at save time
// and the category is derived from it.

import { validateDosePresets, type DosePreset } from './favorite-presets'

export const FAVORITE_LABEL_MAX = 120
export const FAVORITE_EDITABLE_FIELDS = [
  'label', 'pharmacy_id', 'dose_presets', 'patient_id',
] as const

export interface FavoriteEditPatch {
  label?:        string
  pharmacy_id?:  string | null
  dose_presets?: DosePreset[]
  /** null = for the practice; a patient id = pinned to that patient */
  patient_id?:   string | null
}

export type FavoriteEditValidation =
  | { ok: true;  patch: FavoriteEditPatch }
  | { ok: false; error: string }

function optionalId(raw: unknown, field: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null) return { ok: true, value: null }
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: `${field} must be a string or null` }
  return { ok: true, value: raw.trim() }
}

/** Validate the editable subset of a favorite. Unknown keys are ignored. */
export function validateFavoriteEdit(raw: unknown): FavoriteEditValidation {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: true, patch: {} }
  const r = raw as Record<string, unknown>
  const patch: FavoriteEditPatch = {}

  if (r['label'] !== undefined) {
    const label = typeof r['label'] === 'string' ? r['label'].trim() : ''
    if (!label) return { ok: false, error: 'label must be a non-empty string' }
    if (label.length > FAVORITE_LABEL_MAX) return { ok: false, error: `label must be at most ${FAVORITE_LABEL_MAX} characters` }
    patch['label'] = label
  }
  if (r['pharmacy_id'] !== undefined) {
    const v = optionalId(r['pharmacy_id'], 'pharmacy_id')
    if (!v.ok) return v
    patch['pharmacy_id'] = v.value
  }
  if (r['dose_presets'] !== undefined) {
    const v = validateDosePresets(r['dose_presets'])
    if (!v.ok) return v
    patch['dose_presets'] = v.presets
  }
  if (r['patient_id'] !== undefined) {
    const v = optionalId(r['patient_id'], 'patient_id')
    if (!v.ok) return v
    patch['patient_id'] = v.value
  }
  return { ok: true, patch }
}
