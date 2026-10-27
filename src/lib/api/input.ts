// ============================================================
// Request input for route handlers (zod v4)
// ============================================================
//
// Every route handler parses its body, query and params here before using
// them. Bad input is a 400 with a short reason, never a thrown 500 (a bad
// uuid reaching Postgres is error 22P02, a 500). The reply names the
// fields that failed but never echoes the submitted values: they can be
// PHI.
//
// Order in a handler: who is calling (getUser, role and clinic from
// app_metadata) first, then parse, then read or write.

import { z } from 'zod'
import { NextResponse } from 'next/server'

/**
 * Any 8-4-4-4-12 hex id. Not z.uuid(): that enforces the RFC 4122 version
 * and variant bits, and the seeded demo ids (a4000000-0000-0000-0000-...)
 * are not v4.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const uuid = () => z.string().regex(UUID_RE, 'must be an id')

/** A trimmed string of at most `max` characters. */
export const boundedText = (max: number) => z.string().trim().max(max)

/** Common bounds. */
export const MAX_NAME = 200
export const MAX_NOTE = 2000
export const MAX_SEARCH = 200

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: NextResponse }

export function badRequest(error: string, fields?: string[]): NextResponse {
  return NextResponse.json(
    { error, ...(fields && fields.length ? { fields } : {}) },
    { status: 400, headers: { 'Cache-Control': 'no-store' } },
  )
}

function fieldsOf(error: z.ZodError): string[] {
  return [...new Set(error.issues.map(i => (i.path.length ? i.path.join('.') : '(body)')))]
}

/** Validate a value already in hand. */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown, message = 'Invalid request'): Parsed<z.infer<S>> {
  const r = schema.safeParse(value)
  return r.success ? { ok: true, data: r.data } : { ok: false, response: badRequest(message, fieldsOf(r.error)) }
}

/** The JSON body. Invalid JSON is a 400 ("Invalid JSON body"). */
export async function parseJsonBody<S extends z.ZodType>(request: Request, schema: S): Promise<Parsed<z.infer<S>>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return { ok: false, response: badRequest('Invalid JSON body') }
  }
  return parseInput(schema, raw)
}

/** Dynamic route params (`context.params`). */
export async function parseParams<S extends z.ZodType>(
  context: { params: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> },
  schema: S,
): Promise<Parsed<z.infer<S>>> {
  return parseInput(schema, await context.params, 'Invalid request')
}

/** Query string. Repeated keys keep the first value. */
export function parseQuery<S extends z.ZodType>(searchParams: URLSearchParams, schema: S): Parsed<z.infer<S>> {
  const obj: Record<string, string> = {}
  for (const [k, v] of searchParams) if (!(k in obj)) obj[k] = v
  return parseInput(schema, obj)
}
