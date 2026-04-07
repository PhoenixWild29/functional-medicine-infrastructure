// ============================================================
// New Prescription Layout — WO-80
// ============================================================
//
// Wraps all /new-prescription/* pages with the PrescriptionSession
// context provider. This ensures patient, provider, and prescription
// list state persists across route navigations within the wizard.

import { PrescriptionSessionProvider } from './_context/prescription-session'

export default function NewPrescriptionLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <PrescriptionSessionProvider>
      {children}
    </PrescriptionSessionProvider>
  )
}
