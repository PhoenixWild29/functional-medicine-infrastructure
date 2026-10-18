// /get-started: sign up without an invite (public; see middleware).

import { GetStartedForm } from './_components/get-started-form'

export const metadata = { title: 'Get started | CompoundIQ', referrer: 'no-referrer' as const }

export default function GetStartedPage() {
  return <GetStartedForm />
}
