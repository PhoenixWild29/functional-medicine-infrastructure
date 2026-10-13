// ============================================================
// POST /api/patients/import/validate (Patient Intake PR 5)
// ============================================================
//
// Every row checked with the chosen mapping, and compared with the
// clinic's active patients for possible duplicates. Nothing is written.
// Clinic admin and medical assistants only; the clinic from claims.

import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { mappingErrors } from '@/lib/patients/import/mapping'
import { importCaller, readRowsBody } from '@/lib/patients/import/request'
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

  const review = await reviewImport(createServiceClient(), caller.clinicId, input.rows, input.mapping)
  if (!review) return NextResponse.json({ error: 'Existing patients could not be checked for duplicates. Try again.' }, { status: 503 })
  return NextResponse.json(review, { headers: { 'Cache-Control': 'no-store' } })
}
