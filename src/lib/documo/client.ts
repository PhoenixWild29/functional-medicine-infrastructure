import { serverEnv } from '@/lib/env'

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
