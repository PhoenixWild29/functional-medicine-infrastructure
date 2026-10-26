// ============================================================
// POST /api/patients/import/validate (Patient Intake PR 5)
// ============================================================
//
// Every row checked with the chosen mapping, and compared with the
// clinic's active patients for possible duplicates. Nothing is written.
// Clinic admin and medical assistants only; the clinic from claims.

import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { logPhiAccess, logPhiAccessMany } from '@/lib/audit/phi-access'
import { mappingErrors } from '@/lib/patients/import/mapping'
import { importCaller, readRowsBody } from '@/lib/patients/import/request'
import { reviewImport } from '@/lib/patients/import/review'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { readImportJson } from '../read-body'

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const caller = await importCaller(request)
  if ('response' in caller) return caller.response

  // 4 MB at most (lib/uploads/limits): 413 over it; 400 when not JSON.
  const read = await readImportJson(request)
  if ('response' in read) return read.response
  const body = read.body
  const input = readRowsBody(body)
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 })
  const problems = mappingErrors(input.mapping, input.headers.length)
  if (problems.length) return NextResponse.json({ error: problems[0], mappingErrors: problems }, { status: 400 })

  const review = await reviewImport(createServiceClient(), caller.clinicId, input.rows, input.mapping)
  if (!review) return NextResponse.json({ error: 'Existing patients could not be checked for duplicates. Try again.' }, { status: 503 })

  // Compliance C2 (B14): the file's patients are echoed back with their
  // checks. They are not patients yet, so that row names none. An existing
  // patient shown as a possible duplicate (by name) is logged by id. Reads:
  // served even when a row could not be written (the helper alerts).
  const entry = {
    user: caller.user, clinicId: caller.clinicId, action: 'view', resource: 'patient_import_preview',
    route: '/api/patients/import/validate', headers: request.headers,
  } as const
  await logPhiAccess(entry)
  const existingShown = [...new Set(review.rows.flatMap(r => (r.duplicate?.kind === 'existing' ? [r.duplicate.patientId] : [])))]
  await logPhiAccessMany(entry, existingShown)
  return NextResponse.json(review, { headers: { 'Cache-Control': 'no-store' } })
}

export const POST = withApiErrors('/api/patients/import/validate', postHandler)
