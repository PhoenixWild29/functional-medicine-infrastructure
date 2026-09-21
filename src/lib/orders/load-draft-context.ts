// ============================================================
// Draft context loader — WO-98 (server only)
// ============================================================
//
// The search and margin pages accept ?editOrder=<id> / ?addToOrder=<id>.
// Both need the same thing: the DRAFT order (clinic-scoped, active), its
// patient + provider shaped for the session pin, and the builder inputs
// recovered from the row. Returns null when the order is not an
// editable draft of this clinic — the page then falls back to the
// normal flow rather than erroring.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { RX_DETAIL_COLUMN_LIST, rxDetailsFromRow, type RxDetails } from './rx-details'
import { builderStateFromOrder, type BuilderInitialState } from './draft-edit'

export interface DraftSessionPatient {
  patient_id:    string
  first_name:    string
  last_name:     string
  date_of_birth: string
  phone:         string
  state:         string | null
  sms_opt_in:    boolean
  // Batch 1, finding 1: the session carries the allergy state, so the
  // banner has nothing to hydrate and a failed read cannot render as
  // "Allergies: not recorded".
  allergies:            string[]
  nkda:                 boolean
  allergies_updated_at: string | null
}

export interface DraftSessionProvider {
  provider_id:    string
  first_name:     string
  last_name:      string
  npi_number:     string
  signature_hash: string | null
}

export interface DraftContext {
  orderId:        string
  patient:        DraftSessionPatient
  provider:       DraftSessionProvider
  medicationName: string
  retailCents:    number
  rxDetails:      RxDetails
  initial:        BuilderInitialState
  /** WO-101: the package (vial size) the draft line was priced from. */
  packageId:      string | null
  /** WO-101a: how many of that package. */
  packageCount:   number
}

export async function loadDraftContext(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  orderId: string,
): Promise<DraftContext | null> {
  const { data: order, error } = await supabase
    .from('orders')
    .select(`order_id, status, patient_id, provider_id, formulation_id, pharmacy_id, sig_text,
      retail_price_snapshot, medication_snapshot, package_id, package_count, sig_mode, titration_steps, ${RX_DETAIL_COLUMN_LIST}`)
    .eq('order_id', orderId)
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    console.error('[draft-context] order fetch failed:', error.message)
    return null
  }
  if (!order || order.status !== 'DRAFT') return null

  const [patientResult, providerResult] = await Promise.all([
    supabase
      .from('patients')
      .select('patient_id, first_name, last_name, date_of_birth, phone, state, sms_opt_in, allergies, nkda, allergies_updated_at')
      .eq('patient_id', order.patient_id)
      .maybeSingle(),
    supabase
      .from('providers')
      .select('provider_id, first_name, last_name, npi_number, signature_hash')
      .eq('provider_id', order.provider_id)
      .maybeSingle(),
  ])
  const patient = patientResult.data
  const provider = providerResult.data
  if (!patient || !provider) return null

  const snapshot = (order.medication_snapshot ?? {}) as Record<string, unknown>

  return {
    orderId: order.order_id,
    patient: {
      patient_id:    patient.patient_id,
      first_name:    patient.first_name,
      last_name:     patient.last_name,
      date_of_birth: patient.date_of_birth,
      phone:         patient.phone ?? '',
      state:         patient.state ?? null,
      sms_opt_in:    patient.sms_opt_in,
      // Batch 1, finding 1: see refill/page.tsx — a draft session
      // carries its allergies rather than depending on a fetch that
      // could fail into "not recorded".
      allergies:            patient.allergies ?? [],
      nkda:                 patient.nkda === true,
      allergies_updated_at: patient.allergies_updated_at ?? null,
    },
    provider: {
      provider_id:    provider.provider_id,
      first_name:     provider.first_name,
      last_name:      provider.last_name,
      npi_number:     provider.npi_number,
      signature_hash: provider.signature_hash ?? null,
    },
    medicationName: typeof snapshot['medication_name'] === 'string' ? snapshot['medication_name'] : 'Prescription',
    retailCents:    Math.round((order.retail_price_snapshot ?? 0) * 100),
    rxDetails:      rxDetailsFromRow(order),
    initial:        builderStateFromOrder(order),
    packageId:      typeof order.package_id === 'string' ? order.package_id : null,
    packageCount:   typeof order.package_count === 'number' && order.package_count > 0 ? order.package_count : 1,
  }
}
