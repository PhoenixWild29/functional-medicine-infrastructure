'use client'

// ============================================================
// Orders Kanban View — WO-71 (redesign from WO-31)
//
// REQ-GDB-001: Kanban board view.
// WO-71 upgrades:
//   - @dnd-kit/core drag-and-drop with shadow lift on drag start
//   - Invalid drop target visual rejection (red ring)
//   - Column overflow scroll (max 200px height internal)
//   - Skeleton loading per lane
//   - Empty lane dashed border state
//   - StatusBadge on each card
//   - Polished card design per WO-71 spec
//
// Drag behavior: visual feedback only — drop opens the order drawer
// (state transitions require server validation, not client drag)
// ============================================================

import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  type Active,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { DashboardOrder } from '../page'
import type { OrderStatusEnum } from '@/types/database.types'
import { StatusBadge } from '@/components/ui/status-badge'
import { SkeletonKanbanCard } from '@/components/ui/skeleton'

// ── Lane definitions ─────────────────────────────────────────

interface KanbanLane {
  id:            string
  label:         string
  statuses:      Set<OrderStatusEnum>
  // Statuses that can be "dragged into" this lane — empty = invalid drop target
  acceptStatuses: Set<OrderStatusEnum>
}

const LANES: KanbanLane[] = [
  {
    id:             'drafts',
    label:          'Drafts',
    statuses:       new Set<OrderStatusEnum>(['DRAFT']),
    acceptStatuses: new Set(),
  },
  {
    id:             'awaiting_payment',
    label:          'Awaiting Payment',
    statuses:       new Set<OrderStatusEnum>(['AWAITING_PAYMENT', 'PAYMENT_EXPIRED']),
    acceptStatuses: new Set(),
  },
  {
    id:             'submitting',
    label:          'Submitting',
    statuses:       new Set<OrderStatusEnum>(['SUBMISSION_PENDING', 'FAX_QUEUED', 'FAX_DELIVERED']),
    acceptStatuses: new Set(),
  },
  {
    id:             'processing',
    label:          'Processing',
    statuses:       new Set<OrderStatusEnum>([
      'PAID_PROCESSING', 'PHARMACY_ACKNOWLEDGED', 'PHARMACY_COMPOUNDING',
      'PHARMACY_PROCESSING', 'READY_TO_SHIP',
    ]),
    acceptStatuses: new Set(),
  },
  {
    id:             'shipped',
    label:          'Shipped',
    statuses:       new Set<OrderStatusEnum>(['SHIPPED', 'DELIVERED']),
    acceptStatuses: new Set(),
  },
  {
    id:             'errors',
    label:          'Errors',
    // BLK-05: REFUND_PENDING, REFUNDED, CANCELLED — terminal-resolved, not shown in Kanban
    statuses:       new Set<OrderStatusEnum>([
      'SUBMISSION_FAILED', 'FAX_FAILED', 'PHARMACY_REJECTED', 'REROUTE_PENDING',
      'ERROR_PAYMENT_FAILED', 'ERROR_COMPLIANCE_HOLD', 'DISPUTED',
    ]),
    acceptStatuses: new Set(),
  },
]

const ERROR_STATUSES = new Set([
  'SUBMISSION_FAILED', 'FAX_FAILED', 'PHARMACY_REJECTED',
  'REROUTE_PENDING', 'ERROR_PAYMENT_FAILED', 'ERROR_COMPLIANCE_HOLD', 'DISPUTED',
])

// ── Props ─────────────────────────────────────────────────────

interface Props {
  orders:      DashboardOrder[]
  onCardClick: (order: DashboardOrder) => void
  isLoading?:  boolean
}

// ── Draggable card ────────────────────────────────────────────

function DraggableCard({
  order,
  onClick,
  isDragging = false,
}: {
  order:      DashboardOrder
  onClick:    () => void
  isDragging?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: order.orderId,
  })

  const isError = ERROR_STATUSES.has(order.status)

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    ...(isError ? { borderLeft: '4px solid #A84B2F' } : {}),
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={[
        'rounded-lg border bg-card p-3 cursor-grab active:cursor-grabbing select-none',
        'transition-shadow duration-[var(--duration-normal)]',
        isDragging ? 'shadow-lg opacity-50' : 'shadow-sm hover:shadow-md',
        order.isOverdue48h ? 'bg-amber-50 border-amber-300' : 'border-border',
      ].join(' ')}
      aria-label={`${order.medicationName} — ${order.patientName}`}
    >
      {/* Order ID + overdue indicator */}
      <p className="font-mono text-[11px] text-muted-foreground">
        {order.isOverdue48h && <span className="mr-1" title="Payment overdue 48h+" aria-label="Overdue">⏰</span>}
        {order.orderId.slice(0, 8)}…
      </p>

      {/* Patient name */}
      <p className="mt-1 text-sm font-medium text-foreground leading-tight">{order.patientName}</p>

      {/* Medication */}
      <p className="mt-0.5 text-[13px] text-muted-foreground leading-tight">{order.medicationName}</p>

      {/* Status badge — bottom, click to open drawer */}
      <div className="mt-3 flex items-center justify-between">
        <StatusBadge status={order.status} className="text-[11px]" />
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onClick() }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onClick() } }}
          className="text-[10px] text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
        >
          View
        </button>
      </div>
    </div>
  )
}

