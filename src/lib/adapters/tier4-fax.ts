// ============================================================
// Tier 4 Fax Fallback Adapter — WO-22
// ============================================================
//
// Implements REQ-FAX-001 through REQ-FAX-003 and REQ-FAX-005.
// REQ-FAX-004 retry scheduling is handled by the fax-retry cron
// (/api/cron/fax-retry) which calls submitTier4Fax() on retry.
//
// Submission lifecycle (per attempt):
//   createSubmissionRecord(PENDING)
//   → buildPrescriptionPdfBytes()
//   → upload to Supabase Storage (prescription-pdfs bucket)
//   → create signed URL (1-hour TTL for Documo download)
//   → markSubmitted()
//   → sendFax() → Documo mFax API
//   → update orders.documo_fax_id + fax_attempt_count
//   → if attempt 1: CAS PAID_PROCESSING→FAX_QUEUED + FAX_DELIVERY SLA
//   → markAcknowledged(documoFaxId)   ← Documo accepted the job
//
// On any error: markFailed() and re-throw for caller to handle.
//
// Hard Constraint HC-04: Only Documo mFax is used — enforced by
// this adapter being the single code path for fax submission.
//
// HIPAA: prescription PDF contains PHI (patient name, DOB, Rx
// details). Documo is BAA-covered. Storage bucket is non-public;
// PDFs are accessed only via time-limited signed URLs.

import { createServiceClient } from '@/lib/supabase/service'
import { sendFax } from '@/lib/documo/client'
import {
  buildPrescriptionPdfBytes,
  type PrescriptionPdfData,
} from '@/lib/adapters/prescription-pdf'
import {
  createSubmissionRecord,
  markSubmitted,
  markAcknowledged,
  markFailed,
} from '@/lib/adapters/audit-trail'
import { casTransition } from '@/lib/orders/cas-transition'

// ============================================================
// TYPES
// ============================================================

export interface Tier4FaxResult {
  submissionId: string
  documoFaxId: string
  attemptNumber: number
}

// ============================================================
// MAIN SUBMISSION FUNCTION
// ============================================================
//
// Called by:
//   - Stripe webhook branchByTier() for initial FAX_QUEUED orders
//   - /api/cron/fax-retry for retry attempts 2 and 3
//
// On first call (attempt 1): transitions order PAID_PROCESSING → FAX_QUEUED
//   and creates FAX_DELIVERY SLA (30 min wall clock).
// On retries (attempt 2–3): updates documo_fax_id only; order
//   stays FAX_QUEUED (already transitioned on attempt 1).

