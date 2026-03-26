'use client'

// ============================================================
// Order History Table — WO-30
// ============================================================
//
// REQ-CAD-004: Filterable order history table.
//   Columns: Order #, Patient, Medication, Status, Retail Price,
//            Platform Fee, Clinic Payout, Date.
//
// All monetary values are pre-computed as integer cents (HC-01) by the
// Server Component and formatted here for display.

import { useState } from 'react'
import type { OrderStatusEnum } from '@/types/database.types'

// OrderRow: financial history view used by this component (WO-30).
// For the full operational DashboardOrder type see DashboardOrder in ../page.
interface OrderRow {
  orderId:           string
  patientName:       string
  medicationName:    string
  status:            OrderStatusEnum
  retailCents:       number
  platformFeeCents:  number
  clinicPayoutCents: number
  createdAt:         string
}

interface Props {
  orders: OrderRow[]
}

function toCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year:  'numeric',
    month: 'short',
    day:   'numeric',
  })
}

// Friendly label + color for each order status
const STATUS_DISPLAY: Record<string, { label: string; className: string }> = {
  DRAFT:                  { label: 'Draft',                 className: 'bg-muted text-muted-foreground' },
  AWAITING_PAYMENT:       { label: 'Awaiting Payment',      className: 'bg-yellow-100 text-yellow-800' },
  PAYMENT_EXPIRED:        { label: 'Payment Expired',       className: 'bg-red-100 text-red-800' },
  PAID_PROCESSING:        { label: 'Paid — Processing',     className: 'bg-blue-100 text-blue-800' },
  SUBMISSION_PENDING:     { label: 'Submission Pending',    className: 'bg-blue-100 text-blue-800' },
  SUBMISSION_FAILED:      { label: 'Submission Failed',     className: 'bg-red-100 text-red-800' },
  FAX_QUEUED:             { label: 'Fax Queued',            className: 'bg-blue-100 text-blue-800' },
  FAX_DELIVERED:          { label: 'Fax Delivered',         className: 'bg-emerald-100 text-emerald-800' },
  FAX_FAILED:             { label: 'Fax Failed',            className: 'bg-red-100 text-red-800' },
  PHARMACY_ACKNOWLEDGED:  { label: 'Acknowledged',          className: 'bg-emerald-100 text-emerald-800' },
  PHARMACY_COMPOUNDING:   { label: 'Compounding',           className: 'bg-blue-100 text-blue-800' },
  PHARMACY_PROCESSING:    { label: 'Processing',            className: 'bg-blue-100 text-blue-800' },
  PHARMACY_REJECTED:      { label: 'Rejected',              className: 'bg-red-100 text-red-800' },
  REROUTE_PENDING:        { label: 'Reroute Pending',       className: 'bg-orange-100 text-orange-800' },
  READY_TO_SHIP:          { label: 'Ready to Ship',         className: 'bg-emerald-100 text-emerald-800' },
  SHIPPED:                { label: 'Shipped',               className: 'bg-emerald-100 text-emerald-800' },
  DELIVERED:              { label: 'Delivered',             className: 'bg-emerald-100 text-emerald-800' },
  CANCELLED:              { label: 'Cancelled',             className: 'bg-muted text-muted-foreground' },
  ERROR_PAYMENT_FAILED:   { label: 'Payment Failed',        className: 'bg-red-100 text-red-800' },
  ERROR_COMPLIANCE_HOLD:  { label: 'Compliance Hold',       className: 'bg-red-100 text-red-800' },
  REFUND_PENDING:         { label: 'Refund Pending',        className: 'bg-orange-100 text-orange-800' },
  REFUNDED:               { label: 'Refunded',              className: 'bg-muted text-muted-foreground' },
  DISPUTED:               { label: 'Disputed',              className: 'bg-red-100 text-red-800' },
}

// Status groups for the filter dropdown
const STATUS_GROUPS: { label: string; value: string }[] = [
  { label: 'All',                value: '' },
  { label: 'Active',             value: 'active' },
  { label: 'Awaiting Payment',   value: 'AWAITING_PAYMENT' },
  { label: 'Delivered',          value: 'DELIVERED' },
  { label: 'Cancelled / Errors', value: 'terminal-bad' },
]

const ACTIVE_STATUSES = new Set<OrderStatusEnum>([
  'PAID_PROCESSING', 'SUBMISSION_PENDING', 'FAX_QUEUED', 'FAX_DELIVERED',
  'PHARMACY_ACKNOWLEDGED', 'PHARMACY_COMPOUNDING', 'PHARMACY_PROCESSING',
  'READY_TO_SHIP', 'SHIPPED',
])

const TERMINAL_BAD_STATUSES = new Set<OrderStatusEnum>([
  'PAYMENT_EXPIRED', 'SUBMISSION_FAILED', 'FAX_FAILED', 'PHARMACY_REJECTED',
  'CANCELLED', 'ERROR_PAYMENT_FAILED', 'ERROR_COMPLIANCE_HOLD',
  'REFUND_PENDING', 'REFUNDED', 'DISPUTED',
])

function matchesFilter(order: OrderRow, filter: string): boolean {
  if (!filter) return true
  if (filter === 'active') return ACTIVE_STATUSES.has(order.status)
  if (filter === 'terminal-bad') return TERMINAL_BAD_STATUSES.has(order.status)
  return order.status === filter
}

export function OrderHistoryTable({ orders }: Props) {
  const [statusFilter, setStatusFilter] = useState('')

  const filtered = orders.filter(o => matchesFilter(o, statusFilter))

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-base font-semibold text-foreground">Order History</h2>

        {/* Status filter */}
        <div className="flex items-center gap-2">
          <label htmlFor="status-filter" className="text-sm text-muted-foreground">
            Filter:
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {STATUS_GROUPS.map(g => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          {orders.length === 0
            ? 'No orders yet. Create your first prescription to get started.'
            : 'No orders match the selected filter.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Order #</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Patient</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Medication</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Retail</th>
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Platform Fee</th>
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Your Payout</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(order => {
                const display = STATUS_DISPLAY[order.status] ?? { label: order.status, className: 'bg-muted text-muted-foreground' }
                return (
                  <tr key={order.orderId} className="hover:bg-muted/30">
                    <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                      {order.orderId.slice(0, 8)}…
                    </td>
                    <td className="px-3 py-2.5 text-foreground">{order.patientName}</td>
                    <td className="px-3 py-2.5 text-foreground">{order.medicationName}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${display.className}`}>
                        {display.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-foreground">{toCurrency(order.retailCents)}</td>
                    <td className="px-3 py-2.5 text-right text-muted-foreground">{toCurrency(order.platformFeeCents)}</td>
                    <td className="px-3 py-2.5 text-right font-medium text-emerald-600">{toCurrency(order.clinicPayoutCents)}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{formatDate(order.createdAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          Showing {filtered.length} of {orders.length} orders
        </p>
      )}
    </section>
  )
}
