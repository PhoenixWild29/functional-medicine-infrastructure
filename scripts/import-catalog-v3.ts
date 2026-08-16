/**
 * ============================================================
 * V3 Hierarchical Catalog Importer
 * ============================================================
 *
 * Loads docs/research/catalog-seed/compoundiq-catalog-seed-v1.csv
 * (166 demo products) into the V3 hierarchical catalog:
 *   ingredients -> salt_forms -> formulations
 *     -> formulation_ingredients (combos) -> pharmacy_formulations
 *
 * Usage:
 *   npm run seed:catalog                      # attach to every pharmacy
 *   npm run seed:catalog -- --pharmacy-id=<uuid>   # single pharmacy
 *
 * Idempotent: deterministic md5-derived UUIDs + upsert onConflict, so
 * re-running updates rather than duplicating. Reference tables
 * (dosage_forms, routes_of_administration) are resolved BY NAME and
 * never created here (seeded by 20260408000002_wo82_seed_reference_data).
 *
 * Cascade correctness (see src/app/api/formulations/route.ts):
 *   - single-ingredient formulations get a salt_form (base salt when the
 *     CSV has no explicit salt_name) so they're reachable via
 *     ingredient -> salt_form -> formulation.
 *   - combination formulations have salt_form_id = NULL and link their
 *     component ingredients through formulation_ingredients, which is the
 *     documented path the API uses to surface combos for an ingredient.
 *
 * Wholesale prices are SYNTHETIC demo values.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import Papa from 'papaparse'
import { createServiceClient } from '@/lib/supabase/service'
import type { Json } from '@/types/database.types'

const CSV_PATH = join(process.cwd(), 'docs', 'research', 'catalog-seed', 'compoundiq-catalog-seed-v1.csv')

// ID prefixes ('ing:', 'salt:', 'form:', 'pf:') MUST match the production
// SQL catalog seed's derivation — prod data was loaded with these prefixes;
// changing them would fork the catalog into duplicate rows under new IDs.
function uid(key: string): string {
  const h = createHash('md5').update(key).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}
const ingId = (name: string): string => uid('ing:' + name.trim().toLowerCase())
const saltId = (iname: string, sname: string): string =>
  uid('salt:' + iname.trim().toLowerCase() + ':' + sname.trim().toLowerCase())
const formId = (name: string): string => uid('form:' + name.trim().toLowerCase())

interface CsvRow {
  ingredient_common_name: string
  therapeutic_category: string
  dea_schedule: string
  salt_name: string
  formulation_name: string
  dosage_form: string
  route: string
  concentration_value: string
  concentration_unit: string
  is_combination: string
  combo_ingredients: string
  wholesale_price_usd: string
  available_quantities: string
}

function parseComponent(tok: string): { name: string; strength: string | null } {
  const t = tok.trim()
  const idx = t.lastIndexOf(' ')
  if (idx > 0) {
    const tail = t.slice(idx + 1)
    if (/\d/.test(tail)) return { name: t.slice(0, idx).trim(), strength: tail.trim() }
  }
  return { name: t, strength: null }
}

interface IngredientAcc {
  common_name: string
  therapeutic_category: string | null
  dea_schedule: number | null
}
interface SaltFormRow {
  salt_form_id: string
  ingredient_id: string
  salt_name: string
}
interface FormOut {
  formulation_id: string
  name: string
  salt_form_id: string | null
  dosage_form_id: string
  route_id: string
  concentration: string | null
  concentration_value: number | null
  concentration_unit: string | null
  is_combination: boolean
  total_ingredients: number
  price: number
  qty: string[]
}
interface FormIngRow {
  formulation_ingredient_id: string
  formulation_id: string
  ingredient_id: string
  concentration_per_unit: string
  role: string
  sort_order: number
}

async function main(): Promise<void> {
  const pharmacyArg = process.argv.find((a) => a.startsWith('--pharmacy-id='))?.split('=')[1]
  const supabase = createServiceClient()

  // ── reference maps (resolve by name; never create here) ──
  const { data: dfs, error: dfErr } = await supabase.from('dosage_forms').select('dosage_form_id, name')
  if (dfErr) throw dfErr
  const dfMap = new Map<string, string>((dfs ?? []).map((d) => [d.name, d.dosage_form_id]))

  const { data: routes, error: rErr } = await supabase
    .from('routes_of_administration')
    .select('route_id, name')
  if (rErr) throw rErr
  const routeMap = new Map<string, string>((routes ?? []).map((r) => [r.name, r.route_id]))

  // ── pharmacies to attach ──
  let pharmacyIds: string[]
  if (pharmacyArg) {
    pharmacyIds = [pharmacyArg]
  } else {
    const { data: phs, error: pErr } = await supabase.from('pharmacies').select('pharmacy_id')
    if (pErr) throw pErr
    pharmacyIds = (phs ?? []).map((p) => p.pharmacy_id)
  }
  if (pharmacyIds.length === 0) {
    console.warn(
      '[import-catalog] no pharmacies found — formulations will load but have zero pharmacy options (not orderable until a pharmacy exists)',
    )
  }

  // ── parse CSV ──
  const csv = readFileSync(CSV_PATH, 'utf8')
  const parsed = Papa.parse<CsvRow>(csv, { header: true, skipEmptyLines: true })
  const rows = parsed.data

  const ingredients = new Map<string, IngredientAcc>()
  const addIng = (name: string, cat: string | null, dea: number | null, authoritative: boolean): void => {
    const n = name.trim()
    if (!n) return
    const cur = ingredients.get(n)
    if (!cur) {
      ingredients.set(n, { common_name: n, therapeutic_category: cat, dea_schedule: dea })
      return
    }
    if (authoritative) {
      if (cat) cur.therapeutic_category = cat
      if (dea !== null) cur.dea_schedule = dea
    } else if (cur.therapeutic_category === null && cat) {
      cur.therapeutic_category = cat
    }
  }

  const saltForms = new Map<string, SaltFormRow>()
  const formulations: FormOut[] = []
  const formIngs = new Map<string, FormIngRow>()

  // pass 1: singles define authoritative category/dea for their ingredient
  for (const r of rows) {
    if ((r.is_combination ?? '').trim().toLowerCase() !== 'true') {
      const deaRaw = (r.dea_schedule ?? '').trim()
      addIng(r.ingredient_common_name, (r.therapeutic_category ?? '').trim() || null, deaRaw ? Number(deaRaw) : null, true)
    }
  }

  // pass 2: build salt_forms, formulations, formulation_ingredients
  const missingRef: string[] = []
  for (const r of rows) {
    const iname = (r.ingredient_common_name ?? '').trim()
    const cat = (r.therapeutic_category ?? '').trim() || null
    const deaRaw = (r.dea_schedule ?? '').trim()
    const dea = deaRaw ? Number(deaRaw) : null
    const fname = (r.formulation_name ?? '').trim()
    const dosage = (r.dosage_form ?? '').trim()
    const route = (r.route ?? '').trim()
    const dosageId = dfMap.get(dosage)
    const routeId = routeMap.get(route)
    if (!dosageId || !routeId) {
      missingRef.push(`${fname} (${dosage} / ${route})`)
      continue
    }
    const cval = (r.concentration_value ?? '').trim()
    const cunit = (r.concentration_unit ?? '').trim()
    const isCombo = (r.is_combination ?? '').trim().toLowerCase() === 'true'
    const price = Number((r.wholesale_price_usd ?? '').trim())
    const qty = (r.available_quantities ?? '').split('|').map((s) => s.trim()).filter(Boolean)
    const concText = cval ? cval + cunit : null
    const fid = formId(fname)

    if (isCombo) {
      const comps = (r.combo_ingredients ?? '')
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(parseComponent)
      comps.forEach((c, i) => {
        addIng(c.name, cat, null, false)
        const key = fid + ':' + c.name.trim().toLowerCase()
        formIngs.set(key, {
          formulation_ingredient_id: uid('fi:' + key),
          formulation_id: fid,
          ingredient_id: ingId(c.name),
          concentration_per_unit: c.strength ?? 'n/a',
          role: 'primary',
          sort_order: i,
        })
      })
      formulations.push({
        formulation_id: fid,
        name: fname,
        salt_form_id: null,
        dosage_form_id: dosageId,
        route_id: routeId,
        concentration: concText,
        concentration_value: cval ? Number(cval) : null,
        concentration_unit: cunit || null,
        is_combination: true,
        total_ingredients: Math.max(1, comps.length),
        price,
        qty,
      })
    } else {
      addIng(iname, cat, dea, true)
      const sname = (r.salt_name ?? '').trim() || iname
      const sid = saltId(iname, sname)
      saltForms.set(sid, { salt_form_id: sid, ingredient_id: ingId(iname), salt_name: sname })
      formulations.push({
        formulation_id: fid,
        name: fname,
        salt_form_id: sid,
        dosage_form_id: dosageId,
        route_id: routeId,
        concentration: concText,
        concentration_value: cval ? Number(cval) : null,
        concentration_unit: cunit || null,
        is_combination: false,
        total_ingredients: 1,
        price,
        qty,
      })
    }
  }
  if (missingRef.length > 0) {
    throw new Error('Unknown dosage_form/route (not in reference tables) for: ' + missingRef.join('; '))
  }

  // ── upserts (order respects FKs) ──
  const ingRows = [...ingredients.values()].map((v) => ({
    ingredient_id: ingId(v.common_name),
    common_name: v.common_name,
    therapeutic_category: v.therapeutic_category,
    dea_schedule: v.dea_schedule,
    is_active: true,
  }))
  const { error: e1 } = await supabase.from('ingredients').upsert(ingRows, { onConflict: 'ingredient_id' })
  if (e1) throw e1

  const saltRows = [...saltForms.values()].map((s) => ({ ...s, is_active: true }))
  const { error: e2 } = await supabase.from('salt_forms').upsert(saltRows, { onConflict: 'salt_form_id' })
  if (e2) throw e2

  const formRows = formulations.map((f) => ({
    formulation_id: f.formulation_id,
    name: f.name,
    salt_form_id: f.salt_form_id,
    dosage_form_id: f.dosage_form_id,
    route_id: f.route_id,
    concentration: f.concentration,
    concentration_value: f.concentration_value,
    concentration_unit: f.concentration_unit,
    is_combination: f.is_combination,
    total_ingredients: f.total_ingredients,
    is_active: true,
  }))
  const { error: e3 } = await supabase.from('formulations').upsert(formRows, { onConflict: 'formulation_id' })
  if (e3) throw e3

  if (formIngs.size > 0) {
    const { error: e4 } = await supabase
      .from('formulation_ingredients')
      .upsert([...formIngs.values()], { onConflict: 'formulation_id,ingredient_id' })
    if (e4) throw e4
  }

  const pfRows = formulations.flatMap((f) =>
    pharmacyIds.map((pid) => ({
      pharmacy_formulation_id: uid('pf:' + pid + ':' + f.name.trim().toLowerCase()),
      pharmacy_id: pid,
      formulation_id: f.formulation_id,
      wholesale_price: f.price,
      available_quantities: f.qty as unknown as Json,
      is_available: true,
      is_active: true,
    })),
  )
  if (pfRows.length > 0) {
    const { error: e5 } = await supabase
      .from('pharmacy_formulations')
      .upsert(pfRows, { onConflict: 'pharmacy_id,formulation_id' })
    if (e5) throw e5
  }

  console.info(
    `[import-catalog] done. ingredients=${ingRows.length} salt_forms=${saltRows.length} ` +
      `formulations=${formRows.length} formulation_ingredients=${formIngs.size} ` +
      `pharmacy_formulations=${pfRows.length} (pharmacies=${pharmacyIds.length})`,
  )
}

main().catch((err: unknown) => {
  console.error('[import-catalog] FAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
