// ============================================================
// Phone numbers in E.164 (pure)
// ============================================================
//
// patients.phone_e164 is the one form a phone is matched in: a STOP reply
// arrives as From=+15125550123, and the duplicate-patient check compares
// (clinic, phone, date of birth). The rule is the migration's backfill
// (20261006000001), so a number typed today matches one stored before:
//   - "+" then 8 to 15 digits, not starting with 0;
//   - 10 digits, a US number (area code 2-9);
//   - 11 digits starting with 1, a US number with its country code.
// Anything else is null: an unmatched number is never guessed at.

export function toE164(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim()
  if (!text) return null
  const digits = text.replace(/[^0-9]/g, '')
  if (text.startsWith('+')) return /^[1-9][0-9]{7,14}$/.test(digits) ? `+${digits}` : null
  if (/^[2-9][0-9]{9}$/.test(digits)) return `+1${digits}`
  if (/^1[2-9][0-9]{9}$/.test(digits)) return `+${digits}`
  return null
}

/**
 * A patients write with phone_e164 set from its phone, by the rule above.
 * Every insert, upsert or update that sets phone goes through this, so the
 * number a STOP reply arrives from always matches (a scan in
 * __tests__/phone-e164-on-write enforces it). A write without phone is
 * returned as it is.
 */
export function withPhoneE164<T extends object>(row: T): T & { phone_e164?: string | null } {
  if (!('phone' in row)) return row
  const phone = row.phone
  return { ...row, phone_e164: toE164(typeof phone === 'string' ? phone : null) }
}
