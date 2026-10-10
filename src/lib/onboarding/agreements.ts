// ============================================================
// Onboarding agreements: server-side hashing
// ============================================================
//
// An acceptance records the SHA-256 of the exact template text, computed
// HERE from the server's copy (never a hash the browser sends), with the
// template version. Server-only (node:crypto); the texts themselves live
// in ./agreement-texts so the wizard can show them.

import { createHash } from 'node:crypto'

export { AGREEMENTS, DRAFT_BANNER, isAgreementKey, type AgreementKey, type AgreementTemplate } from './agreement-texts'

export function agreementSha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
