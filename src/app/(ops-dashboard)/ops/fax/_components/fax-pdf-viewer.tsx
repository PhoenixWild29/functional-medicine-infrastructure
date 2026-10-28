'use client'

// ============================================================
// Inbound fax PDF viewer (Issue Log 72)
// ============================================================
//
// Inbound faxes live only in Documo. "Open fax" asks the ops-only
// GET /api/ops/fax/[faxId]/pdf, which fetches the PDF from Documo and
// records the view in the PHI access log, then shows it inline. The PDF is
// held as a blob URL for this viewer only and released when it closes.
// Any failure is one plain sentence; the route's body is never shown.

import { useEffect, useRef, useState } from 'react'

const MESSAGES: Record<number, string> = {
  404: 'This fax is no longer available.',
  403: 'Only ops admins can open faxes.',
  401: 'Your session has ended. Sign in again to open faxes.',
  429: 'Too many faxes opened in a short time. Wait a few minutes and try again.',
}
const FAILED = 'The fax could not be opened right now. Try again in a few minutes.'

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'open'; url: string }
  | { kind: 'error'; message: string }

export function FaxPdfViewer({ faxId, pdfUrl }: { faxId: string; pdfUrl: string }) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const blobUrl = useRef<string | null>(null)

  useEffect(() => () => {
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current)
  }, [])

  async function open() {
    setState({ kind: 'loading' })
    try {
      const res = await fetch(pdfUrl, { credentials: 'same-origin', cache: 'no-store' })
      if (!res.ok) {
        setState({ kind: 'error', message: MESSAGES[res.status] ?? FAILED })
        return
      }
      const url = URL.createObjectURL(await res.blob())
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current)
      blobUrl.current = url
      setState({ kind: 'open', url })
    } catch {
      setState({ kind: 'error', message: FAILED })
    }
  }

  return (
    <div className="space-y-2">
      {state.kind !== 'open' && (
        <button
          type="button"
          onClick={open}
          disabled={state.kind === 'loading'}
          aria-busy={state.kind === 'loading'}
          className="flex w-full items-center justify-center gap-1.5 rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          Open fax
        </button>
      )}
      {state.kind === 'error' && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">{state.message}</p>
      )}
      {state.kind === 'open' && (
        <iframe
          src={state.url}
          title={`Fax ${faxId.slice(0, 8)}`}
          className="h-[70vh] w-full rounded border border-border"
        />
      )}
    </div>
  )
}
