import { serverEnv } from '@/lib/env'
import { assertPharmacySubmissionsEnabled } from '@/lib/adapters/submission-switch'

// Documo mFax REST API v2 client — fetch-based (no official SDK).
// Auth: X-API-Key header + account_id path param
//
// BAA Required: Documo has signed a HIPAA BAA — all fax transmissions are
// encrypted in transit. Do not use any other fax provider without a BAA.
//
// Inbound fax receipts are processed via X-Documo-Signature webhook validation.
// Outbound faxes are Tier 4 submissions — used when API/portal adapters fail.

const DOCUMO_BASE_URL = 'https://api.documo.com/v2'

interface DocumentoSendFaxParams {
  recipientFaxNumber: string
  recipientName: string
  /** Supabase Storage path to the PDF — must be pre-signed URL */
  documentUrl: string
  coverPageText?: string
}

interface DocumentoFaxStatus {
  id: string
  status: 'queued' | 'sending' | 'delivered' | 'failed' | 'cancelled'
  pages: number
  createdAt: string
  completedAt: string | null
}

function documoHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-API-Key': serverEnv.documoApiKey(),
  }
}

export async function sendFax(params: DocumentoSendFaxParams): Promise<{ faxId: string }> {
  // Kill switch: no fax leaves the platform unless pharmacy submissions are on.
  assertPharmacySubmissionsEnabled('Documo sendFax')

  const response = await fetch(
    `${DOCUMO_BASE_URL}/accounts/${serverEnv.documoAccountId()}/faxes`,
    {
      method: 'POST',
      headers: documoHeaders(),
      body: JSON.stringify({
        recipientFaxNumber: params.recipientFaxNumber,
        recipientName: params.recipientName,
        senderFaxNumber: serverEnv.documoOutboundFaxNumber(),
        documentUrl: params.documentUrl,
        coverPageText: params.coverPageText ?? '',
      }),
      signal: AbortSignal.timeout(30000),
    }
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Documo sendFax failed: ${response.status} ${body}`)
  }

  const data = (await response.json()) as { id: string }
  return { faxId: data.id }
}

export async function getFaxStatus(faxId: string): Promise<DocumentoFaxStatus> {
  const response = await fetch(
    `${DOCUMO_BASE_URL}/accounts/${serverEnv.documoAccountId()}/faxes/${faxId}`,
    {
      headers: documoHeaders(),
      signal: AbortSignal.timeout(10000),
    }
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Documo getFaxStatus failed: ${response.status} ${body}`)
  }

  return response.json() as Promise<DocumentoFaxStatus>
}

export type DownloadFaxPdfResult =
  | { ok: true; bytes: ArrayBuffer }
  | { ok: false; reason: 'not_found' | 'failed' }

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46] // %PDF

// The PDF of an inbound fax, by its Documo id. Inbound faxes live only in
// Documo (the webhook stores the id, never the file), so ops viewing one
// fetches it here on demand. Never throws; a failure is logged with the
// HTTP status only (never the key, the account or Documo's response body).
export async function downloadFaxPdf(documoFaxId: string): Promise<DownloadFaxPdfResult> {
  try {
    const response = await fetch(
      `${DOCUMO_BASE_URL}/accounts/${serverEnv.documoAccountId()}/faxes/${encodeURIComponent(documoFaxId)}/download`,
      {
        method: 'GET',
        headers: { 'X-API-Key': serverEnv.documoApiKey(), Accept: 'application/pdf' },
        signal: AbortSignal.timeout(20000),
        cache: 'no-store',
      }
    )
    if (response.status === 404 || response.status === 410) return { ok: false, reason: 'not_found' }
    if (!response.ok) {
      console.error(`[documo] fax download failed | status=${response.status}`)
      return { ok: false, reason: 'failed' }
    }
    const bytes = await response.arrayBuffer()
    const head = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength))
    if (head.length < 4 || PDF_MAGIC.some((b, i) => head[i] !== b)) {
      console.error('[documo] fax download failed | not a PDF')
      return { ok: false, reason: 'failed' }
    }
    return { ok: true, bytes }
  } catch (err) {
    console.error(`[documo] fax download failed | ${err instanceof Error ? err.name : 'error'}`)
    return { ok: false, reason: 'failed' }
  }
}

// Validate X-Documo-Signature on inbound webhook requests.
// Documo uses HMAC-SHA256 of the raw request body with DOCUMO_WEBHOOK_SECRET.
export async function validateDocumoWebhook(
  signature: string,
  rawBody: string
): Promise<boolean> {
  const secret = serverEnv.documoWebhookSecret()
  const encoder = new TextEncoder()

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  )

  // Decode hex signature using pure Web API (no Node.js Buffer — Edge-compatible)
  const signatureBytes = new Uint8Array(
    signature.match(/.{2}/g)!.map(byte => parseInt(byte, 16))
  )
  return crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(rawBody))
}
