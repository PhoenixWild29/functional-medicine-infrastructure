// ─────────────────────────────────────────────────────────────
// Notification Helpers — WO-70
//
// Standard toast patterns used across all surfaces.
// Wraps Sonner's toast API with consistent call signatures.
//
// Usage:
//   notify.success('Payment link sent to patient')
//   notify.error('Reroute failed', 'Pharmacy adapter is offline')
//   notify.warning('SLA breach — Order #abc123')
//   const id = notify.loading('Submitting...')
//   notify.promise(fetchFn(), { loading: '...', success: '...', error: '...' })
// ─────────────────────────────────────────────────────────────

import { toast } from 'sonner'

export const notify = {
  success: (msg: string) =>
    toast.success(msg),

  error: (msg: string, detail?: string) =>
    toast.error(msg, { description: detail }),

  warning: (msg: string) =>
    toast.warning(msg),

  info: (msg: string) =>
    toast.info(msg),

  /** Returns a toast ID that can be passed to toast.dismiss(id) */
  loading: (msg: string) =>
    toast.loading(msg),

  promise: <T>(
    promise: Promise<T>,
    msgs: { loading: string; success: string; error: string },
  ) => toast.promise(promise, msgs),

  dismiss: (id?: string | number) => toast.dismiss(id),
}
