'use client'

// The wizard's accept form for one agreement; back to the list once recorded.

import { useRouter } from 'next/navigation'
import { AgreementAcceptance } from '@/app/pharmacy/onboarding/_components/steps'
import type { AgreementView } from '@/lib/pharmacy-onboarding/application'

export function ReviewAndAccept({ agreementKey, view }: { agreementKey: 'baa' | 'pharmacy_terms'; view: AgreementView }) {
  const router = useRouter()
  const back = () => { router.push('/pharmacy/agreements'); router.refresh() }
  return (
    <AgreementAcceptance
      agreementKey={agreementKey}
      view={view}
      onAccepted={async () => back()}
      onNext={back}
      continueLabel="Back to agreements"
    />
  )
}
