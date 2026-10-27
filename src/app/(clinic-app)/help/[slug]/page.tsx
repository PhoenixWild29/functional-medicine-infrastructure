// ============================================================
// One help topic: /help/<slug>
// ============================================================
//
// Rendered from src/lib/help/topics.ts. An unknown topic is the clinic
// app's "Page not found".

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { HELP_TOPICS, helpTopic } from '@/lib/help/topics'

export function generateStaticParams() {
  return HELP_TOPICS.map(t => ({ slug: t.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const topic = helpTopic((await params).slug)
  return { title: topic ? `Help: ${topic.title}` : 'Help' }
}

export default async function HelpTopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const topic = helpTopic((await params).slug)
  if (!topic) notFound()

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div>
        <Link
          href="/help"
          className="text-sm font-medium text-blue-700 underline underline-offset-2 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-blue-300 dark:hover:text-blue-200"
        >
          All help topics
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-foreground">{topic.title}</h1>
        <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{topic.summary}</p>
      </div>
      {topic.sections.map((section, i) => {
        const headingId = `help-${topic.slug}-${i}`
        return (
          <section key={section.heading} aria-labelledby={headingId} className="rounded-lg border border-border bg-card p-4">
            <h2 id={headingId} className="text-base font-semibold text-foreground">{section.heading}</h2>
            {section.steps.length > 1 ? (
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-foreground">
                {section.steps.map(step => <li key={step}>{step}</li>)}
              </ol>
            ) : (
              <p className="mt-2 text-sm text-foreground">{section.steps[0]}</p>
            )}
          </section>
        )
      })}
    </main>
  )
}