// ── Drop zone (lane) ─────────────────────────────────────────

function DroppableLane({
  lane,
  children,
  isInvalidTarget,
}: {
  lane:            KanbanLane
  children:        React.ReactNode
  isInvalidTarget: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: lane.id })

  return (
    <div
      ref={setNodeRef}
      className={[
        'flex flex-col gap-2 rounded-lg p-2 flex-1 min-h-[80px] max-h-[200px] overflow-y-auto',
        'transition-colors duration-[var(--duration-fast)]',
        isOver && isInvalidTarget  ? 'bg-red-50 ring-2 ring-red-400 ring-inset'  : '',
        isOver && !isInvalidTarget ? 'bg-primary/5 ring-2 ring-primary/30 ring-inset' : '',
        !isOver ? 'bg-slate-50/60' : '',
      ].join(' ')}
    >
      {children}
    </div>
  )
}

// ── Overlay card (drag ghost) ────────────────────────────────

function OverlayCard({ order }: { order: DashboardOrder }) {
  const isError = ERROR_STATUSES.has(order.status)
  return (
    <div
      className="rounded-lg border border-border bg-card p-3 shadow-xl w-48"
      style={isError ? { borderLeft: '4px solid #A84B2F' } : {}}
    >
      <p className="font-mono text-[11px] text-muted-foreground">{order.orderId.slice(0, 8)}…</p>
      <p className="mt-1 text-sm font-medium text-foreground leading-tight">{order.patientName}</p>
      <p className="mt-0.5 text-[13px] text-muted-foreground">{order.medicationName}</p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────

export function OrdersKanban({ orders, onCardClick, isLoading = false }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null)

  const activeOrder = orders.find(o => o.orderId === activeId) ?? null

  // Determine if the currently-dragged card would be an invalid drop on overLaneId
  const isInvalidDrop = (laneId: string): boolean => {
    if (!activeOrder) return false
    const lane = LANES.find(l => l.id === laneId)
    if (!lane) return false
    // Card is currently in this lane → same-lane drop is a no-op, not invalid
    if (lane.statuses.has(activeOrder.status)) return false
    // Lane has no acceptStatuses defined → all cross-lane drops are invalid
    return lane.acceptStatuses.size === 0
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { over, active } = event
    setActiveId(null)

    // On drop: open the order detail drawer (visual affordance — no state transition)
    if (over) {
      const order = orders.find(o => o.orderId === (active as Active).id)
      if (order) onCardClick(order)
    }
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {LANES.map(lane => (
          <div key={lane.id} className="flex flex-col">
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {lane.label}
              </p>
            </div>
            <div className="flex flex-col gap-2 rounded-lg bg-slate-50/60 p-2">
              {[1, 2, 3].map(i => <SkeletonKanbanCard key={i} />)}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {LANES.map(lane => {
          const laneOrders = orders.filter(o => lane.statuses.has(o.status))
          const invalid    = activeId ? isInvalidDrop(lane.id) : false

          return (
            <div key={lane.id} className="flex flex-col">
              {/* Lane header */}
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {lane.label}
                </p>
                <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                  {laneOrders.length}
                </span>
              </div>

              <DroppableLane lane={lane} isInvalidTarget={invalid}>
                {laneOrders.length === 0 ? (
                  <div className="flex items-center justify-center rounded-md border border-dashed border-border py-6">
                    <p className="text-xs text-muted-foreground">No orders here</p>
                  </div>
                ) : (
                  laneOrders.map(order => (
                    <DraggableCard
                      key={order.orderId}
                      order={order}
                      onClick={() => onCardClick(order)}
                      isDragging={order.orderId === activeId}
                    />
                  ))
                )}
              </DroppableLane>
            </div>
          )
        })}
      </div>

      {/* Drag ghost overlay — z-50 prevents clipping by other stacking contexts */}
      <DragOverlay className="z-50">
        {activeOrder ? <OverlayCard order={activeOrder} /> : null}
      </DragOverlay>
    </DndContext>
  )
}
