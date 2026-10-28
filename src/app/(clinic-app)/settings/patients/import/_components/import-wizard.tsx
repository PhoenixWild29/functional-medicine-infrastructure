'use client'

// ============================================================
// Settings > Patients > Import (Patient Intake PR 5)
// ============================================================
//
//   1. Upload a .csv: parsed on the server, never stored.
//   2. Match the columns: detected from the header row; every field can be
//      changed. Required fields are marked.
//   3. Review before importing: every row checked (counts, each row's
//      problems, possible duplicates). Rows that need fixing cannot be
//      included; possible duplicates start excluded and can be included
//      deliberately. Nothing is written until Import.
//   4. Import: one request, all or nothing.
//
// WCAG 2.1 AA: labelled controls, a captioned table, errors and results
// announced, focus moved to each step's heading. Colours are AA pairs
// (text-foreground on tints; status chips on their own backgrounds).

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { IMPORT_FIELDS, mappingErrors, type ColumnMapping, type ImportField } from '@/lib/patients/import/mapping'
import { MAX_REQUEST_BYTES, jsonBodyTooLarge } from '@/lib/uploads/limits'

// 4 MB: Vercel refuses request bodies over about 4.5 MB (lib/uploads/limits).
const TOO_LARGE_FILE = 'The file is larger than 4 MB. Split it into smaller files.'
const TOO_LARGE_ROWS = 'These rows are more than 4 MB to send at once. Split the file into smaller files and import each one.'

type Step = 'upload' | 'map' | 'review' | 'done'

interface Parsed {
  fileName: string
  headers: string[]
  rows: string[][]
}

interface RowResult {
  index: number
  status: 'ready' | 'error' | 'duplicate'
  errors: Array<{ field: string; message: string }>
  patient: { firstName: string; lastName: string; dateOfBirth: string; phone?: string | null; email?: string | null } | null
  duplicate?:
    | { kind: 'existing'; patientId: string; name: string; matchedOn: string }
    | { kind: 'file'; otherRow: number; name: string; matchedOn: string }
}

interface Review {
  counts: { ready: number; error: number; duplicate: number; total: number }
  rows: RowResult[]
}

const MATCHED_ON: Record<string, string> = {
  mobile_and_date_of_birth: 'same mobile and date of birth',
  name_and_date_of_birth: 'same name and date of birth',
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const csvRow = (index: number) => index + 2   // the header is row 1

const primaryButton = 'rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButton = 'rounded-md border border-slate-500 px-4 py-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return res.json().catch(() => ({})) as Promise<Record<string, unknown>>
}

