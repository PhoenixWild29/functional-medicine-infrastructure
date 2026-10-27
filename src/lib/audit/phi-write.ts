// ============================================================
// Writes are logged first (C-2026-10-26-04, review L1)
// ============================================================
//
// A write that touches PHI writes its phi_access_log row BEFORE the write,
// and does not run when that row cannot be written (B15: writes must not
// commit unrecorded):
//
//   if (!(await logPhiAccess(entry))) return phiWriteRefused()
//   const { error } = await write()
//   if (error) { await logPhiWriteNotCompleted(entry); ... }
//
// A create whose id only exists after the insert gets its id generated
// first (crypto.randomUUID()) and passed to the insert, so the row can
// name it.

import { NextResponse } from 'next/server'

export const PHI_WRITE_REFUSED_MESSAGE = 'This change could not be recorded. Nothing was changed. Try again.'

/** The 503 for a write refused because its log row could not be written. */
export function phiWriteRefused(headers?: HeadersInit): NextResponse {
  return NextResponse.json({ error: PHI_WRITE_REFUSED_MESSAGE }, { status: 503, ...(headers ? { headers } : {}) })
}
