// ============================================================
// Product Catalog Summary (V3 hierarchical catalog) — read-only
// ============================================================
//
// Renders live counts for the V3 hierarchical catalog that powers the
// prescription builder cascade (/api/formulations):
//
//   ingredients → salt_forms → formulations → pharmacy_formulations
//
// This block exists so the ops console does not read as though the flat
// legacy `catalog` table is the entire product catalog. The legacy table is
// a per-pharmacy price-list import path and is counted separately, below.
//
// PRESENTATIONAL ONLY. Every count is fetched server-side in ../page.tsx and
// passed in as a plain number (or null). A null count renders as an em dash —
// never a spinner, never a throw, never an unbounded await.

export interface ProductCatalogCounts {
  ingredients:       number | null
  saltForms:         number | null
  formulations:      number | null
  pharmacyOfferings: number | null
}

const CARDS: ReadonlyArray<{
  key:   keyof ProductCatalogCounts
  label: string
  hint:  string
}> = [
  { key: 'ingredients',       label: 'Ingredients',        hint: 'Active prescribable ingredients' },
  { key: 'saltForms',         label: 'Salt Forms',         hint: 'Salt / ester variants' },
  { key: 'formulations',      label: 'Formulations',       hint: 'Dose form + route + strength' },
  { key: 'pharmacyOfferings', label: 'Pharmacy Offerings', hint: 'Priced pharmacy availability' },
]

function formatCount(n: number | null): string {
  return n == null ? '—' : n.toLocaleString('en-US')
}

export function ProductCatalogSummary({ counts }: { counts: ProductCatalogCounts }) {
  const allUnavailable =
    counts.ingredients == null &&
    counts.saltForms == null &&
    counts.formulations == null &&
    counts.pharmacyOfferings == null

  return (
    <section
      aria-labelledby="product-catalog-heading"
      className="rounded-lg border border-border bg-card p-4 space-y-3"
    >
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 id="product-catalog-heading" className="text-base font-semibold text-foreground">
          Product Catalog
        </h2>
        <span className="text-[11px] text-muted-foreground">
          Hierarchical catalog powering the prescription builder — read-only here
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {CARDS.map(card => (
          <div
            key={card.key}
            className="rounded-md border border-border bg-muted/20 px-3 py-2"
          >
            <p className="text-xl font-semibold tabular-nums text-foreground">
              {formatCount(counts[card.key])}
            </p>
            <p className="text-xs font-medium text-foreground">{card.label}</p>
            <p className="text-[10px] text-muted-foreground">{card.hint}</p>
          </div>
        ))}
      </div>

      {allUnavailable && (
        <p className="text-[11px] text-amber-600" role="status">
          Product catalog counts are temporarily unavailable. The prescription builder is unaffected.
        </p>
      )}
    </section>
  )
}
