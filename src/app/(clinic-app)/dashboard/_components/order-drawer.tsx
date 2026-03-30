'use client'

// ============================================================
// Order Detail Drawer — WO-31
// ============================================================
//
// REQ-GDB-002: Slide-out drawer showing:
//   - Financial split (wholesale, retail, platform fee, clinic payout)
//   - Full status timeline (from order_status_history)
//   - Tracking info (status-based summary)
//
// Rx PDF preview and adapter submission log are displayed
// as placeholders — full implementation follows pharmacy
// adapter work orders (out of scope for WO-31).

import { useEffect, useRef, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import type { DashboardOrder } from '../page'
import { getStatusConfig } from '@/lib/orders/status-config'

interface Props {
  order: DashboardOrder | null
  onClose: () => void
}

// NB-3: order_status_history uses old_status/new_status (not "status") per trigger schema
interface StatusHistoryRow {
  old_status: string
  new_status: string
  changed_by: string | null
  created_at: string
}

function toCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month:  'short',
    day:    'numeric',
    year:   'numeric',
    hour:   'numeric',
    minute: '2-digit',
  })
}


export function OrderDrawer({ order, onClose }: Props) {
  // BLK-03: stable ref prevents stale closure + avoids re-running effect when client recreated
  const supabaseRef = useRef(createBrowserClient())

  const [history,           setHistory]           = useState<StatusHistoryRow[]>([])
  const [isLoadingHistory,  setIsLoadingHistory]  = useState(false)

  // Fetch status timeline when drawer opens (order.orderId changes)
  useEffect(() => {
    if (!order) {
      setHistory([])
      return
    }

    setIsLoadingHistory(true)
    // NB-3: select old_status, new_status, changed_by — there is no "status" or "note" column
    supabaseRef.current
      .from('order_status_history')
      .select('old_status, new_status, changed_by, created_at')
      .eq('order_id', order.orderId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setHistory(data ?? [])
        setIsLoadingHistory(false)
      })
  }, [order?.orderId])

  if (!order) return null

  const marginCents = order.retailCents - order.wholesaleCents

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        aria-hidden
        onClick={onClose}
      />

      {/* Drawer panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Order details — ${order.orderId.slice(0, 8)}`}
        className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto bg-card border-l border-border shadow-2xl"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Order</p>
            <h2 className="font-semibold text-foreground font-mono text-sm">{order.orderId}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            ✕
          </button>
        </div>

        <div className="space-y-6 px-5 py-5">

          {/* Order summary */}
          <section className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Prescription</p>
            <p className="font-semibold text-foreground">{order.medicationName}</p>
            <p className="text-sm text-muted-foreground">Patient: {order.patientName}</p>
            {order.submissionTier && (
              <p className="text-sm text-muted-foreground">Dispatch: {order.submissionTier.replace(/_/g, ' ')}</p>
            )}
          </section>

          {/* Financial split — REQ-GDB-002 */}
          <section className="rounded-lg border border-border bg-muted/40 p-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Financial Split</p>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Wholesale cost</span>
                <span className="text-foreground">{toCurrency(order.wholesaleCents)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Patient retail price</span>
                <span className="font-medium text-foreground">{toCurrency(order.retailCents)}</span>
              </div>
              <div className="border-t border-border pt-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Margin</span>
                  <span className="text-foreground">{toCurrency(marginCents)}</span>
                </div>
                <div className="flex justify-between mt-0.5">
                  <span className="text-muted-foreground">Platform fee (15%)</span>
                  <span className="text-muted-foreground">−{toCurrency(order.platformFeeCents)}</span>
                </div>
              </div>
              <div className="border-t border-border pt-1.5 flex justify-between font-semibold">
                <span className="text-foreground">Clinic payout</span>
                <span className="text-emerald-600">{toCurrency(order.clinicPayoutCents)}</span>
              </div>
            </div>
          </section>

          {/* Rx PDF preview placeholder */}
          <section className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rx Document</p>
            <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-center text-sm text-muted-foreground">
              PDF preview available after pharmacy submission
            </div>
          </section>

          {/* Status timeline — REQ-GDB-002 */}
          <section className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status Timeline</p>

            {isLoadingHistory && (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
                ))}
              </div>
            )}

            {!isLoadingHistory && history.length === 0 && (
              <p className="text-sm text-muted-foreground">No status history available.</p>
            )}

            {!isLoadingHistory && history.length > 0 && (
              <ol className="relative border-l border-border space-y-4 pl-4">
                {history.map((row, idx) => (
                  <li key={idx} className="relative">
                    <span className="absolute -left-[1.125rem] top-1 h-3 w-3 rounded-full border-2 border-border bg-background" />
                    {/* NB-3: show transition label using new_status (the status transitioned TO) */}
                    <p className="text-sm font-medium text-foreground">
                      {getStatusConfig(row.new_status).label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      from {getStatusConfig(row.old_status).label}
                      {row.changed_by && ` · ${row.changed_by}`}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDateTime(row.created_at)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>

        </div>
      </aside>
    </>
  )
}
