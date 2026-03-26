'use client'

// ============================================================
// Orders Kanban View — WO-31
// ============================================================
//
// REQ-GDB-001: Kanban board view (alternative to table).
//   Lanes: Drafts | Awaiting Payment | Submitting | Processing | Shipped | Errors
//   - Error cards: Terra/Rust (#A84B2F) left border, 4px wide.
//   - Overdue 48h+ cards: amber background + ⏰ icon.
//   - Lanes show card count badge.

import type { DashboardOrder } from '../page'
import type { OrderStatusEnum } from '@/types/database.types'

interface Props {
  orders:      DashboardOrder[]
  onCardClick: (order: DashboardOrder) => void
}

interface KanbanLane {
  id:       string
  label:    string
  statuses: Set<OrderStatusEnum>
}

const LANES: KanbanLane[] = [
  {
    id:       'drafts',
    label:    'Drafts',
    statuses: new Set<OrderStatusEnum>(['DRAFT']),
  },
  {
    id:       'awaiting_payment',
    label:    'Awaiting Payment',
    statuses: new Set<OrderStatusEnum>(['AWAITING_PAYMENT', 'PAYMENT_EXPIRED']),
  },
  {
    id:       'submitting',
    label:    'Submitting',
    statuses: new Set<OrderStatusEnum>(['SUBMISSION_PENDING', 'FAX_QUEUED', 'FAX_DELIVERED']),
  },
  {
    id:       'processing',
    label:    'Processing',
    statuses: new Set<OrderStatusEnum>([
      'PAID_PROCESSING', 'PHARMACY_ACKNOWLEDGED', 'PHARMACY_COMPOUNDING',
      'PHARMACY_PROCESSING', 'READY_TO_SHIP',
    ]),
  },
  {
    id:       'shipped',
    label:    'Shipped',
    statuses: new Set<OrderStatusEnum>(['SHIPPED', 'DELIVERED']),
  },
  {
    id:       'errors',
    label:    'Errors',
    // BLK-05: keep consistent with dashboard "errors" tab and ERROR_STATUSES border set
    // REFUND_PENDING, REFUNDED, CANCELLED are terminal-resolved states — not shown in Kanban
    statuses: new Set<OrderStatusEnum>([
      'SUBMISSION_FAILED', 'FAX_FAILED', 'PHARMACY_REJECTED', 'REROUTE_PENDING',
      'ERROR_PAYMENT_FAILED', 'ERROR_COMPLIANCE_HOLD', 'DISPUTED',
    ]),
  },
]

const ERROR_STATUSES = new Set([
  'SUBMISSION_FAILED', 'FAX_FAILED', 'PHARMACY_REJECTED',
  'REROUTE_PENDING', 'ERROR_PAYMENT_FAILED', 'ERROR_COMPLIANCE_HOLD', 'DISPUTED',
])

function KanbanCard({ order, onClick }: { order: DashboardOrder; onClick: () => void }) {
  const isError = ERROR_STATUSES.has(order.status)
  return (
    <button
      type="button"
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick() }}
      className={`
        w-full text-left rounded-md border bg-card p-3 space-y-1
        hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
        transition-shadow
        ${order.isOverdue48h ? 'bg-amber-50 border-amber-300' : 'border-border'}
      `}
      // REQ-GDB-001: Terra/Rust left border for error cards
      style={isError ? { borderLeft: '4px solid #A84B2F' } : undefined}
      aria-label={`${order.medicationName} — ${order.patientName}`}
    >
      <p className="text-xs font-mono text-muted-foreground">
        {order.isOverdue48h && <span className="mr-1" title="Payment overdue 48h+">⏰</span>}
        {order.orderId.slice(0, 8)}…
      </p>
      <p className="text-sm font-medium text-foreground leading-tight">{order.medicationName}</p>
      <p className="text-xs text-muted-foreground">{order.patientName}</p>
    </button>
  )
}

export function OrdersKanban({ orders, onCardClick }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      {LANES.map(lane => {
        const laneOrders = orders.filter(o => lane.statuses.has(o.status))
        return (
          <div key={lane.id} className="flex flex-col min-h-[200px]">
            {/* Lane header */}
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
                {lane.label}
              </p>
              <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                {laneOrders.length}
              </span>
            </div>

            {/* Cards */}
            <div className="flex flex-col gap-2 rounded-lg bg-muted/30 p-2 flex-1">
              {laneOrders.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center pt-4">—</p>
              ) : (
                laneOrders.map(order => (
                  <KanbanCard
                    key={order.orderId}
                    order={order}
                    onClick={() => onCardClick(order)}
                  />
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
