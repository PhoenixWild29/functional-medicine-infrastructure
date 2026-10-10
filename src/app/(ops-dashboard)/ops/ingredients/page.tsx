// ============================================================
// Ingredients: compounding status (Compliance C8)
// /ops/ingredients
// ============================================================
//
// Every ingredient's compounding status, whether a marketed FDA-approved
// product has the same active ingredient, and whether that product is on
// FDA's shortage list, with the source and review date, and the controls
// to change them. An ingredient that may not be compounded, or is not
// verified, cannot be ordered. Recent changes come from the audit log.
//
// Auth: ops_admin only, enforced OUTSIDE this component (src/middleware.ts
// and (ops-dashboard)/layout.tsx), as on every ops page. The write goes
// through PUT /api/ops/ingredients/[id]/compounding, which checks again.

import { createServiceClient } from '@/lib/supabase/service'
import { COMPOUNDABLE_STATUSES, COMPOUNDING_STATUS_LABEL, isCompoundingStatus } from '@/lib/compliance/compounding'
import { CompoundingEditor } from './_components/compounding-editor'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Ingredients | Ops Dashboard',
}

interface IngredientRow {
  ingredient_id:                  string
  common_name:                    string
  compounding_status:             string
  commercial_equivalent:          boolean
  on_fda_shortage:                boolean
  compounding_status_source:      string | null
  compounding_status_reviewed_at: string | null
}
interface HistoryRow {
  history_id:  string
  changed_at:  string
  source:      string | null
  old_status:  string | null
  new_status:  string
  ingredients: { common_name: string } | null
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : 'never')

export default async function IngredientsPage() {
  const supabase = createServiceClient()
  const [ingRes, histRes] = await Promise.all([
    supabase
      .from('ingredients')
      .select('ingredient_id, common_name, compounding_status, commercial_equivalent, on_fda_shortage, compounding_status_source, compounding_status_reviewed_at')
      .is('deleted_at', null)
      .order('common_name', { ascending: true }),
    supabase
      .from('ingredient_compounding_history')
      .select('history_id, changed_at, source, old_status, new_status, ingredients(common_name)')
      .order('changed_at', { ascending: false })
      .limit(20),
  ])

  if (ingRes.error) {
    console.error('[ops/ingredients] read failed:', ingRes.error.message)
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div role="alert" data-testid="ingredients-error" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          The ingredients could not be loaded. Refresh to try again.
        </div>
      </main>
    )
  }
  if (histRes.error) console.error('[ops/ingredients] history read failed:', histRes.error.message)

  const ingredients = (ingRes.data ?? []) as unknown as IngredientRow[]
  const history = (histRes.data ?? []) as unknown as HistoryRow[]
  const blocked = ingredients.filter(i => !COMPOUNDABLE_STATUSES.has(i.compounding_status))

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Ingredients: compounding status</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A USP-NF monograph substance, a component of an FDA-approved drug, a 503A bulks list substance or a Category 1
          substance may be ordered; so may one pending FDA evaluation, with a warning that the dispensing pharmacy confirms it
          can compound it. Everything else, and anything not verified, is blocked. Enter values from FDA&apos;s primary
          source and cite it; every change is recorded.
        </p>
        <p className="mt-2 text-sm font-medium text-foreground">
          Cannot be ordered: <span data-testid="ingredients-blocked-count">{blocked.length} of {ingredients.length}</span>
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2">Ingredient</th>
              <th scope="col" className="px-3 py-2">Status</th>
              <th scope="col" className="px-3 py-2">Commercial equivalent</th>
              <th scope="col" className="px-3 py-2">FDA shortage</th>
              <th scope="col" className="px-3 py-2">Source</th>
              <th scope="col" className="px-3 py-2">Reviewed</th>
              <th scope="col" className="px-3 py-2">Change</th>
            </tr>
          </thead>
          <tbody>
            {ingredients.map(i => {
              const isBlocked = !COMPOUNDABLE_STATUSES.has(i.compounding_status)
              return (
                <tr key={i.ingredient_id} className="border-t border-border align-top">
                  <td className="px-3 py-2 font-medium text-foreground">{i.common_name}</td>
                  <td className={`px-3 py-2 ${isBlocked ? 'text-red-700' : 'text-foreground'}`}>
                    {isCompoundingStatus(i.compounding_status) ? COMPOUNDING_STATUS_LABEL[i.compounding_status] : i.compounding_status}
                    {isBlocked && <span className="sr-only" data-testid={`ingredient-blocked-${i.ingredient_id}`}> (blocked)</span>}
                  </td>
                  <td className="px-3 py-2">{i.commercial_equivalent ? 'Yes' : 'No'}</td>
                  <td className="px-3 py-2">{i.on_fda_shortage ? 'Yes' : 'No'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{i.compounding_status_source ?? 'none'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{day(i.compounding_status_reviewed_at)}</td>
                  <td className="px-3 py-2">
                    <CompoundingEditor
                      ingredientId={i.ingredient_id}
                      ingredientName={i.common_name}
                      status={i.compounding_status}
                      commercialEquivalent={i.commercial_equivalent}
                      onFdaShortage={i.on_fda_shortage}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <section className="rounded-lg border border-border bg-card p-4" data-testid="ingredient-history">
        <h2 className="text-sm font-semibold text-foreground">Recent changes</h2>
        {history.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">No changes recorded yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {history.map(h => (
              <li key={h.history_id}>
                {day(h.changed_at)} {h.ingredients?.common_name ?? 'An ingredient'}: {h.old_status ?? 'new'} → {h.new_status}
                {h.source ? ` (${h.source})` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
