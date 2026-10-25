// POST /api/pharmacy/onboarding/licenses/<state>/document (multipart, field "file"):
// the license document, to the private bucket. PDF, PNG or JPEG, 4 MB (lib/uploads/limits).
// The pharmacy admin first; then <state>, a US license state (../state-param), before the upload is read.
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { attachLicenseDocument, MAX_DOCUMENT_BYTES } from '@/lib/pharmacy-onboarding/application'
import { crossSiteRefusal, json, pharmacyAdmin, respond } from '@/lib/pharmacy-onboarding/request'
import { parseStateParam } from '../state-param'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, context: { params: Promise<{ state: string }> }) {
  const refused = crossSiteRefusal(request)
  if (refused) return refused
  const who = await pharmacyAdmin()
  if (!who.ok) return who.response
  const parsed = await parseStateParam(context)
  if (!parsed.ok) return parsed.response
  const { state } = parsed.data

  let file: File | null = null
  try {
    const form = await request.formData()
    const entry = form.get('file')
    file = entry instanceof File ? entry : null
  } catch {
    file = null
  }
  if (!file) return json({ error: 'Choose a file to upload.' }, 400)
  if (file.size > MAX_DOCUMENT_BYTES) return json({ error: 'The file must be under 4 MB.' }, 400)
  const bytes = new Uint8Array(await file.arrayBuffer())
  return respond(await attachLicenseDocument(createServiceClient(), who.ctx, state, { name: file.name, type: file.type, size: bytes.byteLength, bytes }))
}
