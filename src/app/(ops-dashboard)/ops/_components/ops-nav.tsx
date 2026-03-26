'use client'

// ============================================================
// Ops Navigation Bar — WO-33
// ============================================================
// Active tab highlight via usePathname. Shared across all
// ops sub-features (Pipeline, SLA, Adapters, Fax, Catalog).

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_TABS = [
  { href: '/ops/pipeline', label: 'Pipeline'  },
  { href: '/ops/sla',      label: 'SLA'       },
  { href: '/ops/adapters', label: 'Adapters'  },
  { href: '/ops/fax',      label: 'Fax Queue' },
  { href: '/ops/catalog',  label: 'Catalog'   },
] as const

export function OpsNav() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card shadow-sm">
      <div className="mx-auto max-w-screen-2xl px-4">
        <div className="flex h-14 items-center gap-6">
          <span className="text-sm font-bold text-foreground tracking-tight">
            CompoundIQ{' '}
            <span className="font-normal text-muted-foreground">Ops</span>
          </span>

          <nav
            className="flex gap-0.5"
            role="navigation"
            aria-label="Ops dashboard sections"
          >
            {NAV_TABS.map(tab => {
              const isActive = pathname?.startsWith(tab.href) ?? false
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`
                    rounded-md px-3 py-1.5 text-sm transition-colors
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                    ${isActive
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'}
                  `}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {tab.label}
                </Link>
              )
            })}
          </nav>
        </div>
      </div>
    </header>
  )
}
