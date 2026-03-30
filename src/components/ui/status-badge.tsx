// ─────────────────────────────────────────────────────────────
// StatusBadge — WO-70
//
// Dot + text status indicator. Replaces all inline status pill
// implementations across Clinic App, Ops Dashboard, and Checkout.
//
// Uses direct hex colors (not Tailwind classes) so the badge
// responds to its local CSS context regardless of dark/light mode
// scoping. Colors are sourced from ORDER_STATUS_CONFIG which is the
// single source of truth for status display.
//
// Usage:
//   <StatusBadge status="FAX_QUEUED" />
//   <StatusBadge status={order.status} className="text-xs" />
// ─────────────────────────────────────────────────────────────

import { cn } from '@/lib/utils'
import { getStatusConfig } from '@/lib/orders/status-config'
import type { OrderStatusEnum } from '@/types/database.types'

interface StatusBadgeProps {
  status:    OrderStatusEnum | string
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = getStatusConfig(status)

  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-1.5 text-sm transition-colors duration-[var(--duration-normal)]',
        className,
      )}
      style={{ color: config.textColor }}
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
