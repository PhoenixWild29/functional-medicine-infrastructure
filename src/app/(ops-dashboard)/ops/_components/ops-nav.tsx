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
    <nav
      className="sticky top-0 z-10 border-b border-border bg-card"
      aria-label="Ops dashboard sections"
    >
      <div className="mx-auto max-w-screen-2xl px-4">
        <div className="flex h-11 items-end gap-0">
          {NAV_TABS.map(tab => {
            const isActive = pathname?.startsWith(tab.href) ?? false
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={[
                  'inline-flex items-center px-4 pb-2.5 pt-2 text-sm border-b-2 transition-colors duration-[var(--duration-fast)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0',
                  isActive
                    ? 'border-primary text-foreground font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                ].join(' ')}
                aria-current={isActive ? 'page' : undefined}
              >
                {tab.label}
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
