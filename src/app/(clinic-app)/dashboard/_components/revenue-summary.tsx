// ============================================================
// Revenue Summary / Metric Cards — WO-71
//
// Redesign with WO-71 spec:
//   - 4 metric cards: Total Orders MTD, Revenue MTD, Pending Payment, Completed MTD
//   - Trend: comparison to same calendar month, prior year
//   - Day-one empty state: em-dash for zero values with tooltip
//   - Skeleton loading via SkeletonCard
//
// HC-01: All monetary values passed as integer cents.
// ============================================================

import { SkeletonCard } from '@/components/ui/skeleton'

interface Props {
  // Current MTD metrics
  totalOrdersMtd:      number
  totalRevenueCents:   number
  pendingPaymentCount: number
  completedMtd:        number
  // Prior year same-month metrics for trend
  priorYearOrdersMtd:  number
  priorYearRevenueCents: number
  isLoading?:          boolean
}

function toCurrency(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style:                 'currency',
    currency:              'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function Trend({ current, prior, label }: { current: number; prior: number; label: string }) {
  if (prior === 0 && current === 0) return null
  if (prior === 0) return null  // Can't compute % from zero baseline

  const pct   = ((current - prior) / prior) * 100
  const up    = pct >= 0
  const abs   = Math.abs(pct)
  const display = abs < 1 ? '<1%' : `${Math.round(abs)}%`

  return (
    <p className={`mt-2 flex items-center gap-1 text-xs font-medium ${up ? 'text-green-600' : 'text-red-600'}`}>
      {/* Use arrow + text — never color alone (colorblind) */}
      <span aria-hidden>{up ? '↑' : '↓'}</span>
      <span>{up ? '+' : '-'}{display}</span>
      <span className="font-normal text-muted-foreground">vs. {label}</span>
    </p>
  )
}

export function RevenueSummary({
  totalOrdersMtd,
  totalRevenueCents,
  pendingPaymentCount,
  completedMtd,
  priorYearOrdersMtd,
  priorYearRevenueCents,
  isLoading = false,
}: Props) {

  // Compute comparison period label (same month, prior year)
  const now = new Date()
  const priorYear = now.getFullYear() - 1
  const monthName = now.toLocaleString('en-US', { month: 'short' })
  const priorLabel = `${monthName} ${priorYear}`

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map(i => <SkeletonCard key={i} />)}
      </div>
    )
  }

  const cards = [
    {
      id:          'total-orders',
      label:       'Total Orders',
      sublabel:    'Month to date',
      value:       totalOrdersMtd === 0 ? '—' : totalOrdersMtd.toLocaleString('en-US'),
      emptyTip:    'No orders yet this month',
      showTrend:   true,
      trendCurrent: totalOrdersMtd,
      trendPrior:   priorYearOrdersMtd,
    },
    {
      id:          'revenue',
      label:       'Revenue',
      sublabel:    'Month to date',
      value:       totalRevenueCents === 0 ? '—' : toCurrency(totalRevenueCents),
      emptyTip:    'No revenue yet this month',
      showTrend:   true,
      trendCurrent: totalRevenueCents,
      trendPrior:   priorYearRevenueCents,
    },
    {
      id:          'pending-payment',
      label:       'Pending Payment',
      sublabel:    'Open payment links',
      value:       pendingPaymentCount === 0 ? '—' : pendingPaymentCount.toLocaleString('en-US'),
      emptyTip:    'No pending payments',
      showTrend:   false,
    },
    {
      id:          'completed',
      label:       'Completed',
      sublabel:    'Delivered this month',
      value:       completedMtd === 0 ? '—' : completedMtd.toLocaleString('en-US'),
      emptyTip:    'No completed orders this month',
      showTrend:   false,
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map(card => (
        <div
          key={card.id}
          className="rounded-xl border border-border bg-card p-5 shadow-sm"
          title={card.value === '—' ? card.emptyTip : undefined}
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {card.label}
          </p>
          <p className="mt-3 text-[32px] font-bold leading-none text-foreground">
            {card.value}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{card.sublabel}</p>
          {card.showTrend && card.value !== '—' && (
            <Trend
              current={card.trendCurrent!}
              prior={card.trendPrior!}
              label={priorLabel}
            />
          )}
        </div>
      ))}
    </div>
  )
}
