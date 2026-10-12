// ============================================================
// A public legal page: the Markdown, with its own version line
// ============================================================
//
// Server component. Reads the document's Markdown from src/content/legal/
// (at build time: the pages are static) and renders it with LegalMarkdown,
// React text only. The text's own line ("Version 1.0. Effective October
// 12, 2026.") is the version line. No session or database is read: the
// pages are public.

import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { LegalMarkdown } from '@/components/onboarding/legal-markdown'
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
        <article className="space-y-3 text-sm leading-relaxed text-foreground">
          <LegalMarkdown text={text} headingLevel={1} />
        </article>
      </main>
    </div>
  )
}
