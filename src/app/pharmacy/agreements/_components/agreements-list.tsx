// ============================================================
// /pharmacy/agreements: what this pharmacy has accepted (read-only)
// ============================================================
//
// One row per acceptance (title, version, signer, date) with a link to the
// exact text that was accepted. When an agreement's current version is
// newer than the one accepted, a notice offers to review and accept it.
// Nothing else is blocked by an older version (yet).

import Link from 'next/link'
import type { AgreementSummary } from '@/lib/pharmacy-onboarding/agreements-history'

const LINK = 'inline-flex min-h-[44px] items-center font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

export function AgreementsList({ agreements }: { agreements: AgreementSummary[] }) {
  // Grouped by agreement (BAA, then terms), newest first within each.
  const rows = agreements.flatMap(a => [...a.acceptances]
    .sort((x, y) => y.acceptedAt.localeCompare(x.acceptedAt))
    .map(x => ({ ...x, title: a.title })))
  const outdated = agreements.filter(a => a.newVersionAvailable)
  const notYet = agreements.filter(a => a.acceptances.length === 0)

  return (
    <div className="space-y-6">
      {outdated.length > 0 && (
        <div role="status" className="space-y-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-semibold">A new version is available</p>
          <ul className="space-y-1">
            {outdated.map(a => (
              <li key={a.key} className="break-words">
                {a.title}: version {a.currentVersion} replaces the version you accepted.{' '}
                <Link href={`/pharmacy/agreements/review/${a.key}`} className={LINK} aria-label={`Review and accept ${a.title} ${a.currentVersion}`}>Review and accept</Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {notYet.length > 0 && (
        <ul className="space-y-1 text-sm text-foreground">
          {notYet.map(a => (
            <li key={a.key} className="break-words">
              {a.title} {a.currentVersion}: not accepted yet.{' '}
              <Link href={`/pharmacy/agreements/review/${a.key}`} className={LINK} aria-label={`Review and accept ${a.title} ${a.currentVersion}`}>Review and accept</Link>
            </li>
          ))}
        </ul>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-foreground">You have not accepted an agreement yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Accepted agreements</caption>
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2">Agreement</th>
                <th scope="col" className="px-3 py-2">Version</th>
                <th scope="col" className="px-3 py-2">Accepted by</th>
                <th scope="col" className="px-3 py-2">Date</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Text</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.acceptanceId} className="border-t border-border align-top">
                  <td className="px-3 py-2 text-foreground">{r.title}</td>
                  <td className="px-3 py-2 text-foreground">{r.version}{r.current ? '' : ' (older)'}</td>
                  <td className="break-words px-3 py-2 text-foreground">{r.signerName}, {r.signerTitle}</td>
                  <td className="px-3 py-2 text-foreground"><time dateTime={r.acceptedAt}>{date(r.acceptedAt)}</time></td>
                  <td className="px-3 py-2">
                    <Link href={`/pharmacy/agreements/${r.acceptanceId}`} className={LINK} aria-label={`View text of ${r.title} ${r.version}`}>View text</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
