// /legal/patient-terms — public (no session); see src/lib/legal/public-documents.ts

import type { Metadata } from 'next'
import { LegalDocumentPage } from '@/components/legal/legal-document-page'
import { PUBLIC_LEGAL_DOCUMENTS } from '@/lib/legal/public-documents'

export const dynamic = 'force-static'
export const metadata: Metadata = { title: `${PUBLIC_LEGAL_DOCUMENTS.patientTerms.title} | CompoundIQ` }

export default function PatientTermsPage() {
  return <LegalDocumentPage doc={PUBLIC_LEGAL_DOCUMENTS.patientTerms} />
}
