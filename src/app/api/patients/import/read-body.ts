// ============================================================
// The JSON body of POST /api/patients/import and .../import/validate
// ============================================================
//
// The reviewed CSV rows come back as JSON. They are held to the same 4 MB
// as the file (lib/uploads/limits; the wizard checks it before sending):
// a larger body is a 413 and is not parsed. A body that is not JSON keeps
// its 400 "Invalid request". The reply never quotes the rows (PHI).

import { NextResponse } from 'next/server'
import { MAX_REQUEST_BYTES, MAX_REQUEST_LABEL } from '@/lib/uploads/limits'

export const ROWS_TOO_LARGE = `These rows are more than ${MAX_REQUEST_LABEL} to send at once. Split the file into smaller files and import each one.`

export async function readImportJson(request: Request): Promise<{ body: unknown } | { response: NextResponse }> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_REQUEST_BYTES) return { response: NextResponse.json({ error: ROWS_TOO_LARGE }, { status: 413 }) }
  let text: string
  try {
    text = await request.text()
  } catch {
    return { response: NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  }
  if (new TextEncoder().encode(text).length > MAX_REQUEST_BYTES) {
    return { response: NextResponse.json({ error: ROWS_TOO_LARGE }, { status: 413 }) }
  }
  try {
    return { body: JSON.parse(text) as unknown }
  } catch {
    return { response: NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  }
}
