// ============================================================
// EPCS audit rows: where the request came from, as keyed hashes
// ============================================================
//
// Compliance C10: epcs_audit_log stored the raw client IP and user agent.
// New rows store their HMAC-SHA256 (lib/audit/keyed-hash, the same key
// and form as phi_access_log) in ip_hash and user_agent_hash, and leave
// ip_address and user_agent NULL. Rows written before 20261011000001 keep
// their raw values (the table is append-only). Without
// PHI_ACCESS_LOG_HASH_SECRET no hash is written, and never the raw value.

import { AUDIT_HASH_SECRET_ENV, auditHash, clientIp } from '@/lib/audit/keyed-hash'

export interface EpcsRequestFields {
  ip_address:      null
  user_agent:      null
  ip_hash:         string | null
  user_agent_hash: string | null
}

let warnedNoSecret = false

/** From the request headers (the client IP is the first x-forwarded-for entry). */
export async function epcsRequestFields(headers: Headers | null | undefined): Promise<EpcsRequestFields> {
  return epcsRequestFieldsFrom(clientIp(headers), headers?.get('user-agent') ?? null)
}

/** From an IP (an x-forwarded-for list is cut to its first entry) and a user agent. */
export async function epcsRequestFieldsFrom(ip: string | null | undefined, userAgent: string | null | undefined): Promise<EpcsRequestFields> {
  if (!process.env[AUDIT_HASH_SECRET_ENV] && !warnedNoSecret) {
    warnedNoSecret = true
    console.warn(`[epcs-audit] ${AUDIT_HASH_SECRET_ENV} is not set: IP and user agent hashes are left empty`)
  }
  const [ipHash, userAgentHash] = await Promise.all([
    auditHash(ip?.split(',')[0]?.trim() || null),
    auditHash(userAgent ?? null),
  ])
  return { ip_address: null, user_agent: null, ip_hash: ipHash, user_agent_hash: userAgentHash }
}
