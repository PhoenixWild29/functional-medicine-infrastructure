'use client'

// ============================================================
// Order Detail Drawer — WO-31
// ============================================================
//
// REQ-GDB-002: Slide-out drawer showing:
//   - Financial split (wholesale, retail, shipping, platform fee, clinic
//     payout, patient total) — shipping is the order's stored snapshot, so
//     the record reconciles with what checkout charges
//   - Rx details (read-only; the WO-96 columns the order stores, with the
//     Review card's labels)
//   - Full status timeline (from order_status_history)
//   - Tracking info (status-based summary)
//
// Rx PDF preview and adapter submission log are displayed
// as placeholders — full implementation follows pharmacy
// adapter work orders (out of scope for WO-31).

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'
import type { DashboardOrder } from '../page'
import { getStatusConfig } from '@/lib/orders/status-config'
import { notify } from '@/lib/notifications'
import { draftEditMode, type DraftViewer } from '@/lib/orders/draft-edit-access'
import { actorDisplayName, type TimelineActor } from '@/lib/orders/timeline-actors'
import {
  formatDiagnosis,
  formatDispenseWithPackage,
  shippingTypeLabel,
  syringeOptionLabel,
} from '@/lib/orders/rx-details'
import { computeBundleShipping, type PharmacyShippingRates } from '@/lib/orders/shipping'
import type { OrderRecord } from '@/app/api/orders/[orderId]/record/route'

interface Props {
  order: DashboardOrder | null
  onClose: () => void
  /** QA post-combine fix: notify the parent that these orders joined a
   *  payment group so it patches the polling cache immediately (drawer
   *  block + list rows) instead of waiting for the 30s poll. */
  onGroupCreated: (groupId: string, orderIds: string[]) => void
  /** WO-98 × WO-100: the signed-in viewer. Absent → WO-98 behaviour. */
  viewer?: DraftViewer | undefined
}

interface BundlableSibling {
  orderId:        string
  medicationName: string
  retailPrice:    number | null
  createdAt:      string
  // Shipping inputs for the bundle preview (once per pharmacy). Optional so
  // responses without them still render.
  pharmacyId?:     string | null
  shippingType?:   string | null
  wholesalePrice?: number | null
}
interface BundlableState {
  anchorBundlable: boolean
  anchor?: BundlableSibling
  siblings: BundlableSibling[]
  reason?:  string
  featureDisabled?: boolean
}

// R10 fix — bundle-link recovery: shape of GET /api/orders/[orderId]/group-link
interface GroupLinkInfo {
  checkoutUrl: string
  orderCount:  number
  totalCents:  number
}

// NB-3: order_status_history uses old_status/new_status (not "status") per trigger schema
interface StatusHistoryRow {
  old_status: string
  new_status: string
  changed_by: string | null
  created_at: string
  // WO-98: draft edits/removals are DRAFT → DRAFT rows carrying
  // { event, actor, diff } — rendered as their own timeline entries.
  metadata?:  { event?: string; diff?: Record<string, unknown> } | null
}

const DRAFT_EVENT_LABEL: Record<string, string> = {
  draft_created:      'Draft created',
  draft_edited:       'Draft edited',
  draft_line_removed: 'Draft line removed',
}

const DIFF_FIELD_LABEL: Record<string, string> = {
  'medication_snapshot.prescribed_dose':  'dose',
  'medication_snapshot.frequency_code':   'frequency',
  'medication_snapshot.quantity_label':   'quantity',
  'medication_snapshot.medication_name':  'medication',
  'pharmacy_snapshot.name':               'pharmacy',
  retail_price_snapshot:                  'retail price',
  wholesale_price_snapshot:               'wholesale',
  sig_text:                               'sig',
  days_supply:                            'days supply',
  dispense_quantity:                      'dispense',
  dispense_unit:                          'dispense unit',
  package_id:                             'package',
  package_label:                          'package',
  package_count:                          'package count',
  refills:                                'refills',
  substitution_allowed:                   'substitution',
  syringe_option:                         'syringe option',
  shipping_type:                          'shipping',
  clinical_difference:                    'clinical difference',
  diagnosis_code:                         'diagnosis code',
  diagnosis_text:                         'diagnosis',
  special_instructions:                   'special instructions',
}

