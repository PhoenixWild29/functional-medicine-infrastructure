// /legal/privacy — public (no session); see src/lib/legal/public-documents.ts

import type { Metadata } from 'next'
import { LegalDocumentPage } from '@/components/legal/legal-document-page'
import { PUBLIC_LEGAL_DOCUMENTS } from '@/lib/legal/public-documents'

// Dynamic so the CSP nonce reaches Next's inline scripts (a static page
// has no nonce and its scripts are blocked by the strict CSP).
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: `${PUBLIC_LEGAL_DOCUMENTS.privacy.title} | CompoundIQ` }

export default function PrivacyPage() {
  return <LegalDocumentPage doc={PUBLIC_LEGAL_DOCUMENTS.privacy} />
}
