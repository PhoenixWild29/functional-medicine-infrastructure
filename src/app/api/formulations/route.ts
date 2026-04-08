// ============================================================
// Formulation Hierarchical Search API — WO-82
// GET /api/formulations
// ============================================================
//
// Powers the cascading dropdown prescription builder (WO-83).
// Returns hierarchical data filtered at each cascade level.
//
// Query params (each filters further):
//   ?level=ingredients        → list all active ingredients
//   ?level=ingredients&q=sema → search ingredients by name
//   ?level=salt_forms&ingredient_id=xxx → salt forms for an ingredient
//   ?level=dosage_forms&ingredient_id=xxx → available dosage forms
//   ?level=routes&dosage_form_id=xxx → routes for a dosage form
//   ?level=formulations&ingredient_id=xxx&dosage_form_id=xxx&route_id=xxx → matching formulations
//   ?level=pharmacy_options&formulation_id=xxx&state=TX → pharmacies offering this formulation in state
//
// Auth: Supabase JWT (clinic_user or ops_admin)

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  // Auth check
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const level = searchParams.get('level') ?? 'ingredients'

  try {
    switch (level) {

      // ── Level 1: Ingredients (with optional search) ──────
      case 'ingredients': {
        const q = searchParams.get('q')?.trim()
        const category = searchParams.get('category')?.trim()

        let query = supabase
          .from('ingredients')
          .select('ingredient_id, common_name, therapeutic_category, dea_schedule, fda_alert_status, fda_alert_message, description')
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('common_name')

        if (q && q.length >= 2) {
          query = query.ilike('common_name', `%${q}%`)
        }
        if (category) {
          query = query.eq('therapeutic_category', category)
        }

        const { data, error } = await query
        if (error) throw error

        return NextResponse.json({ level: 'ingredients', data })
      }

      // ── Level 1b: Therapeutic categories (for filter pills) ──
      case 'categories': {
        const { data, error } = await supabase
          .from('ingredients')
          .select('therapeutic_category')
          .eq('is_active', true)
          .is('deleted_at', null)
          .not('therapeutic_category', 'is', null)

        if (error) throw error

        // Deduplicate
        const categories = [...new Set(data?.map(d => d.therapeutic_category).filter(Boolean))]
        return NextResponse.json({ level: 'categories', data: categories.sort() })
      }

      // ── Level 2: Salt forms for an ingredient ────────────
      case 'salt_forms': {
        const ingredientId = searchParams.get('ingredient_id')
        if (!ingredientId) {
          return NextResponse.json({ error: 'ingredient_id required' }, { status: 400 })
        }

        const { data, error } = await supabase
          .from('salt_forms')
          .select('salt_form_id, salt_name, abbreviation, molecular_weight, conversion_factor')
          .eq('ingredient_id', ingredientId)
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('salt_name')

        if (error) throw error

        return NextResponse.json({ level: 'salt_forms', data })
      }

      // ── Level 3: Available dosage forms for an ingredient ──
      case 'dosage_forms': {
        const ingredientId = searchParams.get('ingredient_id')
        const saltFormId = searchParams.get('salt_form_id')

        // Query formulations to find which dosage forms are available
        let query = supabase
          .from('formulations')
          .select('dosage_form_id, dosage_forms(dosage_form_id, name, is_sterile, requires_injection_supplies, sort_order)')
          .eq('is_active', true)
          .is('deleted_at', null)

        if (saltFormId) {
          query = query.eq('salt_form_id', saltFormId)
        } else if (ingredientId) {
          // For combination formulations, check formulation_ingredients
          const { data: combos } = await supabase
            .from('formulation_ingredients')
            .select('formulation_id')
            .eq('ingredient_id', ingredientId)

          const comboFormIds = combos?.map(c => c.formulation_id) ?? []

          // Get salt forms for this ingredient
          const { data: salts } = await supabase
            .from('salt_forms')
            .select('salt_form_id')
            .eq('ingredient_id', ingredientId)

          const saltIds = salts?.map(s => s.salt_form_id) ?? []

          if (saltIds.length > 0 && comboFormIds.length > 0) {
            query = query.or(`salt_form_id.in.(${saltIds.join(',')}),formulation_id.in.(${comboFormIds.join(',')})`)
          } else if (saltIds.length > 0) {
            query = query.in('salt_form_id', saltIds)
          } else if (comboFormIds.length > 0) {
            query = query.in('formulation_id', comboFormIds)
          }
        }

        const { data, error } = await query
        if (error) throw error

        // Deduplicate dosage forms
        const seen = new Set<string>()
        const dosageForms = (data ?? [])
          .map(d => (d as Record<string, unknown>).dosage_forms as Record<string, unknown> | null)
          .filter((df): df is Record<string, unknown> => {
            if (!df || seen.has(df.dosage_form_id as string)) return false
            seen.add(df.dosage_form_id as string)
            return true
          })
          .sort((a, b) => ((a.sort_order as number) ?? 0) - ((b.sort_order as number) ?? 0))

        return NextResponse.json({ level: 'dosage_forms', data: dosageForms })
      }

      // ── Level 4: Routes for a dosage form ────────────────
      case 'routes': {
        const dosageFormId = searchParams.get('dosage_form_id')

        // Query formulations to find available routes for this dosage form
        let query = supabase
          .from('formulations')
          .select('route_id, routes_of_administration(route_id, name, abbreviation, sig_prefix, sort_order)')
          .eq('is_active', true)
          .is('deleted_at', null)

        if (dosageFormId) {
          query = query.eq('dosage_form_id', dosageFormId)
        }

        const { data, error } = await query
        if (error) throw error

        // Deduplicate routes
        const seen = new Set<string>()
        const routesList = (data ?? [])
          .map(d => (d as Record<string, unknown>).routes_of_administration as Record<string, unknown> | null)
          .filter((r): r is Record<string, unknown> => {
            if (!r || seen.has(r.route_id as string)) return false
            seen.add(r.route_id as string)
            return true
          })
          .sort((a, b) => ((a.sort_order as number) ?? 0) - ((b.sort_order as number) ?? 0))

        return NextResponse.json({ level: 'routes', data: routesList })
      }

      // ── Level 5: Matching formulations ───────────────────
      case 'formulations': {
        const ingredientId = searchParams.get('ingredient_id')
        const saltFormId = searchParams.get('salt_form_id')
        const dosageFormId = searchParams.get('dosage_form_id')
        const routeId = searchParams.get('route_id')

        let query = supabase
          .from('formulations')
          .select(`
            formulation_id, name, concentration, concentration_value, concentration_unit,
            excipient_base, is_combination, total_ingredients, description,
            dosage_forms(name, is_sterile, requires_injection_supplies),
            routes_of_administration(name, abbreviation, sig_prefix),
            formulation_ingredients(
              ingredient_id, concentration_per_unit, concentration_value, concentration_unit, role,
              ingredients(common_name, dea_schedule, fda_alert_status)
            )
          `)
          .eq('is_active', true)
          .is('deleted_at', null)

        if (saltFormId) query = query.eq('salt_form_id', saltFormId)
        if (dosageFormId) query = query.eq('dosage_form_id', dosageFormId)
        if (routeId) query = query.eq('route_id', routeId)

        const { data, error } = await query
        if (error) throw error

        return NextResponse.json({ level: 'formulations', data })
      }

      // ── Level 6: Pharmacy options for a formulation ──────
      case 'pharmacy_options': {
        const formulationId = searchParams.get('formulation_id')
        const patientState = searchParams.get('state')

        if (!formulationId) {
          return NextResponse.json({ error: 'formulation_id required' }, { status: 400 })
        }

        let query = supabase
          .from('pharmacy_formulations')
          .select(`
            pharmacy_formulation_id, wholesale_price, available_quantities,
            available_supply_durations, estimated_turnaround_days,
            pharmacies(
              pharmacy_id, name, slug, integration_tier,
              fax_number, supports_real_time_status
            )
          `)
          .eq('formulation_id', formulationId)
          .eq('is_available', true)
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('wholesale_price', { ascending: true })

        const { data, error } = await query
        if (error) throw error

        // If patient state provided, filter to pharmacies licensed in that state
        let filtered = data ?? []
        if (patientState && filtered.length > 0) {
          const pharmacyIds = filtered
            .map(pf => (pf.pharmacies as Record<string, unknown>)?.pharmacy_id as string)
            .filter(Boolean)

          if (pharmacyIds.length > 0) {
            const { data: licenses } = await supabase
              .from('pharmacy_state_licenses')
              .select('pharmacy_id')
              .in('pharmacy_id', pharmacyIds)
              .eq('state_code', patientState.toUpperCase())
              .eq('is_active', true)

            const licensedIds = new Set(licenses?.map(l => l.pharmacy_id) ?? [])
            filtered = filtered.filter(pf =>
              licensedIds.has((pf.pharmacies as Record<string, unknown>)?.pharmacy_id as string)
            )
          }
        }

        return NextResponse.json({ level: 'pharmacy_options', data: filtered })
      }

      default:
        return NextResponse.json({ error: `Unknown level: ${level}` }, { status: 400 })
    }
  } catch (err) {
    console.error('[formulations] query failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
