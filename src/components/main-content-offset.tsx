'use client'

// ============================================================
// MainContentOffset — dynamic sidebar offset wrapper
// ============================================================
//
// Reads the sidebar collapse state from localStorage on mount
// and listens for 'sidebar-toggle' custom events dispatched by
// SidebarNav when the collapse toggle is clicked.
//
// md:  always 56px offset (icon-rail, never collapses on tablet)
// xl:  240px when expanded, 56px when collapsed

import { useState, useEffect } from 'react'

export function MainContentOffset({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    // Restore persisted collapse state on mount
    try {
      const saved = localStorage.getItem('sidebar-collapsed')
      if (saved === 'true') setCollapsed(true)
    } catch { /* localStorage not available */ }

    // Listen for toggle events from SidebarNav
    function handleToggle(e: Event) {
      setCollapsed((e as CustomEvent<{ collapsed: boolean }>).detail.collapsed)
    }
    window.addEventListener('sidebar-toggle', handleToggle)
    return () => window.removeEventListener('sidebar-toggle', handleToggle)
  }, [])

  return (
    <div className={`md:pl-14 transition-[padding] duration-[var(--duration-normal)] ${collapsed ? 'xl:pl-14' : 'xl:pl-60'}`}>
      {children}
    </div>
  )
}
