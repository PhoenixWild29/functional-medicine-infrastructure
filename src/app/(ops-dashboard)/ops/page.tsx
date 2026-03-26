import { redirect, RedirectType } from 'next/navigation'

// Default ops route — permanent redirect to pipeline view (308)
export default function OpsIndexPage() {
  redirect('/ops/pipeline', RedirectType.replace)
}