export async function submitTier4Fax(orderId: string): Promise<Tier4FaxResult> {
  const supabase = createServiceClient()

  // ── 1. Load order ──────────────────────────────────────────
  const { data: order, error: orderError } = await (supabase
    .from('orders')
    .select('order_id, status, pharmacy_id, clinic_id, provider_id, patient_id, medication_snapshot, provider_npi_snapshot, quantity, sig_text, order_number, fax_attempt_count, locked_at, created_at')
    .eq('order_id', orderId)
    .single() as unknown as Promise<{
      data: {
        order_id: string
        status: string
        pharmacy_id: string | null
        clinic_id: string
        provider_id: string | null
        patient_id: string
        medication_snapshot: Record<string, unknown> | null
        provider_npi_snapshot: string | null
        quantity: number | null
        sig_text: string | null
        order_number: string
        fax_attempt_count: number | null
        locked_at: string | null
        created_at: string
      } | null
      error: Error | null
    }>)

  if (orderError || !order) {
    throw new Error(
      `[tier4-fax] order ${orderId} not found: ${orderError?.message ?? 'no data'}`
    )
  }

  const attemptNumber = (order.fax_attempt_count ?? 0) + 1

  // ── 2. Load pharmacy (fax_number required) ─────────────────
  const { data: pharmacy } = await supabase
    .from('pharmacies')
    .select('name, fax_number, slug')
    .eq('pharmacy_id', order.pharmacy_id!)
    .single()

  if (!pharmacy?.fax_number) {
    throw new Error(
      `[tier4-fax] pharmacy ${order.pharmacy_id} has no fax_number — cannot send fax`
    )
  }

  // ── 3. Load clinic ─────────────────────────────────────────
  const { data: clinic } = await supabase
    .from('clinics')
    .select('name')
    .eq('clinic_id', order.clinic_id)
    .single()

  // ── 4. Load provider ───────────────────────────────────────
  const { data: provider } = await supabase
    .from('providers')
    .select('first_name, last_name, npi_number, dea_number, license_state')
    .eq('provider_id', order.provider_id!)
    .single()

  if (!provider) {
    throw new Error(`[tier4-fax] provider ${order.provider_id} not found`)
  }

  // ── 5. Load patient ────────────────────────────────────────
  const { data: patient } = await (supabase
    .from('patients')
    .select('first_name, last_name, date_of_birth, address_line1, address_line2, city, state, zip')
    .eq('patient_id', order.patient_id)
    .single() as unknown as Promise<{
      data: {
        first_name: string
        last_name: string
        date_of_birth: string | null
        address_line1: string | null
        address_line2: string | null
        city: string | null
        state: string | null
        zip: string | null
      } | null
      error: Error | null
    }>)

  if (!patient) {
    throw new Error(`[tier4-fax] patient ${order.patient_id} not found`)
  }

  // ── 6. Create audit trail submission record ────────────────
  const submissionId = await createSubmissionRecord({
    orderId,
    pharmacyId: order.pharmacy_id!,
    tier: 'TIER_4_FAX',
    attemptNumber,
    metadata: { is_retry: attemptNumber > 1, pharmacy_slug: pharmacy.slug },
  })

  try {
    // ── 7. Build prescription PDF ────────────────────────────
    const med = order.medication_snapshot as Record<string, unknown> | null

    const pdfData: PrescriptionPdfData = {
      providerFirstName:  provider.first_name,
      providerLastName:   provider.last_name,
      providerNpi:        order.provider_npi_snapshot ?? provider.npi_number,
      providerDea:        provider.dea_number ?? null,
      providerLicenseState: provider.license_state,
      patientFirstName:   patient.first_name,
      patientLastName:    patient.last_name,
      patientDateOfBirth: patient.date_of_birth ?? '',
      patientAddressLine1: patient.address_line1 ?? null,
      patientAddressLine2: patient.address_line2 ?? null,
      patientCity:        patient.city ?? null,
      patientState:       patient.state ?? null,
      patientZip:         patient.zip ?? null,
      medicationName:     String(med?.medication_name ?? 'Compounded Medication'),
      medicationForm:     String(med?.form ?? ''),
      medicationDose:     String(med?.dose ?? ''),
      quantity:           order.quantity ?? 0,
      sigText:            order.sig_text ?? null,
      orderNumber:        order.order_number ?? null,
      // Use locked_at (provider signature date) for medical record authenticity;
      // fall back to created_at if not yet locked (should not occur at FAX_QUEUED stage)
      orderDate:          order.locked_at ?? order.created_at,
      clinicName:         clinic?.name ?? 'CompoundIQ Clinic',
      pharmacyName:       pharmacy.name,
    }

    const pdfBytes = buildPrescriptionPdfBytes(pdfData)

    // ── 8. Upload PDF to Supabase Storage ────────────────────
    // Path reuses attempt number so retries overwrite per-attempt slot.
    const storagePath = `fax/${orderId}/attempt-${attemptNumber}.pdf`

    const { error: uploadError } = await supabase.storage
      .from('prescription-pdfs')
      .upload(storagePath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true,
      })

    if (uploadError) {
      throw new Error(`[tier4-fax] PDF upload failed: ${uploadError.message}`)
    }

    // ── 9. Create signed URL (1-hour TTL) ────────────────────
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('prescription-pdfs')
      .createSignedUrl(storagePath, 3600)

    if (signedUrlError || !signedUrlData?.signedUrl) {
      throw new Error(
        `[tier4-fax] signed URL creation failed: ${signedUrlError?.message ?? 'no URL returned'}`
      )
    }

    // ── 10. Mark submission SUBMITTED ────────────────────────
    await markSubmitted(submissionId, {
      storage_path:         storagePath,
      attempt_number:       attemptNumber,
      pharmacy_fax_number:  pharmacy.fax_number,
    })

    // ── 11. Submit to Documo mFax (HC-04) ────────────────────
    //
    // WO-53: DOCUMO_ENABLED=false disables live fax dispatch for POC environments.
    // A synthetic faxId is used so the rest of the flow (FAX_QUEUED, SLA, audit trail)
    // still runs end-to-end. The PDF is still built and uploaded so the storage path
    // is verifiable during validation.
    let faxId: string
    if (process.env['DOCUMO_ENABLED'] === 'false') {
      faxId = `poc-disabled-fax-${orderId.slice(0, 8)}-attempt${attemptNumber}`
      console.info(
        `[tier4-fax] DOCUMO_ENABLED=false — fax suppressed | order=${orderId} | ` +
        `to=${pharmacy.fax_number} | pdf=${storagePath} | synthetic_fax_id=${faxId}`
      )
    } else {
      const result = await sendFax({
        recipientFaxNumber: pharmacy.fax_number,
        recipientName:      pharmacy.name,
        documentUrl:        signedUrlData.signedUrl,
        coverPageText: [
          'CompoundIQ Compounded Medication Prescription',
          order.order_number ? `Order #: ${order.order_number}` : '',
          'HIPAA Protected — Confidential',
        ]
          .filter(Boolean)
          .join(' | '),
      })
      faxId = result.faxId
    }

    // ── 12. Update order: new documo_fax_id + attempt count ──
    const { error: orderUpdateError } = await supabase
      .from('orders')
      .update({
        documo_fax_id:      faxId,
        fax_attempt_count:  attemptNumber,
        updated_at:         new Date().toISOString(),
      })
      .eq('order_id', orderId)

    if (orderUpdateError) {
      console.error(
        `[tier4-fax] failed to update order ${orderId} with faxId ${faxId}:`,
        orderUpdateError.message
      )
    }

    // ── 13. First attempt: CAS + FAX_DELIVERY SLA ────────────
    if (attemptNumber === 1) {
      const casResult = await casTransition({
        orderId,
        expectedStatus: 'PAID_PROCESSING',
        newStatus:      'FAX_QUEUED',
        actor:          'tier4_fax_adapter',
        metadata:       { documo_fax_id: faxId },
      })

      if (!casResult.wasAlreadyTransitioned) {
        // REQ-FAX-003: FAX_DELIVERY SLA — 30 minutes wall clock
        const slaDeadline = new Date(Date.now() + 30 * 60 * 1000).toISOString()

        const { error: slaError } = await supabase
          .from('order_sla_deadlines')
          .upsert(
            {
              order_id:         orderId,
              sla_type:         'FAX_DELIVERY',
              deadline_at:      slaDeadline,
              escalated:        false,
              escalation_tier:  0,
            },
            { onConflict: 'order_id,sla_type', ignoreDuplicates: true }
          )

        if (slaError) {
          console.error(
            `[tier4-fax] failed to create FAX_DELIVERY SLA for ${orderId}:`,
            slaError.message
          )
        }
      }
    }

    // ── 14. Mark submission acknowledged (Documo accepted job) ─
    await markAcknowledged(submissionId, faxId, {
      documo_fax_id:  faxId,
      attempt_number: attemptNumber,
    })

    console.info(
      `[tier4-fax] fax submitted | order=${orderId} | faxId=${faxId} | attempt=${attemptNumber}/${3}`
    )

    return { submissionId, documoFaxId: faxId, attemptNumber }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await markFailed(submissionId, 'fax_submission_error', msg).catch(auditErr =>
      console.error(
        `[tier4-fax] markFailed itself failed for submission ${submissionId}:`,
        auditErr
      )
    )
    throw err
  }
}
