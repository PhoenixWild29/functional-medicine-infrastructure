'use client'

// ============================================================
// Sidebar Navigation — WO-71
//
// Breakpoints:
//   ≥1280px (xl): 240px expanded sidebar with text labels
//   768–1279px  : 56px icon-rail only (tablet / iPad on rolling cart)
//   <768px      : hidden sidebar + slide-over drawer via hamburger
//
// Collapse toggle (desktop only) stored in localStorage.
// ============================================================

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard,
  FilePlus,
  Settings,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  LogOut,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface NavItem {
  href:  string
  label: string
  icon:  React.ElementType
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',        label: 'Dashboard',         icon: LayoutDashboard },
  { href: '/new-prescription', label: 'New Prescription',  icon: FilePlus },
  { href: '/settings',         label: 'Settings',          icon: Settings },
]

interface Props {
  userEmail: string
  userRole:  string
}

export function SidebarNav({ userEmail, userRole }: Props) {
  const pathname = usePathname()
  const router   = useRouter()

  // Desktop collapse state — persisted to localStorage
  const [isCollapsed,    setIsCollapsed]    = useState(false)
  const [mobileOpen,     setMobileOpen]     = useState(false)
  const [signingOut,     setSigningOut]     = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('sidebar-collapsed')
      if (saved === 'true') setIsCollapsed(true)
    } catch {
      // localStorage not available (SSR)
    }
  }, [])

  function toggleCollapse() {
    const next = !isCollapsed
    setIsCollapsed(next)
    try {
      localStorage.setItem('sidebar-collapsed', String(next))
      window.dispatchEvent(new CustomEvent('sidebar-toggle', { detail: { collapsed: next } }))
    } catch { /* ignore */ }
  }

  async function handleSignOut() {
    setSigningOut(true)
    const supabase = createBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const roleLabel = (role: string) => {
    const map: Record<string, string> = {
      clinic_admin:       'Admin',
      provider:           'Provider',
      medical_assistant:  'MA',
    }
    return map[role] ?? role
  }

  // ── Nav item ────────────────────────────────────────────

  function NavLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
    const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
    const Icon = item.icon
    return (
      <Link
        href={item.href}
        onClick={() => setMobileOpen(false)}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-[var(--duration-fast)]',
          isActive
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          collapsed && 'justify-center px-2',
        )}
        aria-label={collapsed ? item.label : undefined}
        title={collapsed ? item.label : undefined}
        aria-current={isActive ? 'page' : undefined}
      >
        <Icon className="h-4.5 w-4.5 flex-shrink-0" />
        {!collapsed && <span>{item.label}</span>}
      </Link>
    )
  }

  // ── Sidebar content ─────────────────────────────────────

  function SidebarContent({ collapsed }: { collapsed: boolean }) {
    return (
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className={cn(
          'flex h-14 items-center border-b border-border px-3',
          collapsed ? 'justify-center' : 'gap-2 px-4',
        )}>
          {collapsed ? (
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
              <svg width="14" height="14" viewBox="0 0 32 32" fill="none" aria-hidden>
                <rect x="4" y="4" width="11" height="11" rx="2" fill="white" fillOpacity="0.95" />
                <rect x="18" y="4" width="11" height="11" rx="2" fill="white" fillOpacity="0.6" />
                <rect x="4" y="18" width="11" height="11" rx="2" fill="white" fillOpacity="0.6" />
                <rect x="18" y="18" width="11" height="11" rx="2" fill="white" fillOpacity="0.3" />
              </svg>
            </div>
          ) : (
            <>
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary flex-shrink-0">
                <svg width="14" height="14" viewBox="0 0 32 32" fill="none" aria-hidden>
                  <rect x="4" y="4" width="11" height="11" rx="2" fill="white" fillOpacity="0.95" />
                  <rect x="18" y="4" width="11" height="11" rx="2" fill="white" fillOpacity="0.6" />
                  <rect x="4" y="18" width="11" height="11" rx="2" fill="white" fillOpacity="0.6" />
                  <rect x="18" y="18" width="11" height="11" rx="2" fill="white" fillOpacity="0.3" />
                </svg>
              </div>
              <span className="text-sm font-bold text-foreground tracking-tight">CompoundIQ</span>
            </>
          )}
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5" aria-label="Main navigation">
          {NAV_ITEMS.map(item => (
            <NavLink key={item.href} item={item} collapsed={collapsed} />
          ))}
        </nav>

        {/* User footer */}
        <div className={cn(
          'border-t border-border p-2',
          collapsed ? 'space-y-1' : 'space-y-1',
        )}>
          {!collapsed && (
            <div className="flex items-center gap-2.5 rounded-lg px-3 py-2">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary uppercase">
                {userEmail.charAt(0)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-foreground">{userEmail.split('@')[0]}</p>
                <p className="text-[10px] text-muted-foreground">{roleLabel(userRole)}</p>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50',
              collapsed && 'justify-center px-2',
            )}
            title={collapsed ? 'Sign out' : undefined}
          >
            <LogOut className="h-4 w-4 flex-shrink-0" />
            {!collapsed && <span>{signingOut ? 'Signing out…' : 'Sign out'}</span>}
          </button>

          {/* Desktop collapse toggle */}
          <div className="hidden xl:block">
            <button
              type="button"
              onClick={toggleCollapse}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors',
                collapsed && 'justify-center px-2',
              )}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed
                ? <ChevronRight className="h-3.5 w-3.5" />
                : <><ChevronLeft className="h-3.5 w-3.5" /><span>Collapse</span></>}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* ── Desktop/tablet sidebar ── */}
      <aside
        className={cn(
          'hidden md:flex flex-col fixed inset-y-0 left-0 z-30 border-r border-border bg-card transition-all duration-[var(--duration-normal)]',
          // xl: respect collapse toggle | md–lg: always icon-rail
          'xl:w-[240px]',
          isCollapsed && 'xl:w-14',
          // NB-4: tablet (md–xl): always icon-rail; xl:w-auto removed (dead — xl:w-[240px] always wins)
          'md:w-14',
        )}
        style={{
          width: undefined, // let Tailwind handle
        }}
      >
        {/* On xl: show full or collapsed based on state.
            On md–lg: always show icon-rail (collapsed=true) */}
        <div className="hidden xl:flex flex-col h-full">
          <SidebarContent collapsed={isCollapsed} />
        </div>
        <div className="flex xl:hidden flex-col h-full">
          <SidebarContent collapsed={true} />
        </div>
      </aside>

      {/* ── Mobile: top bar + slide-over drawer ── */}
      <div className="md:hidden">
        {/* Sticky top bar */}
        <div className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-card px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary">
              <svg width="12" height="12" viewBox="0 0 32 32" fill="none" aria-hidden>
                <rect x="4" y="4" width="11" height="11" rx="2" fill="white" fillOpacity="0.95" />
                <rect x="18" y="4" width="11" height="11" rx="2" fill="white" fillOpacity="0.6" />
                <rect x="4" y="18" width="11" height="11" rx="2" fill="white" fillOpacity="0.6" />
                <rect x="18" y="18" width="11" height="11" rx="2" fill="white" fillOpacity="0.3" />
              </svg>
            </div>
            <span className="text-sm font-bold text-foreground">CompoundIQ</span>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Open navigation"
          >
            <Menu className="h-4.5 w-4.5" />
          </button>
        </div>

        {/* Slide-over overlay */}
        {mobileOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/40"
              onClick={() => setMobileOpen(false)}
              aria-hidden="true"
            />
            <aside className="fixed inset-y-0 left-0 z-50 w-64 bg-card border-r border-border shadow-xl">
              <div className="absolute right-3 top-3">
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                  aria-label="Close navigation"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <SidebarContent collapsed={false} />
            </aside>
          </>
        )}
      </div>
    </>
  )
}