function describeDiff(diff: Record<string, unknown> | undefined): string {
  const keys = Object.keys(diff ?? {})
    .filter(k => k !== 'formulation_id' && k !== 'catalog_item_id' && k !== 'pharmacy_id')
    .map(k => DIFF_FIELD_LABEL[k] ?? k)
  return keys.length ? `changed ${keys.join(', ')}` : 'no field changes'
}

/** "Shipping — Strive Pharmacy (cold chain)", as the Review card labels it. */
function shippingLabel(pharmacyName: string | null | undefined, shippingType: string | null | undefined): string {
  const type = shippingType === 'cold_chain' ? 'cold chain' : 'standard'
  return `Shipping — ${pharmacyName || 'pharmacy'} (${type})`
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


export function OrderDrawer({ order, onClose, onGroupCreated, viewer }: Props) {
  const router = useRouter()
  // BLK-03: stable ref prevents stale closure + avoids re-running effect when client recreated
  const supabaseRef = useRef(createBrowserClient())

  const [history,           setHistory]           = useState<StatusHistoryRow[]>([])
  // The order's stored shipping + Rx details (GET /api/orders/[id]/record).
  const [record,            setRecord]            = useState<OrderRecord | null>(null)
  // Shipping rates + absorb setting for the Combine preview.
  const [bundleRates,       setBundleRates]       = useState<{ rates: PharmacyShippingRates[]; absorbShipping: boolean } | null>(null)
  const [isLoadingHistory,  setIsLoadingHistory]  = useState(false)
  // Timeline actor names (auth user id → provider / staff name). Until
  // they resolve — or when a user is outside the clinic — the id shows.
  const [actors,            setActors]            = useState<Record<string, TimelineActor>>({})

  // Copy Payment Link state (AWAITING_PAYMENT + PAYMENT_EXPIRED)
  const [isGeneratingLink,  setIsGeneratingLink]  = useState(false)
  const [fallbackUrl,       setFallbackUrl]       = useState<string | null>(null)

  // Phase C Stage 4 — Combine and Send state
  const [isLoadingSiblings,    setIsLoadingSiblings]    = useState(false)
  const [bundlable,            setBundlable]            = useState<BundlableState | null>(null)
  const [selectedSiblings,     setSelectedSiblings]     = useState<Set<string>>(new Set())
  const [isCreatingGroup,      setIsCreatingGroup]      = useState(false)
  const [groupFallbackUrl,     setGroupFallbackUrl]     = useState<string | null>(null)

  // R10 fix — bundle-link recovery state (orders already in a payment group)
  const [groupInfo,            setGroupInfo]            = useState<GroupLinkInfo | null>(null)
  const [isLoadingGroupInfo,   setIsLoadingGroupInfo]   = useState(false)
  const [isCopyingGroupLink,   setIsCopyingGroupLink]   = useState(false)

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
      .select('old_status, new_status, changed_by, created_at, metadata')
      .eq('order_id', order.orderId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        const rows = (data ?? []) as StatusHistoryRow[]
        setHistory(rows)
        setIsLoadingHistory(false)
        setActors({})
        if (!rows.some(r => r.changed_by)) return
        fetch(`/api/orders/${order.orderId}/timeline-actors`)
          .then(res => (res.ok ? res.json() : null))
          .then((json: { actors?: Record<string, TimelineActor> } | null) => {
            if (json?.actors) setActors(json.actors)
          })
          .catch(() => { /* non-fatal: ids stay visible */ })
      })
  }, [order?.orderId])

  // Load the order's stored shipping + Rx details whenever the drawer opens
  // on an order. Non-fatal: the split and details fall back to what the
  // dashboard row carries.
  const recordOrderId = order?.orderId ?? null
  useEffect(() => {
    setRecord(null)
    if (!recordOrderId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/orders/${recordOrderId}/record`, { headers: { Accept: 'application/json' } })
        if (!res?.ok) return
        const json = await res.json() as Partial<OrderRecord> | null
        // Only a complete record replaces the fallback split.
        if (!cancelled && json?.shipping && json.rxDetails) setRecord(json as OrderRecord)
      } catch {
        /* non-fatal: the drawer still shows the dashboard row's split */
      }
    })()
    return () => { cancelled = true }
  }, [recordOrderId])

  // Reset Combine and Send state whenever the drawer's anchor order changes,
  // then proactively probe bundlable-siblings. We discover on open (not on
  // click) so the picker only renders when the feature flag is on AND
  // siblings actually exist (Codex 2026-06-11 sweep [LOW]).
  //
  // R10 fix: an order that is ALREADY in a payment group can never re-bundle
  // — for those we fetch the group checkout link instead (display + recovery
  // copy), skipping the sibling probe entirely.
  //
  // Deps array is intentionally [order?.orderId] only:
  //   - The body reads `order` (the optional check) and `order.status`, but
  //     both are derived from the same anchor row — changes to other fields
  //     don't warrant refetching the bundlable-siblings list.
  //   - fetchBundlableSiblings is a stable closure that only depends on the
  //     anchor orderId via the outer `order` capture. Same orderId → same
  //     closure semantics, so the stale-read concern doesn't apply here.
  // The disable comment sits on the deps-array line so eslint applies it to
  // the actual exhaustive-deps warning location (Codex round 2 [LOW]).
  useEffect(() => {
    setBundlable(null)
    setSelectedSiblings(new Set())
    setGroupFallbackUrl(null)
    setGroupInfo(null)
    if (!order) return
    if (order.status !== 'AWAITING_PAYMENT') return
    if (order.paymentGroupId) {
      void fetchGroupLink()
    } else {
      void fetchBundlableSiblings()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.orderId])

  async function fetchBundlableSiblings() {
    if (!order || isLoadingSiblings) return

    setIsLoadingSiblings(true)
    try {
      const res = await fetch(`/api/orders/${order.orderId}/bundlable-siblings`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      })

      if (res.status === 503) {
        setBundlable({ anchorBundlable: false, siblings: [], featureDisabled: true })
        return
      }

      if (!res.ok) {
        notify.error('Could not check for bundlable prescriptions', `HTTP ${res.status}`)
        setBundlable({ anchorBundlable: false, siblings: [] })
        return
      }

      const data = await res.json() as BundlableState
      setBundlable(data)
      // Pre-select all siblings — typical action is "bundle all outstanding".
      setSelectedSiblings(new Set(data.siblings.map(s => s.orderId)))
      // Shipping rates for the preview (once per pharmacy across the bundle).
      const pharmacyIds = [...new Set([data.anchor, ...data.siblings].map(s => s?.pharmacyId).filter((id): id is string => !!id))]
      setBundleRates(null)
      if (data.anchorBundlable && data.siblings.length > 0 && pharmacyIds.length > 0) {
        try {
          const ratesRes = await fetch(`/api/pharmacies/shipping?ids=${encodeURIComponent(pharmacyIds.join(','))}`)
          const ratesJson = ratesRes?.ok ? await ratesRes.json() as { rates?: PharmacyShippingRates[]; absorbShipping?: boolean } : null
          if (Array.isArray(ratesJson?.rates)) setBundleRates({ rates: ratesJson.rates, absorbShipping: ratesJson.absorbShipping === true })
        } catch {
          /* non-fatal: the preview shows the prescriptions subtotal */
        }
      }
    } catch (err) {
      notify.error(
        'Could not check for bundlable prescriptions',
        err instanceof Error ? err.message : 'Unexpected error',
      )
      setBundlable({ anchorBundlable: false, siblings: [] })
    } finally {
      setIsLoadingSiblings(false)
    }
  }

  // R10 fix — bundle-link recovery. GET the group checkout link for an order
  // that is already part of a payment group. Side-effect free on the server
  // (stateless JWT re-mint — no SMS, no Stripe, no DB writes), so it's safe
  // to call on every drawer open AND again from the copy button.
  async function fetchGroupLink(): Promise<GroupLinkInfo | null> {
    if (!order) return null

    setIsLoadingGroupInfo(true)
    try {
      const res = await fetch(`/api/orders/${order.orderId}/group-link`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        const detail = body.error ?? `HTTP ${res.status}`
        if (res.status === 503) {
          notify.error('Feature disabled', 'Multi-prescription groups are not yet enabled')
        } else {
          notify.error('Could not load bundle payment link', detail)
        }
        return null
      }

      const data = await res.json() as { checkoutUrl: string; orderCount: number; totalCents: number }
      const info: GroupLinkInfo = {
        checkoutUrl: data.checkoutUrl,
        orderCount:  data.orderCount,
        totalCents:  data.totalCents,
      }
      setGroupInfo(info)
      return info
    } catch (err) {
      notify.error(
        'Could not load bundle payment link',
        err instanceof Error ? err.message : 'Unexpected error',
      )
      return null
    } finally {
      setIsLoadingGroupInfo(false)
    }
  }

  async function handleCopyBundleLink() {
    if (!order || isCopyingGroupLink) return

    setIsCopyingGroupLink(true)
    setGroupFallbackUrl(null)
    try {
      // Use the link fetched on drawer open; re-fetch if that load failed.
      const info = groupInfo ?? await fetchGroupLink()
      if (!info) return // fetchGroupLink already notified

      try {
        await navigator.clipboard.writeText(info.checkoutUrl)
        notify.success(`Bundle link copied · ${info.orderCount} prescription${info.orderCount === 1 ? '' : 's'} · ${toCurrency(info.totalCents)}`)
      } catch {
        // Same clipboard-failure fallback as the combine flow.
        setGroupFallbackUrl(info.checkoutUrl)
      }
    } finally {
      setIsCopyingGroupLink(false)
    }
  }

  function toggleSibling(orderId: string) {
    setSelectedSiblings(prev => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else                   next.add(orderId)
      return next
    })
  }

  async function handleCombineAndSend() {
    if (!order || isCreatingGroup || selectedSiblings.size === 0) return

    setIsCreatingGroup(true)
    setGroupFallbackUrl(null)

    try {
      const res = await fetch(`/api/orders/${order.orderId}/group-and-send`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ siblingOrderIds: Array.from(selectedSiblings) }),
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        const detail = body.error ?? `HTTP ${res.status}`
        if (res.status === 409) {
          notify.error('Orders changed', 'Refresh the dashboard and try again')
        } else if (res.status === 403) {
          notify.error('Not permitted', detail)
        } else if (res.status === 503) {
          notify.error('Feature disabled', 'Multi-prescription groups are not yet enabled')
        } else {
          notify.error('Failed to create group payment link', detail)
        }
        return
      }

      const { checkoutUrl, orderCount, totalCents, groupId } = (await res.json()) as {
        checkoutUrl: string; orderCount: number; totalCents: number; groupId: string
      }

      // R10 fix: keep the bundle link around so the new "Copy Bundle Payment
      // Link" block can re-copy it without a refetch — the success toast is
      // no longer the only holder of the link.
      setGroupInfo({ checkoutUrl, orderCount, totalCents })

      // QA post-combine fix: the group now exists server-side regardless of
      // what the clipboard write below does, so patch the dashboard cache
      // NOW. The parent sets paymentGroupId on the anchor + every selected
      // sibling, which flips this drawer from the solo "Copy Payment Link"
      // block (dead for grouped orders — server 409s it) to the bundle
      // block, and updates the list rows — no 30s poll wait.
      onGroupCreated(groupId, [order.orderId, ...Array.from(selectedSiblings)])

      try {
        await navigator.clipboard.writeText(checkoutUrl)
        notify.success(`Bundle link copied · ${orderCount} prescriptions · ${toCurrency(totalCents)}`)
        // Refresh the dashboard so the bundled rows reflect their new
        // payment_group_id (the row colors/filters can update).
        router.refresh()
        // Hide the picker — the orders are now grouped and can't be re-bundled.
        setBundlable(null)
        setSelectedSiblings(new Set())
      } catch {
        setGroupFallbackUrl(checkoutUrl)
      }
    } catch (err) {
      notify.error(
        'Failed to create group payment link',
        err instanceof Error ? err.message : 'Unexpected error',
      )
    } finally {
      setIsCreatingGroup(false)
    }
  }

  async function handleCopyPaymentLink() {
    if (!order || isGeneratingLink) return

    setIsGeneratingLink(true)
    setFallbackUrl(null)

    try {
      const res = await fetch(`/api/orders/${order.orderId}/checkout-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        const detail = body.error ?? `HTTP ${res.status}`
        if (res.status === 422) {
          notify.error('Cannot copy link', detail)
        } else if (res.status === 403) {
          notify.error('Not permitted', detail)
        } else if (res.status === 404) {
          notify.error('Order not found', 'Refresh the dashboard and try again')
        } else {
          notify.error('Failed to generate link', detail)
        }
        return
      }

      const { checkoutUrl } = (await res.json()) as { checkoutUrl: string; expiresAt: string }

      try {
        await navigator.clipboard.writeText(checkoutUrl)
        notify.success('Payment link copied · valid for 72 hours')
      } catch {
        // Clipboard API can fail silently when the tab lacks focus (common
        // during screenshare), or in restricted iframe contexts. Fall back
        // to a modal that displays the URL for manual select-and-copy.
        setFallbackUrl(checkoutUrl)
      }
    } catch (err) {
      notify.error(
        'Failed to generate link',
        err instanceof Error ? err.message : 'An unexpected error occurred'
      )
    } finally {
      setIsGeneratingLink(false)
    }
  }

  if (!order) return null

  const marginCents = order.retailCents - order.wholesaleCents
  // The order's stored shipping (what checkout adds via stripeSplit). When
  // the clinic absorbs it, the patient total excludes it and the clinic
  // payout carries it.
  const shippingCents = record?.shipping.feeCents ?? 0
  const shippingAbsorbed = record?.shipping.absorbed === true
  const patientTotalCents = order.retailCents + (shippingAbsorbed ? 0 : shippingCents)
  const clinicPayoutCents = order.clinicPayoutCents - (shippingAbsorbed ? shippingCents : 0)
  const rx = record?.rxDetails ?? null
  const canIssuePaymentLink =
    order.status === 'AWAITING_PAYMENT' || order.status === 'PAYMENT_EXPIRED'
  const isExpired = order.status === 'PAYMENT_EXPIRED'

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
        className="fixed inset-y-0 right-0 z-50 w-full md:max-w-md overflow-y-auto bg-card border-l border-border shadow-2xl"
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

          {/* R10 fix — bundle-link recovery. Once an order is combined into a
              payment group the solo link is rejected server-side (anti-double-
              pay guard in /api/checkout/payment-intent), so the drawer must
              offer the GROUP checkout link instead. Previously the one-time
              "Bundle link copied" toast was the only way to ever obtain it. */}
          {canIssuePaymentLink && order.paymentGroupId && (
            <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-800">Part of a Payment Bundle</p>
              <p className="mt-1 text-xs text-emerald-700">
                {groupInfo
                  ? `${groupInfo.orderCount} prescription${groupInfo.orderCount === 1 ? '' : 's'} · ${toCurrency(groupInfo.totalCents)} — the patient pays once for all bundled items.`
                  : isLoadingGroupInfo
                    ? 'Loading bundle details…'
                    : 'The patient pays once for all bundled prescriptions.'}
              </p>
              <button
                type="button"
                onClick={handleCopyBundleLink}
                disabled={isCopyingGroupLink || isLoadingGroupInfo}
                className="mt-3 w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              >
                {isCopyingGroupLink ? 'Copying…' : 'Copy Bundle Payment Link'}
              </button>
            </div>
          )}

          {/* Copy Payment Link CTA — AWAITING_PAYMENT or PAYMENT_EXPIRED.
              R10 fix: only for orders NOT in a payment group — the solo link
              is dead for grouped orders (server rejects it with 409). */}
          {canIssuePaymentLink && !order.paymentGroupId && (
            <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-800">
                {isExpired ? 'Payment Link Expired' : 'Ready for Patient Payment'}
              </p>
              <p className="mt-1 text-xs text-emerald-700">
                {isExpired
                  ? 'The original link has expired. Regenerate a new payment link and send it to the patient.'
                  : 'The patient\'s original link has been sent via SMS. Use this only if they need another copy or if the link has expired.'}
              </p>
              <button
                type="button"
                onClick={handleCopyPaymentLink}
                disabled={isGeneratingLink}
                className="mt-3 w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              >
                {isGeneratingLink
                  ? 'Generating...'
                  : isExpired
                    ? 'Regenerate Payment Link'
                    : 'Copy Payment Link'}
              </button>

              {/* Phase C Stage 4 — Combine and Send (multi-Rx bundle).
                  Codex 2026-06-11 sweep [LOW]: discover runs on drawer open;
                  the picker only renders when the feature is on AND siblings
                  exist. No speculative button. */}
              {bundlable && !bundlable.featureDisabled && bundlable.anchorBundlable && bundlable.siblings.length > 0 && (
                <div className="mt-3 rounded-md border border-emerald-300 bg-white p-3">
                  <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">
                    Combine into one payment link
                  </p>
                  <p className="mt-1 text-xs text-emerald-700">
                    Select prescriptions to bundle with this one. The patient pays once for all selected items.
                  </p>
                  <ul className="mt-3 space-y-2">
                    {bundlable.siblings.map(s => {
                      const checked = selectedSiblings.has(s.orderId)
                      return (
                        <li key={s.orderId}>
                          <label className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSibling(s.orderId)}
                              className="mt-0.5 rounded border-emerald-400 text-emerald-600 focus-visible:ring-emerald-600"
                            />
                            <span className="flex-1 text-sm text-foreground">
                              <span className="block font-medium">{s.medicationName}</span>
                              <span className="block text-xs text-muted-foreground">
                                {s.retailPrice !== null
                                  ? `$${s.retailPrice.toFixed(2)}`
                                  : '—'}
                              </span>
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>

                  {(() => {
                    const anchorCents = order.retailCents
                    const selected = bundlable.siblings.filter(s => selectedSiblings.has(s.orderId))
                    const sumSelectedCents = selected
                      .reduce((acc, s) => acc + Math.round((s.retailPrice ?? 0) * 100), 0)
                    const subtotalCents = anchorCents + sumSelectedCents
                    const totalCount = 1 + selectedSiblings.size
                    // Shipping as group checkout charges it: once per pharmacy
                    // across the selected orders (create-group.ts).
                    const members = [bundlable.anchor, ...selected].filter((s): s is BundlableSibling => !!s && !!s.pharmacyId)
                    const shipping = bundleRates
                      ? computeBundleShipping(
                          members.map(s => ({
                            pharmacyId:     s.pharmacyId!,
                            shippingType:   s.shippingType ?? null,
                            wholesaleCents: Math.round((s.wholesalePrice ?? 0) * 100),
                          })),
                          bundleRates.rates,
                        )
                      : null
                    const absorbed = bundleRates?.absorbShipping === true
                    const totalCents = subtotalCents + (shipping && !absorbed ? shipping.totalCents : 0)
                    return (
                      <div className="mt-3 space-y-1 border-t border-emerald-200 pt-2 text-sm" data-testid="bundle-preview">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            {totalCount} prescription{totalCount === 1 ? '' : 's'}
                          </span>
                          <span className="text-foreground" data-testid="bundle-subtotal">{toCurrency(subtotalCents)}</span>
                        </div>
                        {shipping?.byPharmacy.map(p => (
                          <div key={p.pharmacyId} className="flex items-center justify-between text-xs text-muted-foreground" data-testid={`bundle-shipping-${p.pharmacyId}`}>
                            <span>{shippingLabel(p.pharmacyName, p.shippingType)}</span>
                            <span>{toCurrency(p.feeCents)}</span>
                          </div>
                        ))}
                        {absorbed && shipping && shipping.totalCents > 0 && (
                          <p className="text-[10px] text-muted-foreground">Shipping is absorbed by the clinic — not charged to the patient.</p>
                        )}
                        <div className="flex items-center justify-between font-semibold">
                          <span className="text-foreground">Patient total</span>
                          <span className="text-foreground" data-testid="bundle-total">{toCurrency(totalCents)}</span>
                        </div>
                      </div>
                    )
                  })()}

                  <button
                    type="button"
                    onClick={handleCombineAndSend}
                    disabled={isCreatingGroup || selectedSiblings.size === 0}
                    className="mt-3 w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                  >
                    {isCreatingGroup ? 'Creating bundle…' : 'Combine and Copy Payment Link'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setBundlable(null); setSelectedSiblings(new Set()) }}
                    className="mt-2 w-full rounded-md border border-emerald-300 bg-white px-4 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Clipboard-failure fallback for the GROUP link */}
          {groupFallbackUrl && (
            <div
              role="dialog"
              aria-label="Bundle payment link (copy manually)"
              className="rounded-lg border-2 border-emerald-400 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-emerald-800">Copy the bundle link manually</p>
                <button
                  type="button"
                  onClick={() => setGroupFallbackUrl(null)}
                  aria-label="Dismiss"
                  className="rounded p-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  ✕
                </button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Auto-copy to clipboard failed. Select the URL below and copy with Cmd/Ctrl+C.
              </p>
              <textarea
                readOnly
                value={groupFallbackUrl}
                onFocus={(e) => e.currentTarget.select()}
                rows={3}
                className="mt-2 w-full rounded-md border border-border bg-background p-2 text-xs font-mono text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              />
            </div>
          )}

          {/* Clipboard-failure fallback: show URL so the operator can manually select + copy */}
          {fallbackUrl && (
            <div
              role="dialog"
              aria-label="Payment link (copy manually)"
              className="rounded-lg border-2 border-emerald-400 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-emerald-800">Copy the link manually</p>
                <button
                  type="button"
                  onClick={() => setFallbackUrl(null)}
                  aria-label="Dismiss"
                  className="rounded p-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  ✕
                </button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Auto-copy to clipboard failed. Select the URL below and copy with Cmd/Ctrl+C.
              </p>
              <textarea
                readOnly
                value={fallbackUrl}
                onFocus={(e) => e.currentTarget.select()}
                rows={3}
                className="mt-2 w-full rounded-md border border-border bg-background p-2 text-xs font-mono text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              />
            </div>
          )}

          {/* WO-106: Refill. Gina Rooks, 2026-09-11 (00:32:29):
              "like reordering, you want it to be as fast as possible,
              you know, not re-entering it every time."
              A draft is not refillable — it has not been filled. The
              picker is where the refill is assembled, so that one place
              owns the session, the authorization check, the maintenance
              dose of a finished titration and the re-priced package;
              it opens with this order selected and shows the patient's
              other refillable prescriptions beside it, which is how a
              one-off becomes a multiple and shipping stays one charge. */}
          {order.status !== 'DRAFT' && (
            <button
              type="button"
              data-testid="drawer-refill"
              onClick={() => {
                onClose()
                router.push(`/refill?order=${encodeURIComponent(order.orderId)}`)
              }}
              className="w-full rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Refill this prescription
            </button>
          )}

          {/* WO-77: Review & Sign CTA for DRAFT orders */}
          {order.status === 'DRAFT' && (
            <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-800">Awaiting Provider Signature</p>
              <p className="mt-1 text-xs text-amber-700">
                This prescription was saved as a draft. A provider needs to review and sign before the payment link is sent to the patient.
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose()
                  router.push(`/new-prescription/sign/${order.orderId}`)
                }}
                className="mt-3 w-full rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
              >
                Review & Sign This Prescription
              </button>
              {/* WO-98: edit this draft line / add another line to the
                  draft — both reopen the existing builder with the
                  draft's patient and provider pinned. Other roles only
                  edit drafts they created (the server returns 403
                  otherwise).
                  WO-100: a provider looking at ANOTHER provider's draft
                  must take it over first, so both actions collapse into
                  one "Sign as me to edit" that opens the Sign as me
                  panel (the sign page renders it for exactly this case). */}
              {draftEditMode(viewer, order.providerId) === 'sign-as-me' ? (
                <button
                  type="button"
                  data-testid="drawer-sign-as-me-to-edit"
                  onClick={() => {
                    onClose()
                    router.push(`/new-prescription/sign/${order.orderId}`)
                  }}
                  className="mt-2 w-full rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
                >
                  Sign as me to edit
                </button>
              ) : (
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    router.push(`/new-prescription/search?editOrder=${order.orderId}`)
                  }}
                  className="flex-1 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
                >
                  Edit prescription
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    router.push(`/new-prescription/search?addToOrder=${order.orderId}`)
                  }}
                  className="flex-1 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
                >
                  + Add prescription
                </button>
              </div>
              )}
            </div>
          )}

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
              {record && (
                <div className="flex justify-between" data-testid="drawer-shipping">
                  <span className="text-muted-foreground">{shippingLabel(record.shipping.pharmacyName, record.shipping.shippingType)}</span>
                  <span className="text-foreground">{toCurrency(shippingCents)}</span>
                </div>
              )}
              {record && shippingAbsorbed && shippingCents > 0 && (
                <p className="text-[11px] text-muted-foreground" data-testid="drawer-shipping-absorbed">
                  Shipping is absorbed by the clinic — not charged to the patient.
                </p>
              )}
              {record && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Patient total</span>
                  <span className="font-medium text-foreground" data-testid="drawer-patient-total">{toCurrency(patientTotalCents)}</span>
                </div>
              )}
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
                <span className="text-emerald-600" data-testid="drawer-clinic-payout">{toCurrency(clinicPayoutCents)}</span>
              </div>
            </div>
          </section>

          {/* Rx details — read-only, the columns the order stores (WO-96),
              with the Review card's labels. */}
          {rx && record && (
            <section className="rounded-lg border border-border p-4 space-y-2" data-testid="drawer-rx-details">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rx details</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                {([
                  ['Days supply',          rx.daysSupply != null ? `${rx.daysSupply} days` : null],
                  ['Dispense',             formatDispenseWithPackage(rx.dispenseQuantity, rx.dispenseUnit, record.packageLabel, record.packageCount)],
                  ['Refills',              String(rx.refills)],
                  ['Substitution',         rx.substitutionAllowed ? 'Allowed' : 'Dispense as written'],
                  ['Syringe option',       syringeOptionLabel(rx.syringeOption)],
                  ['Shipping',             shippingTypeLabel(rx.shippingType)],
                  ['Clinical difference',  rx.clinicalDifference],
                  ['Diagnosis',            formatDiagnosis(rx.diagnosisCode, rx.diagnosisText)],
                  ['Special instructions', rx.specialInstructions],
                ] as Array<[string, string | null]>).map(([label, value]) => (
                  <div key={label} className={label === 'Clinical difference' || label === 'Special instructions' ? 'col-span-2' : ''}>
                    <dt className="text-[11px] text-muted-foreground">{label}</dt>
                    <dd className="text-foreground" data-testid={`drawer-rx-${label.toLowerCase().replace(/\s+/g, '-')}`}>{value ?? '—'}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

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
                    {row.metadata?.event && DRAFT_EVENT_LABEL[row.metadata.event] ? (
                      <>
                        <p className="text-sm font-medium text-foreground">
                          {DRAFT_EVENT_LABEL[row.metadata.event]}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {row.metadata.event === 'draft_edited' ? describeDiff(row.metadata.diff) : 'still a draft'}
                          {row.changed_by && ` · ${actorDisplayName(actors, row.changed_by)}`}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-foreground">
                          {getStatusConfig(row.new_status).label}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          from {getStatusConfig(row.old_status).label}
                          {row.changed_by && ` · ${actorDisplayName(actors, row.changed_by)}`}
                        </p>
                      </>
                    )}
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
