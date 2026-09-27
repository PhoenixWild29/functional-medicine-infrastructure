'use client'

// ============================================================
// WO-102: Review — shipping context, breakdown and the
// multi-pharmacy notice
// ============================================================
//
// useBundleShipping fetches the session pharmacies' rates (stored once on
// `pharmacies`) and the clinic's absorb-shipping setting, and — only when
// the session spans more than one pharmacy — every line's offers at the
// pharmacies licensed in the patient's state, so the notice can price a
// re-route. Everything shown is computed (src/lib/orders/shipping.ts,
// src/lib/orders/reroute.ts); nothing here is typed.

import { useEffect, useMemo, useState } from 'react'
import type { SessionPrescription } from '../../_context/prescription-session'
import { packageOptionsFromRows } from '@/lib/orders/rx-details'
import { computeBundleShipping, type BundleShipping, type PharmacyShippingRates } from '@/lib/orders/shipping'
import { multiPharmacyNotice, type MultiPharmacyNotice, type PharmacyOffer, type RerouteLine } from '@/lib/orders/reroute'

interface ShippingContext {
  rates:          Map<string, PharmacyShippingRates>
  absorbShipping: boolean
  shipping:       BundleShipping
  notice:         MultiPharmacyNotice | null
  loaded:         boolean
}

interface PharmacyOptionRow {
  wholesale_price: number | string
  pharmacies: { pharmacy_id: string; name: string; integration_tier?: string | null } | null
  packages?: Array<{ id: string; label: string; qty: number; unit: string; wholesalePrice: number; isDefault: boolean }>
  pharmacy_formulation_packages?: Parameters<typeof packageOptionsFromRows>[0]
}

export function rerouteLineFrom(rx: SessionPrescription): RerouteLine {
  return {
    id:               rx.id,
    medicationName:   rx.medicationName,
    pharmacyId:       rx.pharmacyId,
    pharmacyName:     rx.pharmacyName,
    formulationId:    rx.formulationId,
    wholesaleCents:   rx.wholesaleCents,
    retailCents:      rx.retailCents,
    shippingType:     rx.rxDetails?.shippingType ?? null,
    packageId:        rx.packageId ?? null,
    packageLabel:     rx.packageLabel ?? null,
    packageCount:     rx.packageCount ?? null,
    dispenseQuantity: rx.rxDetails?.dispenseQuantity ?? null,
    dispenseUnit:     rx.rxDetails?.dispenseUnit ?? null,
    dosageFormName:   rx.form || null,
    concentrationValue: rx.concentrationValue ?? null,
    concentrationUnit:  rx.concentrationUnit ?? null,
  }
}

