'use client'

// ============================================================
// Pharmacy payables board — /ops/payables
// ============================================================
//
// Per pharmacy: what is owed, scheduled and paid (net of refunds reversed
// against unpaid lines), the per-order lines, marking selected lines
// scheduled or paid (reference + date), and the remittance CSV for a date
// range. Marking paid records a payment made outside this system; nothing
// here moves money. IDs and amounts only.

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCents, type PayablesView, type PharmacyPayables, type PayableLine } from '@/lib/payments/payables'

const BUTTON =
  'rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 dark:bg-primary-hover dark:hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const SECONDARY =
  'rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const INPUT =
  'rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const STATUS_LABEL: Record<PayableLine['status'], string> = { owed: 'Owed', scheduled: 'Scheduled', paid: 'Paid', void: 'Void' }

export function PayablesBoard({ view, defaultRange }: { view: PayablesView; defaultRange?: { from: string; to: string } }) {
  if (view.pharmacies.length === 0) {
    return <p className="text-sm text-muted-foreground">No pharmacy payables yet. A payable is recorded when an order is paid.</p>
  }
  return (
    <div className="space-y-8">
      {view.pharmacies.map(p => <PharmacySection key={p.pharmacyId} pharmacy={p} defaultRange={defaultRange} />)}
    </div>
  )
}

