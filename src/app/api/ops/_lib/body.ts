// ============================================================
// /api/ops/* request bodies: a JSON object, or a 400
// ============================================================
//
// The ops routes answered invalid JSON with their own message ("Invalid
// JSON"), which their tests and the ops UI show; that message is kept.
// A body that parses but is not an object (null, an array, a string)
// used to reach `body['action']` and throw a TypeError (a 500): it is a
// 400 now, from the shared helper (lib/api/input).

import type { NextResponse } from 'next/server'
import { badRequest } from '@/lib/api/input'

export type ObjectBody =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse }

export async function readObjectBody(request: Request, invalidJson = 'Invalid JSON'): Promise<ObjectBody> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return { ok: false, response: badRequest(invalidJson) }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, response: badRequest('Invalid request', ['(body)']) }
  }
  return { ok: true, body: raw as Record<string, unknown> }
}
