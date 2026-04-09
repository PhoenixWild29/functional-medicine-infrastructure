// ============================================================
// Drug Interaction Check API — WO-86
// ============================================================
//
// POST /api/interactions/check  → Check interactions between ingredient IDs
// GET  /api/interactions        → List all known interactions
//
// Returns any known interactions between the provided ingredients.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('drug_interactions')
    .select(`
      interaction_id,
      severity,
      description,
      clinical_note,
      source,
      ingredient_a:ingredients!drug_interactions_ingredient_a_id_fkey ( ingredient_id, common_name ),
      ingredient_b:ingredients!drug_interactions_ingredient_b_id_fkey ( ingredient_id, common_name )
    `)
    .order('severity')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

export async function POST(req: NextRequest) {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { ingredient_ids } = body as { ingredient_ids: string[] }

  if (!ingredient_ids || ingredient_ids.length < 2) {
    return NextResponse.json({ data: [] })
  }

  const supabase = createServiceClient()

  // Find all interactions where EITHER ingredient is in the provided list,
  // then filter to only return pairs where BOTH are in the list.
  const { data, error } = await supabase
    .from('drug_interactions')
    .select(`
      interaction_id,
      ingredient_a_id,
      ingredient_b_id,
      severity,
      description,
      clinical_note,
      source,
      ingredient_a:ingredients!drug_interactions_ingredient_a_id_fkey ( ingredient_id, common_name ),
      ingredient_b:ingredients!drug_interactions_ingredient_b_id_fkey ( ingredient_id, common_name )
    `)
    .or(`ingredient_a_id.in.(${ingredient_ids.join(',')}),ingredient_b_id.in.(${ingredient_ids.join(',')})`)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Filter to only pairs where BOTH ingredients are in the session
  const idSet = new Set(ingredient_ids)
  const relevant = (data ?? []).filter(
    int => idSet.has(int.ingredient_a_id) && idSet.has(int.ingredient_b_id)
  )

  return NextResponse.json({ data: relevant })
}
