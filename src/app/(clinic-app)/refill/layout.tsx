// ============================================================
// Refill Layout — WO-106
// ============================================================
//
// /refill writes into the same prescription session the builder uses:
// the refilled lines land as sibling drafts and continue to Review,
// where WO-102 charges shipping once per pharmacy across them. Same
// provider as /new-prescription/*, same sessionStorage key, so the
// session carries across the route change.

import { PrescriptionSessionProvider } from '../new-prescription/_context/prescription-session'

export default function RefillLayout({ children }: { children: React.ReactNode }) {
  return (
    <PrescriptionSessionProvider>
      {children}
    </PrescriptionSessionProvider>
  )
}
