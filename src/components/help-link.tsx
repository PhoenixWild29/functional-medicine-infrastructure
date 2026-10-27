// A small "Help" link to one /help topic, for page headers (the Rx
// builder, the treatment plan steps). Plain link, same tab.

import Link from 'next/link'
import { HelpCircle } from 'lucide-react'

export function HelpLink({ topic, label = 'Help' }: { topic: string; label?: string }) {
  return (
    <Link
      href={`/help/${topic}`}
      className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 underline underline-offset-2 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-blue-300 dark:hover:text-blue-200"
      data-testid={`help-link-${topic}`}
    >
      <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </Link>
  )
}