export function useBundleShipping(prescriptions: ReadonlyArray<SessionPrescription>, patientState: string | null): ShippingContext {
  const pharmacyKey = [...new Set(prescriptions.map(rx => rx.pharmacyId))].sort().join(',')
  const [rates, setRates] = useState<Map<string, PharmacyShippingRates>>(new Map())
  const [absorbShipping, setAbsorbShipping] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!pharmacyKey) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/pharmacies/shipping?ids=${encodeURIComponent(pharmacyKey)}`)
        if (!res.ok) return
        const json = await res.json() as { rates?: PharmacyShippingRates[]; absorbShipping?: boolean }
        if (cancelled) return
        setRates(new Map((json.rates ?? []).map(r => [r.pharmacyId, r])))
        setAbsorbShipping(json.absorbShipping === true)
      } catch (err) {
        console.warn('[review] shipping rates lookup failed (non-fatal):', err instanceof Error ? err.message : err)
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [pharmacyKey])

  // Offers for the re-route: only for a multi-pharmacy session.
  const multi = pharmacyKey.includes(',')
  const offerKey = multi
    ? prescriptions.filter(rx => rx.formulationId).map(rx => `${rx.id}:${rx.formulationId}`).join('|') + `@${patientState ?? ''}`
    : ''
  const [offersByLine, setOffersByLine] = useState<Map<string, PharmacyOffer[]>>(new Map())
  useEffect(() => {
    if (!offerKey) return
    let cancelled = false
    const lines = offerKey.split('@')[0]!.split('|').filter(Boolean).map(s => s.split(':') as [string, string])
    void (async () => {
      const next = new Map<string, PharmacyOffer[]>()
      const byFormulation = new Map<string, PharmacyOffer[]>()
      for (const [lineId, formulationId] of lines) {
        try {
          let offers = byFormulation.get(formulationId)
          if (!offers) {
            const params = new URLSearchParams({ level: 'pharmacy_options', formulation_id: formulationId })
            if (patientState) params.set('state', patientState)
            const res = await fetch(`/api/formulations?${params.toString()}`)
            if (!res.ok) continue
            const json = await res.json() as { data?: PharmacyOptionRow[] }
            offers = (json.data ?? [])
              .filter(o => o.pharmacies)
              .map(o => ({
                pharmacyId:      o.pharmacies!.pharmacy_id,
                pharmacyName:    o.pharmacies!.name,
                integrationTier: o.pharmacies!.integration_tier ?? null,
                wholesaleCents:  Math.round(Number(o.wholesale_price) * 100),
                packages:        o.packages ?? packageOptionsFromRows(o.pharmacy_formulation_packages),
              }))
            byFormulation.set(formulationId, offers)
          }
          next.set(lineId, offers)
        } catch (err) {
          console.warn('[review] pharmacy offers lookup failed (non-fatal):', err instanceof Error ? err.message : err)
        }
      }
      if (!cancelled) setOffersByLine(next)
    })()
    return () => { cancelled = true }
  }, [offerKey, patientState])

  const shipping = useMemo(
    () => computeBundleShipping(
      prescriptions.map(rx => ({ pharmacyId: rx.pharmacyId, shippingType: rx.rxDetails?.shippingType ?? null, wholesaleCents: rx.wholesaleCents })),
      rates,
    ),
    [prescriptions, rates],
  )
  const notice = useMemo(
    () => (multi && loaded ? multiPharmacyNotice(prescriptions.map(rerouteLineFrom), offersByLine, rates) : null),
    [multi, loaded, prescriptions, offersByLine, rates],
  )

  return { rates, absorbShipping, shipping, notice, loaded }
}

const money = (cents: number) => '$' + (cents / 100).toFixed(2)

export function ShippingLines({ shipping, absorbShipping, rates }: { shipping: BundleShipping; absorbShipping: boolean; rates: Map<string, PharmacyShippingRates> }) {
  return (
    <div data-testid="shipping-breakdown">
      {shipping.byPharmacy.map(p => (
        <div key={p.pharmacyId} className="mt-1 flex items-center justify-between text-xs text-muted-foreground" data-testid={`shipping-${p.pharmacyId}`}>
          <span>
            Shipping — {p.pharmacyName || 'pharmacy'} ({p.shippingType === 'cold_chain' ? 'cold chain' : 'standard'}
            {p.itemCount > 1 ? `, ${p.itemCount} items in one shipment` : ''})
            {p.waived && rates.get(p.pharmacyId)?.freeShippingThresholdCents != null
              ? ` — free over ${money(rates.get(p.pharmacyId)!.freeShippingThresholdCents!)}`
              : ''}
          </span>
          <span>{money(p.feeCents)}</span>
        </div>
      ))}
      {absorbShipping && shipping.totalCents > 0 && (
        <p className="mt-1 text-[10px] text-muted-foreground">Shipping is absorbed by the clinic — not charged to the patient.</p>
      )}
    </div>
  )
}

export function MultiPharmacyNoticeBanner({
  notice,
  disabled,
  onReroute,
}: {
  notice: MultiPharmacyNotice
  disabled: boolean
  onReroute: () => void
}) {
  return (
    <div role="status" data-testid="multi-pharmacy-notice" className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
      <p className="text-xs text-amber-900 dark:text-amber-200" data-testid="multi-pharmacy-message">{notice.message}</p>
      {notice.offerReroute && notice.plan && (
        <button
          type="button"
          onClick={onReroute}
          disabled={disabled}
          className="mt-2 rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
        >
          Route all to {notice.plan.targetPharmacyName}
        </button>
      )}
    </div>
  )
}
