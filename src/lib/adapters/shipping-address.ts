// ============================================================
// The address an order ships to (pure)
// ============================================================
//
// Signing freezes the patient's address on the order (lib/orders/
// batch-sign): line 1, line 2, city and zip, with shipping_state_snapshot
// as its state and shipping_address_snapshot_at as when. Every adapter
// and the Rx PDF ship to that, never to the patient's address as it is
// at submission time, which may have changed since the order was signed
// and paid.
//
// An order signed before snapshots existed (shipping_address_snapshot_at
// NULL) falls back to the patient's address, as every adapter did before.

export interface OrderShippingAddressColumns {
  shipping_address_line1_snapshot?: string | null
  shipping_address_line2_snapshot?: string | null
  shipping_city_snapshot?:          string | null
  shipping_zip_snapshot?:           string | null
  shipping_state_snapshot?:         string | null
  shipping_address_snapshot_at?:    string | null
}

export interface PatientAddressColumns {
  address_line1?: string | null
  address_line2?: string | null
  city?:          string | null
  state?:         string | null
  zip?:           string | null
}

export interface ShippingAddress {
  line1: string | null
  line2: string | null
  city:  string | null
  state: string | null
  zip:   string | null
}

export function shippingAddressFor(order: OrderShippingAddressColumns, patient: PatientAddressColumns): ShippingAddress {
  if (order.shipping_address_snapshot_at) {
    return {
      line1: order.shipping_address_line1_snapshot ?? null,
      line2: order.shipping_address_line2_snapshot ?? null,
      city:  order.shipping_city_snapshot ?? null,
      state: order.shipping_state_snapshot ?? null,
      zip:   order.shipping_zip_snapshot ?? null,
    }
  }
  return {
    line1: patient.address_line1 ?? null,
    line2: patient.address_line2 ?? null,
    city:  patient.city ?? null,
    state: patient.state ?? null,
    zip:   patient.zip ?? null,
  }
}
