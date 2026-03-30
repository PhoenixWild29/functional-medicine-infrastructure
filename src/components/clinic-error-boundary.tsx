'use client'

// ============================================================
// Clinic App Error Boundary — WO-71
//
// Catches unexpected runtime errors in the clinic app subtree.
// Displays a user-friendly fallback with Sentry event ID for support.
// ============================================================

import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  eventId:  string | null
}

export class ClinicErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, eventId: null }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true, eventId: null }
  }

  componentDidCatch(error: Error) {
    // Log to Sentry if available (injected by Sentry SDK)
    const sentry = (globalThis as Record<string, unknown>)['Sentry'] as {
      captureException?: (e: Error) => string
    } | undefined
    const eventId = sentry?.captureException?.(error) ?? null
    this.setState({ eventId })
    console.error('[ClinicErrorBoundary]', error)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-sm text-center space-y-4">
          <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-full bg-destructive/10">
            <svg className="h-6 w-6 text-destructive" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              An unexpected error occurred. Try refreshing the page.
            </p>
          </div>

          {this.state.eventId && (
            <p className="text-xs text-muted-foreground font-mono">
              Support ID: {this.state.eventId}
            </p>
          )}

          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Refresh page
          </button>
        </div>
      </div>
    )
  }
}
