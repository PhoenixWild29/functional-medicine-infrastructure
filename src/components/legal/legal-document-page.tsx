// ============================================================
// A public legal page: draft banner, version line, the Markdown
// ============================================================
//
// Server component. Reads the document's Markdown from src/content/legal/
// (at build time: the pages are static) and renders it with LegalMarkdown,
// React text only. No session or database is read: the pages are public.

import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { LegalMarkdown } from '@/components/onboarding/legal-markdown'
import { FormAlert } from '@/components/onboarding/fields'
import { DRAFT_BANNER } from '@/lib/onboarding/agreement-texts'
import type { PublicLegalDocument } from '@/lib/legal/public-documents'

export function LegalDocumentPage({ doc }: { doc: PublicLegalDocument }) {
  // Scoped to src/content/legal/ so the build traces only that folder.
  const text = readFileSync(join(process.cwd(), 'src', 'content', 'legal', basename(doc.file)), 'utf8')
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center px-4 py-4">
          <span className="text-lg font-bold tracking-tight text-foreground">CompoundIQ</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-10">
        {doc.draft && (
          <FormAlert tone="warning">
            <strong className="font-semibold">{DRAFT_BANNER}.</strong> This document is a draft and will be replaced by the final version.
          </FormAlert>
        )}
        <p className="text-sm text-slate-700 dark:text-slate-300">{`Version ${doc.version}${doc.draft ? ' (draft)' : ''}`}</p>
        <article className="space-y-3 text-sm leading-relaxed text-foreground">
          <LegalMarkdown text={text} headingLevel={1} />
        </article>
      </main>
    </div>
  )
}
