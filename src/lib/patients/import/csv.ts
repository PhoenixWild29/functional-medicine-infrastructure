// ============================================================
// CSV parsing for the patient import (Patient Intake PR 5)
// ============================================================
//
// RFC 4180: cells separated by commas; a cell in double quotes may hold
// commas, line breaks and doubled quotes (""). CRLF or LF line endings, a
// UTF-8 byte-order mark, and blank lines are tolerated. An unterminated
// quote is refused rather than guessed at.
//
// Parsed on the server from the uploaded file; the raw file is never
// stored. Plain module (no I/O).

import { MAX_REQUEST_BYTES } from '@/lib/uploads/limits'

/** 4 MB: the file goes through a Vercel Function (lib/uploads/limits). */
export const MAX_IMPORT_BYTES = MAX_REQUEST_BYTES
export const MAX_IMPORT_ROWS = 5000
export const MAX_CELL_LENGTH = 500

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CsvParseError'
  }
}

export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  let i = 0

  const endRow = () => {
    row.push(cell)
    cell = ''
    // A blank line (one empty or whitespace-only cell) is skipped.
    if (!(row.length === 1 && row[0]!.trim() === '')) rows.push(row)
    row = []
  }

  while (i < text.length) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue }
        inQuotes = false
        i++
        continue
      }
      cell += ch
      i++
      continue
    }
    if (ch === '"' && cell === '') { inQuotes = true; i++; continue }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue }
    if (ch === '\r' && text[i + 1] === '\n') { endRow(); i += 2; continue }
    if (ch === '\n' || ch === '\r') { endRow(); i++; continue }
    cell += ch
    i++
  }
  if (inQuotes) throw new CsvParseError('A quoted cell is never closed.')
  if (cell !== '' || row.length > 0) endRow()
  return rows
}
