/**
 * In-app Help pages: /help lists every topic; /help/<slug> renders the
 * topic with one h1 and an h2 per section; an unknown topic is not found.
 * axe (WCAG 2.0/2.1 A and AA) on the index and every topic. The Help link
 * component points at its topic.
 */

import { render, screen, within } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import HelpPage from '../page'
import HelpTopicPage, { generateStaticParams } from '../[slug]/page'
import { HelpLink } from '@/components/help-link'
import { HELP_TOPICS } from '@/lib/help/topics'

jest.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
}))

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
const violations = async (el: Element) => (await axe(el)).violations.map(v => v.id)

describe('/help', () => {
  it('lists every topic as a link, under one h1', async () => {
    const { container } = render(<HelpPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Help' })).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Help topics' })
    for (const t of HELP_TOPICS) {
      expect(within(list).getByRole('link', { name: new RegExp(t.title) })).toHaveAttribute('href', `/help/${t.slug}`)
    }
    expect(await violations(container)).toEqual([])
  })
})

describe('/help/<slug>', () => {
  it('pre-renders every topic', () => {
    expect(generateStaticParams()).toEqual(HELP_TOPICS.map(t => ({ slug: t.slug })))
  })

  it.each(HELP_TOPICS.map(t => [t.slug, t] as const))('%s renders its title, sections and steps', async (slug, topic) => {
    const { container } = render(await HelpTopicPage({ params: Promise.resolve({ slug }) }))
    expect(screen.getByRole('heading', { level: 1, name: topic.title })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(topic.sections.map(s => s.heading))
    expect(screen.getByRole('link', { name: 'All help topics' })).toHaveAttribute('href', '/help')
    for (const step of topic.sections.flatMap(s => s.steps)) expect(screen.getByText(step)).toBeInTheDocument()
    expect(await violations(container)).toEqual([])
  })

  it('an unknown topic is not found', async () => {
    await expect(HelpTopicPage({ params: Promise.resolve({ slug: 'nope' }) })).rejects.toThrow('NOT_FOUND')
  })
})

describe('HelpLink', () => {
  it('links to the topic, labelled Help', () => {
    render(<HelpLink topic="write-and-sign" />)
    expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute('href', '/help/write-and-sign')
  })
})
