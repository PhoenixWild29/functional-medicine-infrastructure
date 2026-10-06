// ============================================================
// Dashboard: licenses about to expire (Compliance C4)
// ============================================================
//
// Shown when a license expires within 30 days. After it expires, that
// provider cannot sign for patients in that state.

import Link from 'next/link'
import type { ExpiringLicense } from '@/lib/providers/expiring'

export function LicenseExpiryWarning({ licenses }: { licenses: ExpiringLicense[] }) {
  if (licenses.length === 0) return null
  return (
    <section role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/20" data-testid="license-expiry-warning">
      <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
        {licenses.length === 1 ? 'A license expires soon' : `${licenses.length} licenses expire soon`}
      </p>
      <ul className="mt-1 space-y-0.5 text-xs text-amber-800 dark:text-amber-300">
        {licenses.map(l => (
          <li key={`${l.providerName}-${l.state}`}>
            {l.providerName}: {l.state} license expires {l.expiresOn}
            {l.daysLeft === 0 ? ' (today)' : ` (in ${l.daysLeft} day${l.daysLeft === 1 ? '' : 's'})`}. After that, prescriptions for {l.state} patients cannot be signed.
          </li>
        ))}
      </ul>
      <Link href="/settings/team" className="mt-2 inline-block text-xs font-medium text-amber-900 underline dark:text-amber-200">Update licenses in Settings, Team</Link>
    </section>
  )
}
