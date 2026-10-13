// ============================================================
// POST /api/patients/import (Patient Intake PR 5)
// ============================================================
//
// Creates the reviewed patients, all or nothing, in ONE transaction: the
// import_patient_batch database function (migration 20261016000002)
// writes the batch record (who, when, file name, row counts) and every
// patient (complete, source csv_import, texts not consented) together.
//
// Never trusts the browser: the rows are re-checked here. A row that needs
// fixing and is not excluded: 422. A possible duplicate that staff did not
// confirm: 409. The clinic comes from the caller's claims only. One PHI
// access log row per created patient. Logs carry counts, never patient
// details.

import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { logPhiAccessMany } from '@/lib/audit/phi-access'
import { mappingErrors } from '@/lib/patients/import/mapping'
import { importCaller, readIndexes, readRowsBody } from '@/lib/patients/import/request'
import { reviewImport } from '@/lib/patients/import/review'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const caller = await importCaller(request)
  if ('response' in caller) return caller.response

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  const input = readRowsBody(body)
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 })
  const problems = mappingErrors(input.mapping, input.headers.length)
  if (problems.length) return NextResponse.json({ error: problems[0], mappingErrors: problems }, { status: 400 })
  const b = body as Record<string, unknown>
  const fileName = typeof b['fileName'] === 'string' && b['fileName'].trim() ? b['fileName'].trim().slice(0, 255) : 'patients.csv'
  const excluded = readIndexes(b['excluded'], input.rows.length)
  const confirmed = readIndexes(b['confirmDuplicates'], input.rows.length)

  const supabase = createServiceClient()
  const review = await reviewImport(supabase, caller.clinicId, input.rows, input.mapping)
  if (!review) return NextResponse.json({ error: 'Existing patients could not be checked for duplicates. Nothing was saved; try again.' }, { status: 503 })

  const included = review.rows.filter(r => !excluded.has(r.index))
  if (included.some(r => r.status === 'error')) {
    return NextResponse.json({ error: 'Some rows need fixing. Fix or exclude them, then import again.', ...review }, { status: 422 })
  }
  const unconfirmed = included.filter(r => r.status === 'duplicate' && !confirmed.has(r.index))
  if (unconfirmed.length) {
    return NextResponse.json({
      code: 'UNCONFIRMED_DUPLICATES',
      error: 'Some rows may be patients you already have. Exclude them, or include them deliberately.',
      rows: unconfirmed.map(r => r.index),
    }, { status: 409 })
  }
  if (included.length === 0) return NextResponse.json({ error: 'There are no rows left to import.' }, { status: 400 })

  const patients = included.map(r => {
    const p = r.patient!
    return {
      first_name: p.firstName, last_name: p.lastName, date_of_birth: p.dateOfBirth,
      phone: p.phone, phone_e164: p.phone, email: p.email,
      address_line1: p.addressLine1, address_line2: p.addressLine2, city: p.city, state: p.state, zip: p.zip,
      sex: p.sex, nkda: p.nkda, allergies: p.allergies,
    }
  })

  const { data, error } = await supabase.rpc('import_patient_batch', {
    p_clinic_id: caller.clinicId,
    p_imported_by: caller.user.id,
    p_file_name: fileName,
    p_total_rows: input.rows.length,
    p_excluded_rows: excluded.size,
    p_duplicates_confirmed: included.filter(r => r.status === 'duplicate').length,
    p_patients: patients,
  })
  const result = data as { batch_id?: string; patient_ids?: string[] } | null
  if (error || !result?.batch_id || !Array.isArray(result.patient_ids)) {
    // The code only: a Postgres message can quote the failing row.
    console.error(`[patient-import] import failed | code=${(error as { code?: string } | null)?.code ?? 'no result'} | rows=${patients.length}`)
    return NextResponse.json({ error: 'The patients could not be imported. Nothing was saved; try again.' }, { status: 500 })
  }

  console.info(`[patient-import] imported | batch=${result.batch_id} | rows=${result.patient_ids.length} | excluded=${excluded.size}`)
  await logPhiAccessMany(
    { user: caller.user, action: 'create', resource: 'patient', route: '/api/patients/import', clinicId: caller.clinicId, headers: request.headers },
    result.patient_ids,
  )
  return NextResponse.json({ batchId: result.batch_id, imported: result.patient_ids.length }, { status: 201 })
}