export function ImportWizard() {
  const uid = useId()
  const id = (k: string) => `${uid}-${k}`
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [review, setReview] = useState<Review | null>(null)
  const [included, setIncluded] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileError, setFileError] = useState(false)
  const [imported, setImported] = useState<number | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const firstRender = useRef(true)

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    headingRef.current?.focus()
  }, [step])

  async function upload() {
    setError(null)
    setFileError(false)
    if (!file) {
      setFileError(true)
      setError('Choose a .csv file to upload.')
      return
    }
    if (file.size > MAX_REQUEST_BYTES) {
      setFileError(true)
      setError(TOO_LARGE_FILE)
      return
    }
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/patients/import/parse', { method: 'POST', body: form })
      const body = await readJson(res)
      if (!res.ok) {
        setFileError(true)
        setError(typeof body['error'] === 'string' ? body['error'] : 'The file could not be read.')
        return
      }
      const p = body as unknown as Parsed & { suggestedMapping: ColumnMapping }
      setParsed({ fileName: p.fileName, headers: p.headers, rows: p.rows })
      setMapping(p.suggestedMapping ?? {})
      setStep('map')
    } catch {
      setError('The file could not be uploaded. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function check() {
    if (!parsed) return
    setError(null)
    const problems = mappingErrors(mapping, parsed.headers.length)
    if (problems.length) {
      setError(problems.join(' '))
      return
    }
    const checkBody = { headers: parsed.headers, rows: parsed.rows, mapping }
    if (jsonBodyTooLarge(checkBody)) {
      setError(TOO_LARGE_ROWS)
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/patients/import/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checkBody),
      })
      const body = await readJson(res)
      if (!res.ok) {
        setError(typeof body['error'] === 'string' ? body['error'] : 'The rows could not be checked. Try again.')
        return
      }
      const r = body as unknown as Review
      setReview(r)
      setIncluded(new Set(r.rows.filter(x => x.status === 'ready').map(x => x.index)))
      setStep('review')
    } catch {
      setError('The rows could not be checked. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function runImport() {
    if (!parsed || !review) return
    setError(null)
    setBusy(true)
    try {
      const excluded = review.rows.filter(r => !included.has(r.index)).map(r => r.index)
      const confirmDuplicates = review.rows.filter(r => r.status === 'duplicate' && included.has(r.index)).map(r => r.index)
      const importBody = { fileName: parsed.fileName, headers: parsed.headers, rows: parsed.rows, mapping, excluded, confirmDuplicates }
      if (jsonBodyTooLarge(importBody)) {
        setError(TOO_LARGE_ROWS)
        return
      }
      const res = await fetch('/api/patients/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(importBody),
      })
      const body = await readJson(res)
      if (res.status === 201) {
        setImported(typeof body['imported'] === 'number' ? body['imported'] : included.size)
        setStep('done')
        return
      }
      if (res.status === 422 && Array.isArray(body['rows'])) setReview(body as unknown as Review)
      setError(typeof body['error'] === 'string' ? body['error'] : 'The patients could not be imported. Nothing was saved; try again.')
    } catch {
      setError('The patients could not be imported. Check your connection and try again; nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  function restart() {
    setStep('upload'); setFile(null); setParsed(null); setMapping({}); setReview(null)
    setIncluded(new Set()); setError(null); setFileError(false); setImported(null)
  }

  const toggle = (index: number) => setIncluded(prev => {
    const next = new Set(prev)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    return next
  })

  const alert = error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Import patients</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Add existing patients from a CSV export of your EHR or a spreadsheet. Every row is checked before anything is saved.
          Imported patients are not signed up for texts.
        </p>
      </div>

      <section aria-labelledby={id('step')} className="space-y-4 rounded-lg border border-border bg-card p-6">
        <h2 id={id('step')} ref={headingRef} tabIndex={-1} className="text-base font-semibold text-foreground focus-visible:outline-hidden">
          {step === 'upload' ? 'Choose a file' : step === 'map' ? 'Match the columns' : step === 'review' ? 'Review before importing' : 'Import complete'}
        </h2>

        {step === 'upload' && (
          <form className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); void upload() }}>
            {alert}
            <div>
              <label htmlFor={id('file')} className="block text-sm font-medium text-foreground">CSV file</label>
              <p id={id('file-hint')} className="text-xs text-muted-foreground">A .csv file up to 4 MB and 5,000 patients, with a header row.</p>
              <input
                id={id('file')}
                type="file"
                accept=".csv,text/csv"
                onChange={e => { setFile(e.target.files?.[0] ?? null); setFileError(false) }}
                aria-invalid={fileError || undefined}
                aria-describedby={id('file-hint')}
                className="mt-1 block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-slate-500 file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
              />
            </div>
            <button type="submit" disabled={busy} className={primaryButton}>
              {busy ? 'Uploading…' : 'Upload and check columns'}
            </button>
          </form>
        )}

        {step === 'map' && parsed && (
          <form className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); void check() }}>
            {alert}
            <p className="text-sm text-foreground">
              {parsed.fileName}: {plural(parsed.rows.length, 'patient row', 'patient rows')}. Choose which column holds each field.
              A patient needs a mobile or an email.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {IMPORT_FIELDS.map(f => (
                <div key={f.key}>
                  <label htmlFor={id(`map-${f.key}`)} className="block text-sm font-medium text-foreground">
                    {f.label}{f.required ? ' (required)' : ''}
                  </label>
                  <select
                    id={id(`map-${f.key}`)}
                    value={mapping[f.key] === undefined ? '' : String(mapping[f.key])}
                    onChange={e => setMapping(prev => {
                      const next = { ...prev }
                      if (e.target.value === '') delete next[f.key as ImportField]
                      else next[f.key as ImportField] = Number(e.target.value)
                      return next
                    })}
                    className="mt-1 block w-full rounded-md border border-slate-500 bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">Not in the file</option>
                    {parsed.headers.map((h, i) => <option key={i} value={String(i)}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={busy} className={primaryButton}>{busy ? 'Checking…' : 'Check rows'}</button>
              <button type="button" onClick={restart} className={secondaryButton}>Choose another file</button>
            </div>
          </form>
        )}

        {step === 'review' && parsed && review && (
          <div className="space-y-4">
            {alert}
            <p className="text-sm text-foreground" data-testid="import-counts">
              {plural(review.counts.ready, 'ready', 'ready')}, {review.counts.error === 1 ? '1 needs fixing' : `${review.counts.error} need fixing`},{' '}
              {plural(review.counts.duplicate, 'possible duplicate', 'possible duplicates')}, of {plural(review.counts.total, 'row', 'rows')}.
            </p>
            <p className="text-sm text-foreground">
              Rows that need fixing cannot be imported: correct them in the file and upload it again. Possible duplicates are
              left out unless you include them; patients are never merged.
            </p>
            <div role="region" aria-label="Rows to import" tabIndex={0} className="max-h-112 overflow-auto rounded-md border border-border focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Rows in {parsed.fileName}</caption>
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border">
                    <th scope="col" className="px-3 py-2 font-medium text-foreground">Include</th>
                    <th scope="col" className="px-3 py-2 font-medium text-foreground">Row</th>
                    <th scope="col" className="px-3 py-2 font-medium text-foreground">Patient</th>
                    <th scope="col" className="px-3 py-2 font-medium text-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {review.rows.map(r => {
                    const row = csvRow(r.index)
                    const raw = parsed.rows[r.index] ?? []
                    const name = r.patient
                      ? `${r.patient.lastName}, ${r.patient.firstName}`
                      : [raw[mapping.lastName ?? -1], raw[mapping.firstName ?? -1]].filter(Boolean).join(', ') || 'No name'
                    return (
                      <tr key={r.index} className="border-b border-border last:border-0 align-top">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label={`Include row ${row}`}
                            checked={included.has(r.index)}
                            disabled={r.status === 'error'}
                            onChange={() => toggle(r.index)}
                            className="h-4 w-4 accent-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                          />
                        </td>
                        <td className="px-3 py-2 text-foreground">{row}</td>
                        <td className="px-3 py-2 text-foreground">
                          <span className="font-medium">{name}</span>
                          {r.patient && <span className="block text-xs text-foreground">DOB {r.patient.dateOfBirth}</span>}
                        </td>
                        <td className="px-3 py-2">
                          {r.status === 'ready' && (
                            <span className="inline-flex rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-900">Ready</span>
                          )}
                          {r.status === 'error' && (
                            <ul className="list-disc space-y-0.5 pl-4 text-xs text-red-700">
                              {r.errors.map((e, i) => <li key={i}>{e.message}</li>)}
                            </ul>
                          )}
                          {r.status === 'duplicate' && r.duplicate && (
                            <span className="inline-flex rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-950">
                              {r.duplicate.kind === 'existing'
                                ? `Possible duplicate of ${r.duplicate.name} (${MATCHED_ON[r.duplicate.matchedOn] ?? 'possible match'})`
                                : `Possible duplicate of row ${csvRow(r.duplicate.otherRow)} in this file (${MATCHED_ON[r.duplicate.matchedOn] ?? 'possible match'})`}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void runImport()} disabled={busy || included.size === 0} className={primaryButton}>
                {busy ? 'Importing…' : `Import ${plural(included.size, 'patient', 'patients')}`}
              </button>
              <button type="button" onClick={() => { setError(null); setStep('map') }} className={secondaryButton}>Back to columns</button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-4">
            <p role="status" className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
              Imported {plural(imported ?? 0, 'patient', 'patients')}.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href="/new-prescription" className={primaryButton}>Start a prescription</Link>
              <button type="button" onClick={restart} className={secondaryButton}>Import another file</button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
