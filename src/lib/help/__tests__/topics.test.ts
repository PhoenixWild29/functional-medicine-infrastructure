/**
 * @jest-environment node
 *
 * In-app Help (/help): every button or field a help page names must exist
 * in the file that renders it, so renaming a label in the app fails here
 * instead of leaving the help pointing at nothing. Plus the content rules:
 * the ten task pages, unique slugs, plain copy, no external links, and
 * the contact page.
 */

import fs from 'node:fs'
import path from 'node:path'
import { HELP_CONTACT, HELP_TOPICS, helpTopic } from '../topics'

const SRC = path.join(process.cwd(), 'src')

describe('help labels exist in the app', () => {
  const cases = HELP_TOPICS.flatMap(t => t.labels.map(l => [t.slug, l.text, l.file] as const))

  it('names at least 60 labels across the topics', () => {
    expect(cases.length).toBeGreaterThanOrEqual(60)
  })

  it.each(cases)('%s: "%s" is in src/%s', (_slug, text, file) => {
    const full = path.join(SRC, file)
    expect(fs.existsSync(full)).toBe(true)
    expect(fs.readFileSync(full, 'utf8')).toContain(text)
  })
})

describe('help content', () => {
  it('has the task pages, in order, each with a unique slug', () => {
    expect(HELP_TOPICS.map(t => t.slug)).toEqual([
      'add-a-patient', 'write-and-sign', 'favorites', 'treatment-plans', 'payment-links',
      'order-status', 'team', 'settings', 'contact',
    ])
    expect(new Set(HELP_TOPICS.map(t => t.slug)).size).toBe(HELP_TOPICS.length)
  })

  it('leaves out saved clinical difference statements (not in this base yet)', () => {
    const all = JSON.stringify(HELP_TOPICS).toLowerCase()
    expect(all).not.toContain('saved statement')
  })

  it.each(HELP_TOPICS.map(t => [t.slug, t] as const))('%s: has sections with steps, no external links, no em dashes', (_slug, topic) => {
    expect(topic.title.length).toBeGreaterThan(0)
    expect(topic.summary.length).toBeGreaterThan(0)
    expect(topic.sections.length).toBeGreaterThan(0)
    for (const s of topic.sections) expect(s.steps.length).toBeGreaterThan(0)
    const text = JSON.stringify(topic)
    expect(text).not.toMatch(/https?:\/\//)
    expect(text).not.toContain('—')
  })

  it('every label a topic lists is quoted in its steps (so the list is what the page says)', () => {
    for (const t of HELP_TOPICS) {
      const steps = t.sections.flatMap(s => s.steps).join(' ')
      for (const l of t.labels) {
        // Labels that end in "(" are the start of a counted button, e.g. "Favorites (3)".
        const shown = l.text.endsWith(' (') ? l.text.slice(0, -2) : l.text
        expect(steps).toContain(`"${shown}`)
      }
    }
  })

  it('the contact page says "Contact CompoundIQ" with no address (none is configured)', () => {
    expect(HELP_CONTACT).toBe('Contact CompoundIQ')
    const contact = JSON.stringify(helpTopic('contact'))
    expect(contact).toContain('Contact CompoundIQ')
    expect(contact).not.toMatch(/@|\(\d{3}\)|\d{3}-\d{4}/)
  })

  it('helpTopic finds a slug and nothing else', () => {
    expect(helpTopic('team')?.title).toBe('Team')
    expect(helpTopic('nope')).toBeUndefined()
  })
})
