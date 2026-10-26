'use client'

// The pharmacy portal's two sections. Wraps at narrow widths (320px).

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/pharmacy/onboarding', label: 'Onboarding' },
  { href: '/pharmacy/agreements', label: 'Agreements' },
] as const

export function PharmacyNav() {
  const pathname = usePathname() ?? ''
  return (
    <nav aria-label="Pharmacy portal">
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {LINKS.map(l => {
          const current = pathname === l.href || pathname.startsWith(`${l.href}/`)
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={current ? 'page' : undefined}
                className={`inline-flex min-h-[44px] items-center text-sm underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${current ? 'font-semibold text-foreground underline' : 'text-foreground'}`}
              >
                {l.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
