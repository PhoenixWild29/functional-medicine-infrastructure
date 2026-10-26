// ============================================================
// Footer links to the public legal pages
// ============================================================
//
// On every page a patient or invitee reaches without an account:
// checkout, /login and the invite pages. A <footer> outside <main> is the
// page's contentinfo landmark; inside <main> (as on /login) it is a plain
// footer of that content.

import Link from 'next/link'
import { LEGAL_FOOTER_LINKS } from '@/lib/legal/public-documents'

export function LegalFooter({ className = '' }: { className?: string }) {
  return (
    <footer className={`px-4 py-6 text-sm ${className}`}>
      <nav aria-label="Legal">
        <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {LEGAL_FOOTER_LINKS.map(l => (
            <li key={l.href}>
              <Link
                href={l.href}
                prefetch={false}
                className="inline-flex min-h-[44px] items-center text-slate-700 underline underline-offset-2 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring dark:text-slate-300"
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  )
}
