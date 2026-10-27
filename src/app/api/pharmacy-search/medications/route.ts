// ============================================================
// Medication Autocomplete — WO-27
// GET /api/pharmacy-search/medications?q=<query>&limit=<n>
// ============================================================
//
// REQ-SCS-001: Triggers at 3+ characters, returns distinct
// medication_name/form/dose suggestions from the catalog across
// all active pharmacies.
//
// Auth: a verified clinic user (getUser(); provider, medical assistant or
// clinic admin from app_metadata), before the query is read.
// Input: q at most 200 characters; limit a whole number 1–100 (capped at
// 20 as before). Anything else is a 400 (lib/api/input).
// Caching: 60s max-age (catalog updates are infrequent).
//
// Response: { suggestions: MedicationSuggestion[] }

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { getUserRole } from '@/lib/auth/claims'
import { MAX_SEARCH, parseQuery } from '@/lib/api/input'
import { z } from 'zod'

const CLINIC_ROLES = new Set(['provider', 'medical_assistant', 'clinic_admin'])

const Query = z.object({
  q:     z.string().trim().max(MAX_SEARCH).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(10),
})

export interface MedicationSuggestion {
  item_id:         string
  medication_name: string
  form:            string
  dose:            string
  dea_schedule:    number
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  // Auth gate — must be a clinic-app user
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!CLINIC_ROLES.has(getUserRole(user) ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const query = parseQuery(request.nextUrl.searchParams, Query)
  if (!query.ok) return query.response
  const q     = query.data.q
  const limit = Math.min(query.data.limit, 20)

  // REQ-SCS-001: minimum 3 characters
  if (q.length < 3) {
    return NextResponse.json({ suggestions: [] }, { status: 200 })
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('catalog')
    .select('item_id, medication_name, form, dose, dea_schedule')
    .ilike('medication_name', `%${q}%`)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('medication_name', { ascending: true })
    .limit(limit * 5)   // fetch more to deduplicate by name

  if (error) {
    console.error('[pharmacy-search/medications] query failed:', error.message)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }

  // BLK-03: Deduplicate by (medication_name, form, dose) triple — the same medication
  // name can exist in multiple forms/doses and each should appear as a distinct suggestion.
  const seen = new Set<string>()
  const suggestions: MedicationSuggestion[] = []

  for (const row of data ?? []) {
    const key = `${row.medication_name}|${row.form}|${row.dose}`
    if (!seen.has(key)) {
      seen.add(key)
      suggestions.push({
        item_id:         row.item_id,
        medication_name: row.medication_name,
        form:            row.form,
        dose:            row.dose,
        dea_schedule:    row.dea_schedule ?? 0,
      })
    }
    if (suggestions.length >= limit) break
  }

  return NextResponse.json(
    { suggestions },
    {
      status: 200,
      headers: { 'Cache-Control': 'private, max-age=60' },
    }
  )
}

export const GET = withApiErrors('/api/pharmacy-search/medications', getHandler)
