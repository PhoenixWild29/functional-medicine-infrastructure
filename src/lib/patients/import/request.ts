// ============================================================
// Patient import: who may call, and what a request may carry
// ============================================================
//
// The clinic admin and medical assistants import patients; providers and
// ops do not (403). The clinic comes from the caller's claims (claims.ts),
// never the request. getUser(), never getSession(). Bodies are bounded:
// 5,000 rows, 100 columns, 500 characters a cell.

import { NextResponse } from 'next/server'
import { refuseCrossSite } from '@/lib/security/same-origin'
import type { User } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase/server'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { MAX_CELL_LENGTH, MAX_IMPORT_ROWS } from './csv'
import { IMPORT_FIELDS, type ColumnMapping, type ImportField } from './mapping'
import { IMPORT_ROLES } from './roles'

export { IMPORT_ROLES }
const MAX_COLUMNS = 100

export async function importCaller(request: Request): Promise<{ user: User; clinicId: string } | { response: NextResponse }> {
  const crossSite = refuseCrossSite(request)
  if (crossSite) return { response: crossSite }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!IMPORT_ROLES.has(getUserRole(user) ?? '')) {
    return { response: NextResponse.json({ error: 'Only the clinic admin or a medical assistant can import patients.' }, { status: 403 }) }
  }
  const clinicId = getUserClinicId(user)
  if (!clinicId) return { response: NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 }) }
  return { user, clinicId }
}

export interface RowsBody {
  headers: string[]
  rows: string[][]
  mapping: ColumnMapping
}

const FIELD_KEYS = new Set<string>(IMPORT_FIELDS.map(f => f.key))

/** The headers, rows and mapping of a validate or import body, bounded; a message when not usable. */
export function readRowsBody(body: unknown): RowsBody | { error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const headers = b['headers']
  const rows = b['rows']
  const mapping = b['mapping']
  if (!Array.isArray(headers) || headers.length === 0 || headers.length > MAX_COLUMNS || headers.some(h => typeof h !== 'string' || h.length > MAX_CELL_LENGTH)) {
    return { error: 'The column headers are missing or not usable.' }
  }
  if (!Array.isArray(rows) || rows.length === 0) return { error: 'There are no patient rows.' }
  if (rows.length > MAX_IMPORT_ROWS) return { error: `A file can hold at most ${MAX_IMPORT_ROWS.toLocaleString('en-US')} patient rows.` }
  for (const r of rows) {
    if (!Array.isArray(r) || r.length > MAX_COLUMNS || r.some(c => typeof c !== 'string')) return { error: 'A row is not usable.' }
    if ((r as string[]).some(c => c.length > MAX_CELL_LENGTH)) return { error: `A cell is longer than ${MAX_CELL_LENGTH} characters.` }
  }
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return { error: 'The column mapping is missing.' }
  const clean: ColumnMapping = {}
  for (const [k, v] of Object.entries(mapping as Record<string, unknown>)) {
    if (!FIELD_KEYS.has(k)) continue
    if (v === null || v === undefined || v === '') continue
    if (typeof v !== 'number' || !Number.isInteger(v)) return { error: 'The column mapping is not usable.' }
    clean[k as ImportField] = v
  }
  return { headers: headers as string[], rows: rows as string[][], mapping: clean }
}

/** A list of row indexes from the body (excluded, confirmed duplicates). */
export function readIndexes(v: unknown, rowCount: number): Set<number> {
  if (!Array.isArray(v)) return new Set()
  return new Set(v.filter((i): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < rowCount))
}
