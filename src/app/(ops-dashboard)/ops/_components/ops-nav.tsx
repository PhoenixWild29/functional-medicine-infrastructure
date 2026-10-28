'use client'

// ============================================================
// Ops Navigation Bar — WO-72 redesign from WO-33
// ============================================================
//
// WO-72: underline active tab pattern, sticky, z-10.
//   Active:   border-b-2 border-primary text-foreground font-medium
//   Inactive: text-muted-foreground hover:text-foreground transition-colors

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Demo Tools ops tab: gated by NEXT_PUBLIC_SHOW_DEMO_TOOLS. Hidden from the
// nav by default so the investor Ops tour doesn't see a "Demo Tools" tab
// that telegraphs POC (cowork review finding B4). The /ops/demo-tools page
// itself stays reachable by direct URL for credential-reset workflows
// — hiding the link doesn't remove the capability.
//
// To show the tab (e.g., during internal QA or a scripted demo rehearsal),
// set NEXT_PUBLIC_SHOW_DEMO_TOOLS=true in the Vercel env.
const SHOW_DEMO_TOOLS = process.env['NEXT_PUBLIC_SHOW_DEMO_TOOLS'] === 'true'

const NAV_TABS = [
  { href: '/ops/pipeline', label: 'Pipeline'  },
  { href: '/ops/sla',      label: 'SLA'       },
  { href: '/ops/adapters', label: 'Adapters'  },
  { href: '/ops/fax',      label: 'Fax Queue' },
  { href: '/ops/catalog',  label: 'Catalog'   },
  { href: '/ops/licensure', label: 'Licensure' },
  { href: '/ops/ingredients', label: 'Ingredients' },
  { href: '/ops/onboarding', label: 'Clinic onboarding' },
  { href: '/ops/onboarding/pharmacies', label: 'Pharmacy onboarding' },
  { href: '/ops/integrations', label: 'EHR sync' },
  { href: '/ops/payables', label: 'Payables' },
  { href: '/ops/security', label: 'Security' },
  // B16: the weekly review of patient data access.
  { href: '/ops/access-review', label: 'Access review' },
  ...(SHOW_DEMO_TOOLS ? [{ href: '/ops/demo-tools', label: 'Demo Tools' } as const] : []),
] as const

/**
 * The current tab: the longest href the path is (or is under). A plain
 * startsWith marked /ops/onboarding current on /ops/onboarding/pharmacies too.
 */
function currentHref(pathname: string | null): string | null {
  if (!pathname) return null
  const matches = NAV_TABS.map(t => t.href as string).filter(h => pathname === h || pathname.startsWith(`${h}/`) || pathname.startsWith(`${h}?`))
  return matches.sort((a, b) => b.length - a.length)[0] ?? null
}

/** Self sign-ups not yet approved, per onboarding tab (null: unknown, no badge). */
export interface OpsNavBadges { clinics: number | null; pharmacies: number | null }

const BADGE_FOR: Record<string, keyof OpsNavBadges> = {
  '/ops/onboarding': 'clinics',
  '/ops/onboarding/pharmacies': 'pharmacies',
}

export function OpsNav({ badges }: { badges?: OpsNavBadges } = {}) {
  const pathname = usePathname()
  const current = currentHref(pathname)

  return (
    <nav
      className="sticky top-0 z-10 border-b border-border bg-card"
      aria-label="Ops dashboard sections"
    >
      <div className="mx-auto max-w-(--breakpoint-2xl) px-4">
        <div className="flex h-11 items-end gap-0">
          {NAV_TABS.map(tab => {
            const isActive = tab.href === current
            const badgeKey = BADGE_FOR[tab.href]
            const badge = badgeKey && badges ? badges[badgeKey] : null
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={[
                  'inline-flex items-center px-4 pb-2.5 pt-2 text-sm border-b-2 transition-colors duration-(--duration-fast)',
                  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0',
                  isActive
                    ? 'border-primary text-foreground font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                ].join(' ')}
                aria-current={isActive ? 'page' : undefined}
              >
                {tab.label}
                {typeof badge === 'number' && badge > 0 && (
                  <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
                    {' '}{badge}<span className="sr-only"> new</span>
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
