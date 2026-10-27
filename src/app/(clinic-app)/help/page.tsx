// ============================================================
// Help for clinic staff: /help
// ============================================================
//
// Short task pages (src/lib/help/topics.ts) so a clinic can answer its
// own "how do I" questions. Every clinic role; reached from "Help" in
// the sidebar. Static content, no data read.

import Link from 'next/link'
import { HELP_TOPICS } from '@/lib/help/topics'

export const metadata = {
  title: 'Help',
}

export default function HelpPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Help</h1>
        <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
          Short guides to the everyday tasks in CompoundIQ. Button names are written in quotes, exactly as you see them.
        </p>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card" aria-label="Help topics">
        {HELP_TOPICS.map(t => (
          <li key={t.slug}>
            <Link
              href={`/help/${t.slug}`}
              className="block px-4 py-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="block text-sm font-semibold text-foreground">{t.title}</span>
              <span className="block text-xs text-slate-700 dark:text-slate-300">{t.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
