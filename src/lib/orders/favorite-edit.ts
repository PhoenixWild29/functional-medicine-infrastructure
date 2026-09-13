// ============================================================
// WO-103: editable favorite — body validation (pure)
// ============================================================
//
// Shared by PATCH /api/favorites and its tests. A favorite's name,
// dose, frequency, pharmacy, sig and default quantity may be edited
// from the Favorites panel; everything else is fixed at save time.

import { DOSE_UNITS, isDoseUnit } from './dose-display'
import { FREQUENCY_OPTIONS } from '@/app/(clinic-app)/new-prescription/_components/structured-sig-builder.types'

export const FAVORITE_LABEL_MAX = 120
export const FAVORITE_SIG_MAX = 1000
export const FAVORITE_EDITABLE_FIELDS = [
  'label', 'dose_amount', 'dose_unit', 'frequency_code', 'pharmacy_id', 'sig_text', 'default_quantity',
] as const

export interface FavoriteEditPatch {
  label?:            string
  dose_amount?:      string
  dose_unit?:        string
  frequency_code?:   string
  pharmacy_id?:      string | null
  sig_text?:         string | null
  default_quantity?: string | null
}

export type FavoriteEditValidation =
  | { ok: true;  patch: FavoriteEditPatch }
  | { ok: false; error: string }

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
  if (r['dose_amount'] !== undefined) {
    const n = typeof r['dose_amount'] === 'number' ? r['dose_amount'] : parseFloat(String(r['dose_amount'] ?? ''))
    if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'dose_amount must be a positive number' }
    patch['dose_amount'] = String(n)
  }
  if (r['dose_unit'] !== undefined) {
    if (!isDoseUnit(r['dose_unit'])) return { ok: false, error: `dose_unit must be one of ${DOSE_UNITS.join(' | ')}` }
    patch['dose_unit'] = r['dose_unit']
  }
  if (r['frequency_code'] !== undefined) {
    const code = typeof r['frequency_code'] === 'string' ? r['frequency_code'].trim().toUpperCase() : ''
    if (!FREQUENCY_OPTIONS.some(f => f.code === code)) return { ok: false, error: 'frequency_code is not a builder frequency' }
    patch['frequency_code'] = code
  }
  if (r['pharmacy_id'] !== undefined) {
    if (r['pharmacy_id'] !== null && (typeof r['pharmacy_id'] !== 'string' || !r['pharmacy_id'].trim())) {
      return { ok: false, error: 'pharmacy_id must be a string or null' }
    }
    patch['pharmacy_id'] = r['pharmacy_id'] === null ? null : (r['pharmacy_id'] as string).trim()
  }
  if (r['sig_text'] !== undefined) {
    const sig = typeof r['sig_text'] === 'string' ? r['sig_text'].trim() : ''
    if (sig.length > FAVORITE_SIG_MAX) return { ok: false, error: `sig_text must be at most ${FAVORITE_SIG_MAX} characters` }
    patch['sig_text'] = sig || null
  }
  if (r['default_quantity'] !== undefined) {
    if (r['default_quantity'] !== null && typeof r['default_quantity'] !== 'string') {
      return { ok: false, error: 'default_quantity must be a string or null' }
    }
    const q = r['default_quantity'] === null ? null : (r['default_quantity'] as string).trim()
    patch['default_quantity'] = q || null
  }
  return { ok: true, patch }
}
