// The <state> of /api/pharmacy/onboarding/licenses/<state>[/document]: a
// US license state (lib/providers/states, the set a license may be saved
// for), any case. Anything else is a 400 "Unknown state." (the library's
// own message), before anything is read, uploaded or deleted.

import { z } from 'zod'
import { US_STATES } from '@/lib/providers/states'
import { badRequest, parseParams, type Parsed } from '@/lib/api/input'

const StateParam = z.object({
  // Checked upper-cased; passed on as given (the library upper-cases it).
  state: z.string().refine(s => US_STATES.has(s.toUpperCase())),
})

export async function parseStateParam(context: { params: Promise<{ state: string }> }): Promise<Parsed<{ state: string }>> {
  const parsed = await parseParams(context, StateParam)
  return parsed.ok ? parsed : { ok: false, response: badRequest('Unknown state.', ['state']) }
}
