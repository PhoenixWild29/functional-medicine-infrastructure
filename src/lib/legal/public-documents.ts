// ============================================================
// Public legal documents (patients and visitors, no account)
// ============================================================
//
// The source of truth is the Markdown under src/content/legal/. The pages
// read it when they are built, so replacing the Markdown changes the page
// with no code change. The text carries its own version line
// ("_Version 1.0. Effective October 12, 2026._"); `version` and
// `effective` here must match it (a test checks). For a new version, add a
// new file, point `file` at it and move the old one to archive/.

export type PublicLegalKey = 'privacy' | 'patientTerms'

export interface PublicLegalDocument {
  /** The page <title>; the visible heading is the Markdown's own '# ' title. */
  title:     string
  path:      string
  file:      string
  version:   string
  effective: string
}

export const PUBLIC_LEGAL_DOCUMENTS: Record<PublicLegalKey, PublicLegalDocument> = {
  privacy: {
    title: 'Privacy Policy', path: '/legal/privacy',
    file: 'src/content/legal/privacy-policy-v1.1.md', version: '1.1', effective: 'October 30, 2026',
  },
  patientTerms: {
    title: 'Patient Terms of Use', path: '/legal/patient-terms',
    file: 'src/content/legal/patient-terms-v1.0.md', version: '1.0', effective: 'October 12, 2026',
  },
}

/** The footer links on public pages (checkout, /login, invite pages). */
export const LEGAL_FOOTER_LINKS = [
  { label: 'Privacy Policy', href: PUBLIC_LEGAL_DOCUMENTS.privacy.path },
  { label: 'Terms of Use',   href: PUBLIC_LEGAL_DOCUMENTS.patientTerms.path },
] as const
