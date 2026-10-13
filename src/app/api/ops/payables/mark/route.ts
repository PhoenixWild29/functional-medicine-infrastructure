// ============================================================
// Pharmacy payables — POST /api/ops/payables/mark
// ============================================================
//
// Marks payables scheduled, or paid with a reference and a date. Records a
// payment ops made outside this system: nothing here moves money.
//
//   { payableIds: uuid[], action: 'mark_scheduled' }
//   { payableIds: uuid[], action: 'mark_paid', reference: string, paidOn: 'YYYY-MM-DD' }
//
// Only owed lines can be scheduled; only owed or scheduled lines can be
// paid (a paid or void line is never changed). Each changed line is
// logged in payable_events with who did it.
//
// Auth: ops_admin only (getUser(), app_metadata). Service-role writes.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireOpsAdmin } from '@/lib/payments/ops-auth'
import { UUID_RE, isIsoDate } from '@/lib/payments/payables'

const MAX_IDS = 500
// A bank or ACH reference: printable, no control characters.
const REFERENCE_RE = /^[\x20-\x7E]{1,120}$/

const bad = (error: string) => NextResponse.json({ error }, { status: 400 })

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireOpsAdmin()
  if (auth.denied) return auth.denied

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return bad('Invalid JSON')
  }

  const ids = body['payableIds']
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every(id => typeof id === 'string' && UUID_RE.test(id))) {
    return bad('payableIds must be 1 to 500 payable IDs')
  }
  const payableIds = [...new Set(ids as string[])]

  const action = body['action']
  let patch: Record<string, unknown>
  let from: string[]
  let reference: string | null = null
  let paidOn: string | null = null
  if (action === 'mark_paid') {
    reference = typeof body['reference'] === 'string' ? body['reference'].trim() : ''
    if (!REFERENCE_RE.test(reference)) return bad('A payment reference is required')
    if (!isIsoDate(body['paidOn'])) return bad('paidOn must be a date (YYYY-MM-DD)')
    paidOn = body['paidOn']
    patch = { status: 'paid', paid_reference: reference, paid_on: paidOn, paid_by: auth.userId }
    from = ['owed', 'scheduled']
  } else if (action === 'mark_scheduled') {
    patch = { status: 'scheduled' }
    from = ['owed']
  } else {
    return bad('action must be mark_paid or mark_scheduled')
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('pharmacy_payables')
    .update({ ...patch, updated_at: new Date().toISOString() } as never)
    .in('payable_id', payableIds)
    .in('status', from)
    .select('payable_id')
  if (error) {
    console.error('[ops/payables/mark] update failed:', error.message)
    return NextResponse.json({ error: 'The payables could not be updated' }, { status: 500 })
  }
  const updated = ((data ?? []) as Array<{ payable_id: string }>).map(r => r.payable_id)

  if (updated.length > 0) {
    const events = updated.map(payable_id => ({
      payable_id,
      action:        action === 'mark_paid' ? 'marked_paid' : 'marked_scheduled',
      actor_user_id: auth.userId,
      reference,
      paid_on:       paidOn,
    }))
    const { error: eventError } = await supabase.from('payable_events').insert(events as never)
    if (eventError) {
      console.error('[ops/payables/mark] audit log not written for', updated.join(','), eventError.message)
      return NextResponse.json({ error: 'Updated, but the audit log could not be written', updated: updated.length }, { status: 500 })
    }
  }

  console.info(`[ops/payables/mark] ${action}: ${updated.length} of ${payableIds.length} by ${auth.userId}`)
  return NextResponse.json({ updated: updated.length, skipped: payableIds.length - updated.length })
}
