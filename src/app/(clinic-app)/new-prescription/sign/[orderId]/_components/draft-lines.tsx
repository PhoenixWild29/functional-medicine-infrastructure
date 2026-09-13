'use client'

// ============================================================
// Draft Lines — WO-98
// ============================================================
//
// The draft order detail (provider view) lists every DRAFT line for
// this patient + provider — the line being signed first, then its
// sibling drafts — each with Edit (reopens the existing builder with
// the line's values; the order id is kept) and Remove (soft delete via
// DELETE /api/orders/[id]). "+ Add prescription" opens the builder with
// the draft's patient/provider pinned and appends a new DRAFT line.
//
// No new screen: Edit/Add go through /new-prescription/search and
// /new-prescription/margin like any other line.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { builderHref } from '../../../_lib/edit-target'

export interface DraftLineView {
  orderId:        string
  medicationName: string
  form:           string
  dose:           string
  pharmacyName:   string
  sigText:        string
  retailCents:    number
  daysSupply:     number | null
  refills:        number
}

interface Props {
  anchorOrderId: string
  lines:         DraftLineView[]
}

function toCurrency(cents: number): string {
  return '$' + (cents / 100).toFixed(2)
}

export function DraftLines({ anchorOrderId, lines }: Props) {
  const router = useRouter()
  const [removing, setRemoving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleRemove(orderId: string) {
    setRemoving(orderId)
    setError(null)
    try {
      const res = await fetch(`/api/orders/${orderId}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error ?? 'Failed to remove the line')
      }
      if (orderId === anchorOrderId) {
        // The line this page signs is gone — nothing left to sign here.
        router.push('/dashboard')
        return
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm" data-testid="draft-lines">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Draft lines ({lines.length})
        </p>
        <button
          type="button"
          onClick={() => router.push(builderHref({ kind: 'draft-add', orderId: anchorOrderId }))}
          className="text-xs font-medium text-primary underline hover:text-primary/80"
        >
          + Add prescription
        </button>
      </div>

      <ul className="mt-2 divide-y divide-border">
        {lines.map(line => {
          const isAnchor = line.orderId === anchorOrderId
          return (
            <li key={line.orderId} className="py-3 first:pt-2 last:pb-0" data-testid={`draft-line-${line.orderId}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {line.medicationName}
                    {isAnchor && (
                      <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        signing now
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{line.form} — {line.dose} — {line.pharmacyName}</p>
                  <p className="mt-1 text-xs text-muted-foreground italic">Sig: {line.sigText}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {line.daysSupply != null ? `${line.daysSupply}-day supply · ` : ''}{line.refills} refill{line.refills !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold text-foreground">{toCurrency(line.retailCents)}</p>
                  <div className="mt-1 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => router.push(builderHref({ kind: 'draft', orderId: line.orderId }))}
                      disabled={removing !== null}
                      className="text-[10px] font-medium text-primary underline hover:text-primary/80 disabled:opacity-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(line.orderId)}
                      disabled={removing !== null}
                      className="text-[10px] text-red-500 underline hover:text-red-700 disabled:opacity-50"
                    >
                      {removing === line.orderId ? 'Removing...' : 'Remove'}
                    </button>
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {lines.length > 1 && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Each line is its own draft order and is signed on its own; the other lines stay in the Drafts tab.
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>
      )}
    </div>
  )
}
