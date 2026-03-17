'use client'

import { useEffect } from 'react'

export default function PatientCheckoutError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
      <h2 className="text-center text-lg font-semibold">Something went wrong</h2>
      <p className="text-center text-sm text-muted-foreground">
        Please refresh the page or contact your clinic.
      </p>
      <button
        onClick={reset}
        className="rounded-md bg-primary px-6 py-2 text-sm text-primary-foreground"
      >
        Try again
      </button>
    </div>
  )
}
