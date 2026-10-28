'use client'

// ============================================================
// Settings side nav: marks the section in view
// ============================================================
//
// Click-through, 14 Oct: clicking Notifications highlighted the wrong
// section. The nav had no active state, only hover and focus. Now the
// section in view is aria-current="location" and styled: the one clicked,
// then whatever the scroll position reaches (the last section whose top
// has passed the offset; at the bottom of the page, the last section,
// which can never reach the top). Links that are not '#section' anchors
// (the Agreements page) are never marked.

import { useCallback, useEffect, useState } from 'react'

export interface SettingsNavItem {
  href:  string
  label: string
}

// Below the sticky header: a section counts as reached here.
const OFFSET_PX = 96

export function SettingsSectionNav({ items }: { items: ReadonlyArray<SettingsNavItem> }) {
  const sectionIds = items.filter(i => i.href.startsWith('#')).map(i => i.href.slice(1))
  const idsKey = sectionIds.join(',')
  const [active, setActive] = useState<string | null>(sectionIds[0] ?? null)

  const fromScroll = useCallback(() => {
    const ids = idsKey ? idsKey.split(',') : []
    const els = ids.map(id => document.getElementById(id)).filter((el): el is HTMLElement => el !== null)
    if (els.length === 0) return
    const doc = document.documentElement
    // At the bottom of a page that scrolls, the last section is current:
    // it can never reach the top. (A page that does not scroll uses tops.)
    const scrolls = doc.scrollHeight > window.innerHeight
    if (scrolls && window.innerHeight + window.scrollY >= doc.scrollHeight - 2) {
      setActive(els[els.length - 1]!.id)
      return
    }
    let current = els[0]!.id
    for (const el of els) if (el.getBoundingClientRect().top <= OFFSET_PX) current = el.id
    setActive(current)
  }, [idsKey])

  useEffect(() => {
    window.addEventListener('scroll', fromScroll, { passive: true })
    return () => window.removeEventListener('scroll', fromScroll)
  }, [fromScroll])

  return (
    <ul className="space-y-1">
      {items.map(({ href, label }) => {
        const isSection = href.startsWith('#')
        const isActive = isSection && active === href.slice(1)
        return (
          <li key={href}>
            <a
              href={href}
              aria-current={isActive ? 'location' : undefined}
              onClick={isSection ? () => setActive(href.slice(1)) : undefined}
              className={`block rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${
                isActive ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground'
              }`}
            >
              {label}
            </a>
          </li>
        )
      })}
    </ul>
  )
}
