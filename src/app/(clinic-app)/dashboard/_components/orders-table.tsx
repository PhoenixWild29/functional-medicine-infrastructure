'use client'

// ============================================================
// Orders Table View — WO-31
// ============================================================
//
// REQ-GDB-001: Filterable order table.
//   Columns: Order #, Patient Name, Medication, Status,
//            Submission Method (tier icon), Created Date, Last Updated.
//   - Error rows: Terra/Rust (#A84B2F) left border, 4px wide.
//   - Unpaid 48h+ rows: amber background + ⏰ icon.
//   - Skeleton loading rows during first load.

import type { DashboardOrder } from '../page'

interface Props {
  orders:         DashboardOrder[]
  isLoading:      boolean
  onRowClick:     (order: DashboardOrder) => void
}

// Error statuses — Terra/Rust (#A84B2F) left border (REQ-GDB-001)
const ERROR_STATUSES = new Set([
  'SUBMISSION_FAILED', 'FAX_FAILED', 'PHARMACY_REJECTED',
  'REROUTE_PENDING', 'ERROR_PAYMENT_FAILED', 'ERROR_COMPLIANCE_HOLD',
  'DISPUTED',
])

// Tier display labels + icons
// NB-1: include TIER_3_SPEC (added to integration_tier_enum in migration wo46_adapter_audit_trail)
const TIER_DISPLAY: Record<string, { label: string; icon: string }> = {
  TIER_1_API:    { label: 'API',       icon: '⚡' },
  TIER_2_PORTAL: { label: 'Portal',    icon: '🌐' },
  TIER_3_HYBRID: { label: 'Hybrid',    icon: '🔀' },
  TIER_3_SPEC:   { label: 'Tier 3',    icon: '📋' },
  TIER_4_FAX:    { label: 'Fax',       icon: '📠' },
}

// Status badge styling
const STATUS_BADGE: Record<string, string> = {
  DRAFT:                  'bg-muted text-muted-foreground',
  AWAITING_PAYMENT:       'bg-yellow-100 text-yellow-800',
  PAYMENT_EXPIRED:        'bg-red-100 text-red-800',
  PAID_PROCESSING:        'bg-blue-100 text-blue-800',
  SUBMISSION_PENDING:     'bg-blue-100 text-blue-800',
  SUBMISSION_FAILED:      'bg-red-100 text-red-800',
  FAX_QUEUED:             'bg-blue-100 text-blue-800',
  FAX_DELIVERED:          'bg-emerald-100 text-emerald-800',
  FAX_FAILED:             'bg-red-100 text-red-800',
  PHARMACY_ACKNOWLEDGED:  'bg-emerald-100 text-emerald-800',
  PHARMACY_COMPOUNDING:   'bg-blue-100 text-blue-800',
  PHARMACY_PROCESSING:    'bg-blue-100 text-blue-800',
  PHARMACY_REJECTED:      'bg-red-100 text-red-800',
  REROUTE_PENDING:        'bg-orange-100 text-orange-800',
  READY_TO_SHIP:          'bg-emerald-100 text-emerald-800',
  SHIPPED:                'bg-emerald-100 text-emerald-800',
  DELIVERED:              'bg-emerald-100 text-emerald-800',
  CANCELLED:              'bg-muted text-muted-foreground',
  ERROR_PAYMENT_FAILED:   'bg-red-100 text-red-800',
  ERROR_COMPLIANCE_HOLD:  'bg-red-100 text-red-800',
  REFUND_PENDING:         'bg-orange-100 text-orange-800',
  REFUNDED:               'bg-muted text-muted-foreground',
  DISPUTED:               'bg-red-100 text-red-800',
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT:                  'Draft',
  AWAITING_PAYMENT:       'Awaiting Payment',
  PAYMENT_EXPIRED:        'Payment Expired',
  PAID_PROCESSING:        'Processing',
  SUBMISSION_PENDING:     'Submitting',
  SUBMISSION_FAILED:      'Sub. Failed',
  FAX_QUEUED:             'Fax Queued',
  FAX_DELIVERED:          'Fax Sent',
  FAX_FAILED:             'Fax Failed',
  PHARMACY_ACKNOWLEDGED:  'Acknowledged',
  PHARMACY_COMPOUNDING:   'Compounding',
  PHARMACY_PROCESSING:    'Processing',
  PHARMACY_REJECTED:      'Rejected',
  REROUTE_PENDING:        'Rerouting',
  READY_TO_SHIP:          'Ready to Ship',
  SHIPPED:                'Shipped',
  DELIVERED:              'Delivered',
  CANCELLED:              'Cancelled',
  ERROR_PAYMENT_FAILED:   'Payment Error',
  ERROR_COMPLIANCE_HOLD:  'Compliance Hold',
  REFUND_PENDING:         'Refund Pending',
  REFUNDED:               'Refunded',
  DISPUTED:               'Disputed',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day:   'numeric',
    year:  'numeric',
  })
}

function SkeletonRow() {
  return (
    <tr aria-hidden>
      {[...Array(7)].map((_, i) => (
        <td key={i} className="px-3 py-3">
          <div className="h-4 animate-pulse rounded bg-muted" style={{ width: `${60 + (i * 13) % 40}%` }} />
        </td>
      ))}
    </tr>
  )
}

export function OrdersTable({ orders, isLoading, onRowClick }: Props) {
  if (isLoading && orders.length === 0) {
    return (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Order #</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Patient</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Medication</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Status</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Method</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Created</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[1, 2, 3, 4, 5].map(i => <SkeletonRow key={i} />)}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40">
          <tr>
            <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Order #</th>
            <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Patient</th>
            <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Medication</th>
            <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Status</th>
            <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Method</th>
            <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Created</th>
            <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {orders.map(order => {
            const isError = ERROR_STATUSES.has(order.status)
            const rowClass = order.isOverdue48h
              ? 'bg-amber-50 cursor-pointer hover:bg-amber-100'
              : 'cursor-pointer hover:bg-muted/30'

            return (
              <tr
                key={order.orderId}
                data-order-id={order.orderId}
                onClick={() => onRowClick(order)}
                className={rowClass}
                // REQ-GDB-001: Terra/Rust (#A84B2F) left border for error rows
                style={isError ? { borderLeft: '4px solid #A84B2F' } : undefined}
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onRowClick(order) }}
                // NB-01: prefix "Error —" so screen reader users know the row is in an error state
                aria-label={`${ERROR_STATUSES.has(order.status) ? 'Error — ' : ''}Order ${order.orderId.slice(0, 8)} — ${order.patientName} — ${order.status}`}
              >
                <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                  {order.orderId.slice(0, 8)}…
                </td>
                <td className="px-3 py-2.5 text-foreground">{order.patientName}</td>
                <td className="px-3 py-2.5 text-foreground">{order.medicationName}</td>
                <td className="px-3 py-2.5">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[order.status] ?? 'bg-muted text-muted-foreground'}`}>
                    {STATUS_LABELS[order.status] ?? order.status}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  {order.submissionTier ? (
                    <span className="text-xs text-muted-foreground" title={order.submissionTier}>
                      {TIER_DISPLAY[order.submissionTier]?.icon ?? '—'}{' '}
                      {TIER_DISPLAY[order.submissionTier]?.label ?? order.submissionTier}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">
                  {/* REQ-GDB-001: amber ⏰ icon for overdue unpaid orders */}
                  {order.isOverdue48h && (
                    <span className="mr-1" title="Payment overdue 48h+" aria-label="Overdue">⏰</span>
                  )}
                  {formatDate(order.createdAt)}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{formatDate(order.updatedAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
