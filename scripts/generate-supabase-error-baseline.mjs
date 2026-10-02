// ============================================================
// Generate eslint-baselines/supabase-errors.json — Batch 3
// ============================================================
//
// Runs no-unchecked-supabase-error over the repo with an EMPTY baseline
// and writes every violation it finds, keyed by file, enclosing function
// and the trimmed line text (never the line number, which drifts), with
// a count for identical lines in one function.
//
// The baseline only ever shrinks: each Batch 3 area PR fixes or marks its
// sites and regenerates this file; the last PR deletes it and the skip
// logic. Do not regenerate it to make a NEW violation pass — fix it.
//
// Usage: node scripts/generate-supabase-error-baseline.mjs

import { ESLint } from 'eslint'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { relative, sep, dirname } from 'node:path'

const OUT = 'eslint-baselines/supabase-errors.json'
const RULE = 'supabase/no-unchecked-supabase-error'

// Same scope as eslint.config.mjs (which registers the plugin there),
// with the baseline emptied.
const eslint = new ESLint({
  overrideConfig: {
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.{ts,mts,js,mjs}'],
    ignores: ['**/__tests__/**', '**/*.test.{ts,tsx}'],
    rules: { [RULE]: ['error', { baseline: [] }] },
  },
})
const results = await eslint.lintFiles(['.'])

const counts = new Map()
for (const r of results) {
  const messages = r.messages.filter(m => m.ruleId === RULE && m.messageId !== 'missingReason')
  if (messages.length === 0) continue
  const lines = readFileSync(r.filePath, 'utf8').split(/\r?\n/)
  const file = relative(process.cwd(), r.filePath).split(sep).join('/')
  for (const m of messages) {
    const fn = /\(in (.+?)\)/.exec(m.message)?.[1] ?? '<module>'
    const line = (lines[m.line - 1] ?? '').trim()
    const key = JSON.stringify([file, fn, line])
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
}

const entries = [...counts.entries()]
  .map(([key, count]) => {
    const [file, fn, line] = JSON.parse(key)
    return { file, function: fn, line, count }
  })
  .sort((a, b) => a.file.localeCompare(b.file) || a.function.localeCompare(b.function) || a.line.localeCompare(b.line))

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({
  rule: RULE,
  note: 'Existing unchecked Supabase errors, skipped by the rule until fixed. This file only shrinks. See scripts/generate-supabase-error-baseline.mjs.',
  total: entries.reduce((n, e) => n + e.count, 0),
  entries,
}, null, 2) + '\n')

console.log(`${OUT}: ${entries.reduce((n, e) => n + e.count, 0)} violations in ${new Set(entries.map(e => e.file)).size} files`)
