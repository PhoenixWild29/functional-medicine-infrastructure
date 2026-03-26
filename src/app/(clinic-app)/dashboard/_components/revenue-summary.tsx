// ============================================================
// Revenue Summary — WO-30
// ============================================================
//
// REQ-CAD-004: Financial summaries for the revenue dashboard.
//   All values passed as integer cents (HC-01) from the Server Component.

interface Props {
  totalRevenueCents:      number
  totalPlatformFeeCents:  number
  totalClinicPayoutCents: number
  orderCount:             number
}

function toCurrency(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style:                 'currency',
    currency:              'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function RevenueSummary({
  totalRevenueCents,
  totalPlatformFeeCents,
  totalClinicPayoutCents,
  orderCount,
}: Props) {
  const cards = [
    {
      label: 'Total Orders',
      value: orderCount.toLocaleString('en-US'),
      description: 'All-time orders',
    },
    {
      label: 'Total Revenue',
      value: toCurrency(totalRevenueCents),
      description: 'Paid orders (excl. draft/cancelled)',
    },
    {
      label: 'Platform Fees',
      value: toCurrency(totalPlatformFeeCents),
      description: '15% of margin',
    },
    {
      label: 'Clinic Payouts',
      value: toCurrency(totalClinicPayoutCents),
      description: '85% of margin (your earnings)',
      highlight: true,
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {cards.map(card => (
        <div
          key={card.label}
          className={`rounded-lg border p-4 space-y-1 ${
            card.highlight
              ? 'border-emerald-300 bg-emerald-50'
              : 'border-border bg-card'
          }`}
        >
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {card.label}
          </p>
          <p className={`text-xl font-bold ${card.highlight ? 'text-emerald-700' : 'text-foreground'}`}>
            {card.value}
          </p>
          <p className="text-xs text-muted-foreground">{card.description}</p>
        </div>
      ))}
    </div>
  )
}