function PharmacySection({ pharmacy, defaultRange }: { pharmacy: PharmacyPayables; defaultRange?: { from: string; to: string } | undefined }) {
  const router = useRouter()
  const id = useId()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [reference, setReference] = useState('')
  const [paidOn, setPaidOn] = useState('')
  const [from, setFrom] = useState(defaultRange?.from ?? '')
  const [to, setTo] = useState(defaultRange?.to ?? '')
  const [basis, setBasis] = useState<'paid' | 'accrued'>('paid')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const open = pharmacy.lines.filter(l => l.status === 'owed' || l.status === 'scheduled')
  const selectedLines = open.filter(l => selected.has(l.payableId))
  const canPay = selectedLines.length > 0 && reference.trim().length > 0 && paidOn.length > 0 && !busy
  const canSchedule = selectedLines.some(l => l.status === 'owed') && !busy

  function toggle(payableId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(payableId)) next.delete(payableId)
      else next.add(payableId)
      return next
    })
  }

  async function mark(action: 'mark_paid' | 'mark_scheduled') {
    setBusy(true)
    setMessage(null)
    const body = action === 'mark_paid'
      ? { payableIds: selectedLines.map(l => l.payableId), action, reference: reference.trim(), paidOn }
      : { payableIds: selectedLines.filter(l => l.status === 'owed').map(l => l.payableId), action }
    try {
      const res = await fetch('/api/ops/payables/mark', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json().catch(() => ({}))) as { updated?: number; error?: string }
      if (!res.ok) {
        setMessage({ kind: 'error', text: json.error ?? 'The payables could not be updated.' })
      } else {
        setMessage({ kind: 'ok', text: `${json.updated ?? 0} line(s) ${action === 'mark_paid' ? 'marked paid' : 'scheduled'}.` })
        setSelected(new Set())
        setReference('')
        router.refresh()
      }
    } catch {
      setMessage({ kind: 'error', text: 'The payables could not be updated. Check your connection and try again.' })
    } finally {
      setBusy(false)
    }
  }

  const rangeOk = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to
  const csvHref = `/api/ops/payables/remittance?pharmacyId=${encodeURIComponent(pharmacy.pharmacyId)}&from=${from}&to=${to}&basis=${basis}`

  return (
    <section aria-labelledby={`${id}-name`} className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 id={`${id}-name`} className="text-lg font-semibold text-foreground">{pharmacy.name}</h2>
        <dl className="flex gap-6 text-sm">
          <div><dt className="text-muted-foreground">Owed</dt><dd className="font-semibold text-foreground" data-total="owed">{formatCents(pharmacy.owedCents)}</dd></div>
          <div><dt className="text-muted-foreground">Scheduled</dt><dd className="font-semibold text-foreground" data-total="scheduled">{formatCents(pharmacy.scheduledCents)}</dd></div>
          <div><dt className="text-muted-foreground">Paid</dt><dd className="font-semibold text-foreground" data-total="paid">{formatCents(pharmacy.paidCents)}</dd></div>
        </dl>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Payables for {pharmacy.name}</caption>
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th scope="col" className="py-2 pr-3"><span className="sr-only">Select</span></th>
              <th scope="col" className="py-2 pr-3">Order</th>
              <th scope="col" className="py-2 pr-3">Status</th>
              <th scope="col" className="py-2 pr-3 text-right">Wholesale</th>
              <th scope="col" className="py-2 pr-3 text-right">Shipping</th>
              <th scope="col" className="py-2 pr-3 text-right">Reversed</th>
              <th scope="col" className="py-2 pr-3 text-right">Net</th>
              <th scope="col" className="py-2 pr-3">Paid on</th>
              <th scope="col" className="py-2">Reference</th>
            </tr>
          </thead>
          <tbody>
            {pharmacy.lines.map(l => {
              const label = l.orderNumber ?? l.orderId
              const selectable = l.status === 'owed' || l.status === 'scheduled'
              return (
                <tr key={l.payableId} className="border-b border-border last:border-0 text-foreground">
                  <td className="py-2 pr-3">
                    {selectable && (
                      <input type="checkbox" aria-label={`Select ${label}`} checked={selected.has(l.payableId)} onChange={() => toggle(l.payableId)} />
                    )}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">{label}</td>
                  <td className="py-2 pr-3">{STATUS_LABEL[l.status]}</td>
                  <td className="py-2 pr-3 text-right">{formatCents(l.wholesaleCents)}</td>
                  <td className="py-2 pr-3 text-right">{formatCents(l.shippingCents)}</td>
                  <td className="py-2 pr-3 text-right">{l.reversedCents > 0 ? formatCents(l.reversedCents) : ''}</td>
                  <td className="py-2 pr-3 text-right font-medium">{formatCents(l.netCents)}</td>
                  <td className="py-2 pr-3">{l.paidOn ?? ''}</td>
                  <td className="py-2 font-mono text-xs">{l.paidReference ?? ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {open.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-ref`} className="text-xs text-muted-foreground">Payment reference</label>
            <input id={`${id}-ref`} className={INPUT} value={reference} maxLength={120} onChange={e => setReference(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-paid-on`} className="text-xs text-muted-foreground">Paid on</label>
            <input id={`${id}-paid-on`} type="date" className={INPUT} value={paidOn} onChange={e => setPaidOn(e.target.value)} />
          </div>
          <button type="button" className={BUTTON} disabled={!canPay} onClick={() => mark('mark_paid')}>Mark paid</button>
          <button type="button" className={SECONDARY} disabled={!canSchedule} onClick={() => mark('mark_scheduled')}>Mark scheduled</button>
        </div>
      )}
      <div role="status" aria-live="polite" className="text-sm">
        {message && <span className={message.kind === 'error' ? 'text-destructive' : 'text-foreground'}>{message.text}</span>}
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-from`} className="text-xs text-muted-foreground">From</label>
          <input id={`${id}-from`} type="date" className={INPUT} value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-to`} className="text-xs text-muted-foreground">To</label>
          <input id={`${id}-to`} type="date" className={INPUT} value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-basis`} className="text-xs text-muted-foreground">Lines</label>
          <select id={`${id}-basis`} className={INPUT} value={basis} onChange={e => setBasis(e.target.value === 'accrued' ? 'accrued' : 'paid')}>
            <option value="paid">Paid in the range</option>
            <option value="accrued">Accrued in the range</option>
          </select>
        </div>
        {rangeOk ? (
          <a href={csvHref} className={SECONDARY} download>Download remittance CSV</a>
        ) : (
          <span className="text-xs text-muted-foreground">Choose a date range to download the remittance CSV.</span>
        )}
      </div>
    </section>
  )
}
