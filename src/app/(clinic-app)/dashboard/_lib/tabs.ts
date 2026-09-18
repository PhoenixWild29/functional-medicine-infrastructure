// ============================================================
// Dashboard tabs — shared by the server page and the client dashboard
// ============================================================
//
// A plain module, deliberately without 'use client'. dashboard/page.tsx
// (a Server Component) calls isTabId() during render; when it lived in
// orders-dashboard.tsx, a 'use client' module, the page received a
// client reference instead of the function and /dashboard stopped
// rendering. Guarded by src/__tests__/server-client-boundary-static-guard.test.ts.

export type TabId = 'all' | 'drafts' | 'awaiting_payment' | 'submitting' | 'processing' | 'shipped' | 'errors'

/** WO-106: a ?tab= value the KPI cards can link to; anything else is 'all'. */
export function isTabId(v: unknown): v is TabId {
  return v === 'all' || v === 'drafts' || v === 'awaiting_payment' || v === 'submitting'
    || v === 'processing' || v === 'shipped' || v === 'errors'
}
