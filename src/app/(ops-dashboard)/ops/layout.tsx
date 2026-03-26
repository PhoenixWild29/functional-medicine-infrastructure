// ============================================================
// Ops Dashboard Layout — WO-33
// ============================================================
// Renders the navigation shell shared by all ops sub-features.
// Auth is enforced by the parent (ops-dashboard) layout.tsx.
// REQ-OAS-011: HIPAA 30-minute inactivity timeout.

import { HipaaTimeout } from '@/components/hipaa-timeout'
import { OpsNav } from './_components/ops-nav'

export const metadata = {
  title: 'Ops Dashboard | CompoundIQ',
}

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <HipaaTimeout />
      <OpsNav />
      <div className="mx-auto max-w-screen-2xl px-4 py-6">
        {children}
      </div>
    </>
  )
}
