// ============================================================
// POST /api/patients/import/parse (Patient Intake PR 5)
// ============================================================
//
// The uploaded .csv is parsed here, on the server, and never stored: the
// response carries its header row, its patient rows and a suggested column
// mapping, and the file is gone when the request ends. 4 MB and 5,000 rows
// at most. Clinic admin and medical assistants only.

import { NextResponse, type NextRequest } from 'next/server'
import { CsvParseError, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseCsv } from '@/lib/patients/import/csv'
import { suggestMapping } from '@/lib/patients/import/mapping'
import { importCaller } from '@/lib/patients/import/request'
import { withApiErrors } from '@/lib/api/with-api-errors'

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const caller = await importCaller(request)
  if ('response' in caller) return caller.response

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return bad('Choose a .csv file to upload.')
  }
  const file = form.get('file')
  if (!file || typeof file === 'string') return bad('Choose a .csv file to upload.')
  if (!/\.csv$/i.test(file.name)) return bad('The file must be a .csv (export it from your EHR or spreadsheet as CSV).')
  if (file.size > MAX_IMPORT_BYTES) return bad('The file is larger than 4 MB. Split it into smaller files.', 413)

  let parsed: string[][]
  try {
    parsed = parseCsv(await file.text())
  } catch (err) {
    return bad(`The file could not be read as CSV: ${err instanceof CsvParseError ? err.message : 'unexpected format'}`)
  }
  const [headerRow, ...rows] = parsed
  if (!headerRow || rows.length === 0) return bad('The file has no patient rows under its header row.')
  if (rows.length > MAX_IMPORT_ROWS) {
    return bad(`The file has ${rows.length.toLocaleString('en-US')} patient rows; at most ${MAX_IMPORT_ROWS.toLocaleString('en-US')} can be imported at once. Split it into smaller files.`)
  }
  const headers = headerRow.map(h => h.trim())
  console.info(`[patient-import] parsed | rows=${rows.length} | columns=${headers.length}`)
  return NextResponse.json(
    { fileName: file.name.slice(0, 255), headers, rows, suggestedMapping: suggestMapping(headers) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export const POST = withApiErrors('/api/patients/import/parse', postHandler)
