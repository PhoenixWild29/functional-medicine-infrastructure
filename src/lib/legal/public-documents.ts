// ============================================================
// Public legal documents (patients and visitors, no account)
// ============================================================
//
// The source of truth is the Markdown under src/content/legal/. The pages
// read it when they are built, so replacing the Markdown changes the page
// with no code change. When the text changes materially, bump `version`
// (and rename the file if its name carries the version).

export type PublicLegalKey = 'privacy' | 'patientTerms'

export interface PublicLegalDocument {
  /** The page <title>; the visible heading is the Markdown's own '# ' title. */
  title:   string
  path:    string
  file:    string
  version: string
  draft:   boolean
}

export const PUBLIC_LEGAL_DOCUMENTS: Record<PublicLegalKey, PublicLegalDocument> = {
  privacy: {
    title: 'Privacy Policy', path: '/legal/privacy',
    file: 'src/content/legal/privacy-policy-draft-v0.1.md', version: 'v0.1', draft: true,
  },
  patientTerms: {
    title: 'Patient Terms of Use', path: '/legal/patient-terms',
    file: 'src/content/legal/patient-terms-draft-v0.1.md', version: 'v0.1', draft: true,
  },
}

/** The footer links on public pages (checkout, /login, invite pages). */
export const LEGAL_FOOTER_LINKS = [
  { label: 'Privacy Policy', href: PUBLIC_LEGAL_DOCUMENTS.privacy.path },
  { label: 'Terms of Use',   href: PUBLIC_LEGAL_DOCUMENTS.patientTerms.path },
] as const
