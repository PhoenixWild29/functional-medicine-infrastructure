'use client'

// ============================================================
// Orders Table View — WO-71 (typography + state upgrades from WO-31)
//
// REQ-GDB-001: Filterable order table.
//   - Error rows: Terra/Rust (#A84B2F) left border, 4px wide.
//   - Unpaid 48h+ rows: amber background + ⏰ icon.
//   - Skeleton loading (8 rows) via SkeletonTableRow.
//   - Error state: "Could not load orders" + Retry.
// WO-71 typography spec:
//   th: 11px font-medium uppercase tracking-wide, no background fill
//   td: 14px lh-1.6, border-b border-border
//   Row hover: hover:bg-muted/40 transition-colors duration-fast
//   Order ID: font-mono text-xs text-muted-foreground
// ============================================================

import type { DashboardOrder } from '../page'
import { StatusBadge } from '@/components/ui/status-badge'
import { SkeletonTableRow } from '@/components/ui/skeleton'

interface Props {
  orders:     DashboardOrder[]
  isLoading:  boolean
  isError?:   boolean
  onRowClick: (order: DashboardOrder) => void
  onRetry?:   () => void
}

// Error statuses — Terra/Rust (#A84B2F) left border (REQ-GDB-001)
const ERROR_STATUSES = new Set([
  'SUBMISSION_FAILED', 'FAX_FAILED', 'PHARMACY_REJECTED',
  'REROUTE_PENDING', 'ERROR_PAYMENT_FAILED', 'ERROR_COMPLIANCE_HOLD',
  'DISPUTED',
])

const TIER_DISPLAY: Record<string, { label: string; icon: string }> = {
  TIER_1_API:    { label: 'API',    icon: '⚡' },
  TIER_2_PORTAL: { label: 'Portal', icon: '🌐' },
  TIER_3_HYBRID: { label: 'Hybrid', icon: '🔀' },
  TIER_3_SPEC:   { label: 'Tier 3', icon: '📋' },
  TIER_4_FAX:    { label: 'Fax',    icon: '📠' },
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day:   'numeric',
    year:  'numeric',
  })
}

const TH_CLASS = 'px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground'

function TableHead() {
  return (
    <thead>
      <tr className="border-b border-border">
        <th className={TH_CLASS}>Order #</th>
        <th className={TH_CLASS}>Patient</th>
        <th className={TH_CLASS}>Medication</th>
        <th className={TH_CLASS}>Status</th>
        <th className={TH_CLASS}>Method</th>
        <th className={TH_CLASS}>Created</th>
        <th className={TH_CLASS}>Updated</th>
      </tr>
    </thead>
  )
}

export function OrdersTable({ orders, isLoading, isError = false, onRowClick, onRetry }: Props) {
  // Error state
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/10 py-16 text-center gap-3">
        <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <div>
          <p className="text-sm font-medium text-foreground">Could not load orders</p>
          <p className="text-xs text-muted-foreground mt-0.5">Check your connection and try again.</p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Try again
          </button>
        )}
      </div>
    )
  }

  // Loading skeleton
  if (isLoading && orders.length === 0) {
    return (
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <TableHead />
          <tbody className="divide-y divide-border">
            {[1, 2, 3, 4, 5, 6, 7, 8].map(i => <SkeletonTableRow key={i} cols={7} />)}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <TableHead />
        <tbody>
          {orders.map(order => {
            const isErr  = ERROR_STATUSES.has(order.status)
            const rowCls = order.isOverdue48h
              ? 'bg-amber-50 hover:bg-amber-100 cursor-pointer border-b border-border transition-colors duration-[var(--duration-fast)]'
              : 'hover:bg-muted/40 cursor-pointer border-b border-border transition-colors duration-[var(--duration-fast)]'

            return (
              <tr
                key={order.orderId}
                data-order-id={order.orderId}
                onClick={() => onRowClick(order)}
                className={rowCls}
                style={isErr ? { borderLeft: '4px solid #A84B2F' } : undefined}
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onRowClick(order) }}
                aria-label={`${isErr ? 'Error — ' : ''}Order ${order.orderId.slice(0, 8)} — ${order.patientName} — ${order.status}`}
              >
                <td className="px-3 py-3 font-mono text-xs text-muted-foreground leading-[1.6]">
                  {order.orderId.slice(0, 8)}…
                </td>
                <td className="px-3 py-3 text-[14px] text-foreground leading-[1.6]">{order.patientName}</td>
                <td className="px-3 py-3 text-[14px] text-foreground leading-[1.6]">{order.medicationName}</td>
                <td className="px-3 py-3">
                  <StatusBadge status={order.status} className="text-xs" />
                </td>
                <td className="px-3 py-3 text-[13px] text-muted-foreground leading-[1.6]">
                  {order.submissionTier ? (
                    <span title={order.submissionTier}>
                      {TIER_DISPLAY[order.submissionTier]?.icon ?? '—'}{' '}
                      {TIER_DISPLAY[order.submissionTier]?.label ?? order.submissionTier}
                    </span>
                  ) : '—'}
                </td>
                <td className="px-3 py-3 text-[13px] text-muted-foreground leading-[1.6]">
                  {order.isOverdue48h && (
                    <span className="mr-1" title="Payment overdue 48h+" aria-label="Overdue">⏰</span>
                  )}
                  {formatDate(order.createdAt)}
                </td>
                <td className="px-3 py-3 text-[13px] text-muted-foreground leading-[1.6]">
                  {formatDate(order.updatedAt)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
