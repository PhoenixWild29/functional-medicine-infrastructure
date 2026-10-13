// ============================================================
// Pharmacy remittance report — GET /api/ops/payables/remittance
// ============================================================
//
// ?pharmacyId=<uuid>&from=YYYY-MM-DD&to=YYYY-MM-DD[&basis=paid|accrued]
//
// A CSV of one pharmacy's payables: by default the lines paid in the
// range (paid_on, inclusive); basis=accrued lists every line created in
// the range (UTC days, inclusive). IDs and amounts only: no patient data.
// A text value that a spreadsheet would run as a formula is neutralised.
//
// Auth: ops_admin only (getUser(), app_metadata).

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireOpsAdmin } from '@/lib/payments/ops-auth'
import { PAYABLE_COLUMNS, UUID_RE, isIsoDate, toLine } from '@/lib/payments/payables'

export const dynamic = 'force-dynamic'

const HEADER = ['payable_id', 'order_number', 'order_id', 'payment_group_id', 'status', 'wholesale', 'shipping', 'reversed', 'net', 'paid_on', 'paid_reference', 'accrued_on']

const bad = (error: string) => NextResponse.json({ error }, { status: 400 })

/** A CSV cell. Text that starts like a formula gets a leading apostrophe. */
function cell(v: string | null): string {
  let s = v ?? ''
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const dollars = (c: number) => (c / 100).toFixed(2)

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10)
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireOpsAdmin()
  if (auth.denied) return auth.denied

  const q = request.nextUrl.searchParams
  const pharmacyId = q.get('pharmacyId') ?? ''
  const from = q.get('from')
  const to = q.get('to')
  const basis = q.get('basis') ?? 'paid'
  if (!UUID_RE.test(pharmacyId)) return bad('pharmacyId is required')
  if (!isIsoDate(from) || !isIsoDate(to)) return bad('from and to must be dates (YYYY-MM-DD)')
  if (from > to) return bad('from must not be after to')
  if (basis !== 'paid' && basis !== 'accrued') return bad('basis must be paid or accrued')

  const supabase = createServiceClient()
  let query = supabase
    .from('pharmacy_payables')
    .select(`${PAYABLE_COLUMNS}, orders(order_number)`)
    .eq('pharmacy_id', pharmacyId)
  query = basis === 'paid'
    ? query.eq('status', 'paid').gte('paid_on', from).lte('paid_on', to)
    : query.gte('created_at', `${from}T00:00:00.000Z`).lt('created_at', `${nextDay(to)}T00:00:00.000Z`)
  const { data, error } = await query.order('created_at', { ascending: true }).limit(10000)
  if (error) {
    console.error('[ops/payables/remittance] read failed:', error.message)
    return NextResponse.json({ error: 'The remittance report could not be built' }, { status: 500 })
  }

  const { data: pharmacy, error: pharmacyError } = await supabase
    .from('pharmacies')
    .select('slug')
    .eq('pharmacy_id', pharmacyId)
    .maybeSingle()
  // The slug only names the file; the pharmacy ID stands in for it.
  if (pharmacyError) console.error('[ops/payables/remittance] pharmacy slug not read:', pharmacyError.message)
  const name = (pharmacy?.slug ?? pharmacyId).replace(/[^A-Za-z0-9_-]/g, '')

  const rows = ((data ?? []) as unknown as Parameters<typeof toLine>[0][]).map(toLine).map(l => [
    cell(l.payableId), cell(l.orderNumber), cell(l.orderId), cell(l.paymentGroupId), cell(l.status),
    dollars(l.wholesaleCents), dollars(l.shippingCents), dollars(l.reversedCents), dollars(l.netCents),
    cell(l.paidOn), cell(l.paidReference), cell(l.createdAt.slice(0, 10)),
  ].join(','))
  const csv = [HEADER.join(','), ...rows].join('\n') + '\n'

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'content-type':        'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="remittance-${name}-${from}_${to}.csv"`,
      'cache-control':       'no-store',
    },
  })
}
