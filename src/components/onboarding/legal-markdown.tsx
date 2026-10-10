// ============================================================
// Render a legal template's Markdown as accessible HTML
// ============================================================
//
// The subset the templates under src/content/legal/ use: '#'/'##'/'###'
// headings, '- ' list items, '> ' blockquotes, '**bold**', a whole line
// in '_emphasis_', and paragraphs. Everything is rendered as React text
// (never dangerouslySetInnerHTML), so the template cannot inject markup.
// Inline underscores are left alone: placeholders such as
// {{COVERED_ENTITY_LEGAL_NAME}} contain them.
//
// Headings start at `headingLevel` (the page's next level) so the outline
// stays in order.

import type { ReactNode } from 'react'

type Block =
  | { kind: 'heading'; depth: number; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'para'; text: string }

function parse(md: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  let list: string[] | null = null
  const flushPara = () => { if (para.length) { blocks.push({ kind: 'para', text: para.join(' ') }); para = [] } }
  const flushList = () => { if (list) { blocks.push({ kind: 'list', items: list }); list = null } }

  for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (!line.trim()) { flushPara(); flushList(); continue }
    if (heading) { flushPara(); flushList(); blocks.push({ kind: 'heading', depth: heading[1]!.length, text: heading[2]! }); continue }
    if (line.startsWith('- ')) { flushPara(); (list ??= []).push(line.slice(2)); continue }
    if (line.startsWith('> ')) { flushPara(); flushList(); blocks.push({ kind: 'quote', text: line.slice(2) }); continue }
    flushList()
    para.push(line)
  }
  flushPara(); flushList()
  return blocks
}

function inline(text: string): ReactNode {
  const whole = /^_(.+)_$/.exec(text)
  if (whole) return <em>{whole[1]}</em>
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) => (/^\*\*[^*]+\*\*$/.test(p) ? <strong key={i}>{p.slice(2, -2)}</strong> : p))
}

export function LegalMarkdown({ text, headingLevel = 4 }: { text: string; headingLevel?: 3 | 4 | 5 }) {
  return (
    <>
      {parse(text).map((b, i) => {
        switch (b.kind) {
          case 'heading': {
            const level = Math.min(6, headingLevel + b.depth - 1)
            const Tag = `h${level}` as 'h3' | 'h4' | 'h5' | 'h6'
            return <Tag key={i} className={b.depth === 1 ? 'text-base font-semibold text-foreground' : 'pt-2 text-sm font-semibold text-foreground'}>{b.text}</Tag>
          }
          case 'list':
            return <ul key={i} className="list-disc space-y-1 pl-5">{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>
          case 'quote':
            return <blockquote key={i} className="border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-amber-900">{inline(b.text)}</blockquote>
          default:
            return <p key={i}>{inline(b.text)}</p>
        }
      })}
    </>
  )
}
