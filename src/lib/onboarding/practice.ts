// ============================================================
// Practice details (onboarding step 1)
// ============================================================
//
// Legal name, DBA, address, phone, practice NPI (Type 2, optional), the
// last 4 digits of the tax ID ONLY (a whole tax ID is refused, never
// truncated and stored), and who pays shipping. Business information
// about the practice; no patient data.

import { npiChecksumValid } from '@/lib/providers/npi'
import { US_STATES } from '@/lib/providers/states'

export interface PracticeDetails {
  legalName:      string
  dbaName:        string | null
  addressLine1:   string
  addressLine2:   string | null
  city:           string
  state:          string
  postalCode:     string
  phone:          string
  practiceNpi:    string | null
  taxIdLast4:     string
  absorbShipping: boolean
}

export type PracticeField = keyof PracticeDetails

export type PracticeValidation =
  | { ok: true; value: PracticeDetails }
  | { ok: false; errors: Partial<Record<PracticeField, string>> }

const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export function validatePracticeDetails(input: unknown): PracticeValidation {
  const b = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const errors: Partial<Record<PracticeField, string>> = {}

  const legalName    = str(b['legalName'])
  const dbaName      = str(b['dbaName'])
  const addressLine1 = str(b['addressLine1'])
  const addressLine2 = str(b['addressLine2'])
  const city         = str(b['city'], 100)
  const state        = str(b['state'], 2).toUpperCase()
  const postalCode   = str(b['postalCode'], 10)
  const phone        = str(b['phone'], 30).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  const practiceNpi  = str(b['practiceNpi'], 20).replace(/\s/g, '')
  const rawTaxId     = typeof b['taxIdLast4'] === 'string' ? b['taxIdLast4'].trim() : ''

  if (!legalName) errors.legalName = 'Enter the practice’s legal name.'
  if (!addressLine1) errors.addressLine1 = 'Enter the street address.'
  if (!city) errors.city = 'Enter the city.'
  if (!US_STATES.has(state)) errors.state = 'Choose the state.'
  if (!/^\d{5}(-\d{4})?$/.test(postalCode)) errors.postalCode = 'Enter a 5-digit ZIP code (or ZIP+4).'
  if (!/^\d{10}$/.test(phone)) errors.phone = 'Enter a 10-digit US phone number.'
  if (practiceNpi && !(/^\d{10}$/.test(practiceNpi) && npiChecksumValid(practiceNpi))) {
    errors.practiceNpi = 'That is not a valid NPI (10 digits, with a matching check digit). Leave it blank if the practice has none.'
  }
  if (!/^\d{4}$/.test(rawTaxId)) {
    errors.taxIdLast4 = 'Enter only the last 4 digits of the tax ID, never the whole number.'
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      legalName,
      dbaName:        dbaName || null,
      addressLine1,
      addressLine2:   addressLine2 || null,
      city,
      state,
      postalCode,
      phone,
      practiceNpi:    practiceNpi || null,
      taxIdLast4:     rawTaxId,
      absorbShipping: b['absorbShipping'] === true,
    },
  }
}
