'use client'

// ============================================================
// Refill picker — one patient, one or several prescriptions — WO-106
// ============================================================
//
// Selecting several matters: they land as sibling drafts in ONE session,
// so WO-102 charges shipping once per pharmacy instead of once per
// refill. Gina Rooks' email: "you then you pay shipping more than once,
// so would want that built in as well."
//
// Everything the refill decides for the provider — the maintenance dose
// of a finished titration, a package price that moved — comes back from
// /api/orders/refill as a note and is shown on the Review card. Nothing
// is applied silently.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { repriceHref } from '../../new-prescription/_lib/reprice'
import {
  usePrescriptionSession,
  type SessionPatient,
  type SessionProvider,
  type SessionPrescription,
} from '../../new-prescription/_context/prescription-session'

export interface RefillableOrder {
  orderId:        string
  medicationName: string
  dose:           string
  pharmacyId:     string
  pharmacyName:   string
  createdAt:      string
  status:         string
  isTitration:    boolean
  packageLabel:   string | null
  packageCount:   number | null
  refillsUsed:       number
  refillsAuthorized: number
  refillable:     boolean
  blockedReason:  string | null
  /**
   * The provider who prescribed this order, if still active. A clinic
   * admin or MA refills for them. Null when that provider is gone.
   */
  prescriber?:    SessionProvider | null
}

export interface RefillablePatient {
  patient: SessionPatient
  orders:  RefillableOrder[]
}

interface Props {
  patients: RefillablePatient[]
  /** The signed-in provider; null for a clinic admin or MA. */
  provider: SessionProvider | null
  /**
   * WO-106: one order, pre-selected — the drawer's and the table row's
   * Refill land here rather than duplicating the session handling. The
   * provider still sees that patient's other refillable prescriptions,
   * which is how a one-off becomes a multiple when it should be one.
   */
  preselectOrderId?: string | null
}

type RefillLine = Omit<SessionPrescription, 'id'> & { refillOfOrderId: string }

export function RefillPicker({ patients, provider, preselectOrderId = null }: Props) {
  const router = useRouter()
  const session = usePrescriptionSession()

  const preselected = preselectOrderId
    ? patients.find(p => p.orders.some(o => o.orderId === preselectOrderId && o.refillable)) ?? null
    : null

  const [patientId, setPatientId] = useState<string | null>(preselected?.patient.patient_id ?? null)
  const [selected, setSelected] = useState<Set<string>>(
    preselected && preselectOrderId ? new Set([preselectOrderId]) : new Set(),
  )
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const active = patients.find(p => p.patient.patient_id === patientId) ?? null

  function toggle(orderId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  async function startRefill() {
    if (!active || selected.size === 0) return

    // Review starts a session only with a patient AND a provider; without
    // one it sends the user to step 1. A provider login refills as
    // themself. A clinic admin or MA refills for whoever prescribed the
    // orders — one session holds one provider, so they must agree.
    let sessionProvider = provider
    if (!sessionProvider) {
      const chosen = active.orders.filter(o => selected.has(o.orderId))
      const ids = new Set(chosen.map(o => o.prescriber?.provider_id ?? null))
      if (ids.has(null)) {
        setError('The provider who prescribed this is no longer active. Write a new prescription.')
        return
      }
      if (ids.size > 1) {
        setError('These were prescribed by different providers. Refill one provider’s prescriptions at a time.')
        return
      }
      sessionProvider = chosen[0]!.prescriber!
    }

    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/orders/refill', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ orderIds: [...selected] }),
      })
      const json = await res.json() as { lines?: RefillLine[]; error?: string }
      if (!res.ok) {
        setError(json.error ?? 'This prescription could not be refilled.')
        return
      }

      // One session, every line in it: that is what makes WO-102 charge
      // shipping once per pharmacy across the whole refill.
      //
      // Written to storage BEFORE the push. Review mounts under
      // /new-prescription's own session provider, not this page's, and
      // can only see what is in sessionStorage. clearSession + the
      // setters left storage empty at the push and relied on this page's
      // persist effect landing first.
      const created = session.replaceSession({
        patient:       active.patient,
        provider:      sessionProvider,
        prescriptions: json.lines ?? [],
      })

      // WO-108: a line whose wholesale has moved since the source order
      // is priced by the provider, on the price step that already
      // exists, before Review. Lines that did not move go straight
      // through, which is every refill on a stable price.
      const moved = created.find(line => line.repriceRequired === true)
      router.push(moved ? repriceHref(moved) : '/new-prescription/review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This prescription could not be refilled.')
    } finally {
      setIsLoading(false)
    }
  }

  if (patients.length === 0) {
    return (
      <p className="mt-6 rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground" data-testid="refill-empty">
        No patient has a prescription to refill yet. Write one from <strong>+ New Prescription</strong>.
      </p>
    )
  }

  return (
    <div className="mt-6 space-y-5">
      {/* ── Patients with prior orders ─────────────────────── */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <label htmlFor="refill-patient" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Patient
        </label>
        <select
          id="refill-patient"
          data-testid="refill-patient-select"
          value={patientId ?? ''}
          onChange={e => { setPatientId(e.target.value || null); setSelected(new Set()); setError(null) }}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Select a patient…</option>
          {patients.map(p => (
            <option key={p.patient.patient_id} value={p.patient.patient_id}>
              {p.patient.last_name}, {p.patient.first_name} — {p.orders.length} prescription{p.orders.length === 1 ? '' : 's'}
            </option>
          ))}
        </select>
      </div>

      {/* ── That patient's prescriptions ───────────────────── */}
      {active && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm" data-testid="refill-order-list">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Prescriptions to refill
          </p>
          <ul className="mt-2 space-y-2">
            {active.orders.map(order => (
              <li key={order.orderId}>
                <label
                  className={`flex items-start gap-3 rounded-md border p-3 ${
                    order.refillable ? 'border-border hover:bg-accent/40' : 'border-border/60 opacity-60'
                  }`}
                >
                  <input
                    type="checkbox"
                    data-testid={`refill-order-${order.orderId}`}
                    checked={selected.has(order.orderId)}
                    disabled={!order.refillable}
                    onChange={() => toggle(order.orderId)}
                    className="mt-1"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">
                      {order.medicationName}
                      {order.dose && <span className="text-muted-foreground"> · {order.dose}</span>}
                      {order.isTitration && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                          titration
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {order.pharmacyName}
                      {order.packageLabel && ` · ${order.packageCount && order.packageCount > 1 ? `${order.packageCount} × ` : ''}${order.packageLabel}`}
                      {' · '}
                      {order.refillsAuthorized > 0
                        ? `${order.refillsUsed} of ${order.refillsAuthorized} refill${order.refillsAuthorized === 1 ? '' : 's'} used`
                        : 'no refills authorized'}
                    </span>
                    {!order.refillable && order.blockedReason && (
                      <span className="mt-1 block text-xs text-amber-700" data-testid={`refill-blocked-${order.orderId}`}>
                        {order.blockedReason}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-xs text-muted-foreground">
            Refilling several at once keeps them on one order, so shipping is charged once per pharmacy.
          </p>

          {error && (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert" data-testid="refill-error">
              {error}
            </p>
          )}

          <button
            type="button"
            data-testid="refill-start"
            disabled={selected.size === 0 || isLoading}
            onClick={() => void startRefill()}
            className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {isLoading
              ? 'Preparing…'
              : `Refill ${selected.size || ''} prescription${selected.size === 1 ? '' : 's'}`.replace('  ', ' ')}
          </button>
        </div>
      )}
    </div>
  )
}
