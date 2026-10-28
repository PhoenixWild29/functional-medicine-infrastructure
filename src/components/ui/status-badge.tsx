// ─────────────────────────────────────────────────────────────
// StatusBadge — WO-70
//
// Dot + text status indicator. Replaces all inline status pill
// implementations across Clinic App, Ops Dashboard, and Checkout.
//
// Colors are sourced from ORDER_STATUS_CONFIG, the single source of
// truth for status display, and passed as CSS variables: the light
// text colour by default, its -300 counterpart under .dark (ops).
//
// Usage:
//   <StatusBadge status="FAX_QUEUED" />
//   <StatusBadge status={order.status} className="text-xs" />
// ─────────────────────────────────────────────────────────────

import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { getStatusConfig } from '@/lib/orders/status-config'
import type { OrderStatusEnum } from '@/types/database.types'

interface StatusBadgeProps {
  status:    OrderStatusEnum | string
  className?: string
}

// The config's text colours are -800/-900 shades, chosen for the light
// card (7:1 or more). On the ops dashboard's dark card they would be near
// invisible, so .dark uses the matching -300 shade (8:1 or more there).
const DARK_TEXT: Record<string, string> = {
  '#475569': '#CBD5E1', // slate-600 -> slate-300
  '#334155': '#CBD5E1', // slate-700 -> slate-300
  '#92400E': '#FCD34D', // amber-800 -> amber-300
  '#991B1B': '#FCA5A5', // red-800 -> red-300
  '#1E40AF': '#93C5FD', // blue-800 -> blue-300
  '#0E7490': '#67E8F9', // cyan-700 -> cyan-300
  '#14532D': '#86EFAC', // green-900 -> green-300
  '#5B21B6': '#C4B5FD', // violet-800 -> violet-300
  '#9A3412': '#FDBA74', // orange-800 -> orange-300
}

export function darkTextColor(textColor: string): string {
  return DARK_TEXT[textColor.toUpperCase()] ?? '#E2E8F0'
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = getStatusConfig(status)

  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-1.5 text-sm transition-colors duration-[var(--duration-normal)]',
        'text-[color:var(--status-fg)] dark:text-[color:var(--status-fg-dark)]',
        className,
      )}
      style={{ '--status-fg': config.textColor, '--status-fg-dark': darkTextColor(config.textColor) } as CSSProperties}
    >
      <span
        className="h-2 w-2 flex-shrink-0 rounded-full"
        style={{ backgroundColor: config.color }}
        aria-hidden="true"
      />
      {config.label}
    </span>
  )
}
