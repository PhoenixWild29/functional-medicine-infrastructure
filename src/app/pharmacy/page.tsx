import { redirect } from 'next/navigation'

// /pharmacy: the portal is the onboarding wizard for now.
export default function PharmacyHome() {
  redirect('/pharmacy/onboarding')
}
