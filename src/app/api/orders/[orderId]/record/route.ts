// ============================================================
// Order record — shipping + Rx details for the order drawer
// GET /api/orders/[orderId]/record
// ============================================================
//
// The drawer's financial split and Rx details read what the ORDER stores,
// so the record reconciles with what the patient is charged:
//
//   shipping    orders.shipping_fee (WO-102 snapshot — the amount
//               /api/checkout/payment-intent adds through stripeSplit),
//               orders.shipping_type, the pharmacy name, and
//               clinics.absorb_shipping (whether the patient pays it)
//   rxDetails   the WO-96 columns (days supply, dispense, refills,
//               substitution, syringe, shipping type, clinical difference,
//               diagnosis, special instructions)
//   package     orders.package_label / package_count (WO-101 / WO-101a)
//
// Auth: verified user via getUser(); clinic_id from that user. The order
// must belong to the caller's clinic and not be soft-deleted.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { RX_DETAIL_COLUMN_LIST, rxDetailsFromRow, type RxDetails } from '@/lib/orders/rx-details'
import { dollarsToCents } from '@/lib/orders/shipping'

interface RouteParams {
  params: Promise<{ orderId: string }>
}

export interface OrderRecord {
  shipping: {
    feeCents:     number
    shippingType: string | null
    pharmacyName: string | null
    /** clinics.absorb_shipping — the clinic pays it, the patient does not */
    absorbed:     boolean
  }
  rxDetails:    RxDetails
  packageLabel: string | null
  packageCount: number | null
}

export async function GET(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { orderId } = await params

  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const clinicId = typeof user.user_metadata['clinic_id'] === 'string'
    ? user.user_metadata['clinic_id'] as string
    : null
  if (!clinicId) {
    return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  }
  if (!orderId) {
    return NextResponse.json({ error: 'orderId required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const [orderResult, clinicResult] = await Promise.all([
    supabase
      .from('orders')
      .select(`order_id, shipping_fee, pharmacy_snapshot, package_label, package_count, ${RX_DETAIL_COLUMN_LIST}`)
      .eq('order_id', orderId)
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('clinics')
      .select('absorb_shipping')
      .eq('clinic_id', clinicId)
      .maybeSingle(),
  ])

  if (orderResult.error) {
    console.error('[order-record] order lookup failed:', orderResult.error.message)
    return NextResponse.json({ error: 'Failed to load order' }, { status: 500 })
  }
  const order = orderResult.data as unknown as (Record<string, unknown> & {
    shipping_fee: number | string | null
    pharmacy_snapshot: unknown
    package_label: string | null
    package_count: number | null
    shipping_type: string | null
  }) | null
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  const pharmacy = order.pharmacy_snapshot as { name?: unknown } | null
  const record: OrderRecord = {
    shipping: {
      feeCents:     dollarsToCents(order.shipping_fee),
      shippingType: typeof order.shipping_type === 'string' ? order.shipping_type : null,
      pharmacyName: typeof pharmacy?.name === 'string' ? pharmacy.name : null,
      absorbed:     clinicResult.data?.absorb_shipping === true,
    },
    rxDetails:    rxDetailsFromRow(order),
    packageLabel: typeof order.package_label === 'string' ? order.package_label : null,
    packageCount: typeof order.package_count === 'number' ? order.package_count : null,
  }
  return NextResponse.json(record, { status: 200, headers: { 'Cache-Control': 'no-store' } })
}
