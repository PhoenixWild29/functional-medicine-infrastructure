// ============================================================
// Keyed hashes for audit rows (HMAC-SHA256, hex)
// ============================================================
//
// Shared by phi_access_log (lib/audit/phi-access) and epcs_audit_log
// (lib/epcs/audit-request): an email, IP or user agent is stored only as
// HMAC-SHA256 with the server secret PHI_ACCESS_LOG_HASH_SECRET, so "was
// it this IP?" can be answered by hashing the candidate, but the row
// alone reveals nothing. One key and one form, so the two logs can be
// matched against each other.

export const AUDIT_HASH_SECRET_ENV = 'PHI_ACCESS_LOG_HASH_SECRET'

/** HMAC-SHA256 of value under the audit secret, 64 hex; null without a value or a secret. */
export async function auditHash(value: string | null | undefined): Promise<string | null> {
  const secret = process.env[AUDIT_HASH_SECRET_ENV]
  if (!value || !secret) return null
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** The client IP: the first x-forwarded-for entry, else x-real-ip. */
export function clientIp(headers: Headers | null | undefined): string | null {
  if (!headers) return null
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || headers.get('x-real-ip')?.trim() || null
}
