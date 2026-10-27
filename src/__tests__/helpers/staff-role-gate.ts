// ============================================================
// Harness for the clinic staff role gate (security follow-ups 3)
// ============================================================
//
// A clinic route lets in clinic_admin, provider and medical_assistant
// only (isClinicStaffRole, lib/auth/claims). Any other role, or a session
// with a clinic_id but no role, is refused with 403 before anything is
// read. Each route's role-gate test mocks the Supabase clients with these:
//
//   jest.mock('@/lib/supabase/server', () => ({ createServerClient: () => serverModule.createServerClient() }))
//   jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => serviceModule.createServiceClient() }))
//
// `gate.reads` records every service client made and every table or rpc
// touched on either client. A refused call must leave it empty. An allowed
// call is sent with a bad input, so it passes the gate and stops at a 400.

export const CLINIC = 'c0000000-0000-4000-8000-000000000001'

export const gate: { user: unknown; reads: string[] } = { user: null, reads: [] }

export function userWith(appMetadata: Record<string, unknown>) {
  return { id: '11111111-1111-4111-8111-111111111111', app_metadata: appMetadata, user_metadata: {} }
}

/** The callers a clinic route must refuse: other roles, and no role at all. */
export const REFUSED: Array<[string, Record<string, unknown>]> = [
  ['pharmacy_admin', { app_role: 'pharmacy_admin', clinic_id: CLINIC }],
  ['ops_admin', { app_role: 'ops_admin', clinic_id: CLINIC }],
  ['patient', { app_role: 'patient', clinic_id: CLINIC }],
  ['clinic_id but no role', { clinic_id: CLINIC }],
]

/** The roles that use the clinic app today. */
export const ALLOWED = ['clinic_admin', 'provider', 'medical_assistant'] as const

export function setCaller(appMetadata: Record<string, unknown>): void {
  gate.user = userWith(appMetadata)
  gate.reads.length = 0
}

function client(label: string) {
  const refuse = (what: string) => () => {
    gate.reads.push(`${label}.${what}`)
    throw new Error(`${label}.${what} was reached in a role-gate test`)
  }
  return {
    from: (table: string) => refuse(`from(${table})`)(),
    rpc: (fn: string) => refuse(`rpc(${fn})`)(),
    storage: { from: (bucket: string) => refuse(`storage(${bucket})`)() },
  }
}

export const serverModule = {
  createServerClient: async () => ({
    ...client('server'),
    auth: {
      getUser: async () => ({ data: { user: gate.user }, error: null }),
      getSession: async () => { throw new Error('getSession must never be used') },
    },
  }),
}

export const serviceModule = {
  createServiceClient: () => {
    gate.reads.push('createServiceClient')
    return client('service')
  },
}

/** The pending-review guard reads the clinic; an allowed caller's clinic is approved. */
export const approvalModule = {
  refuseUnlessApproved: async () => null,
}
