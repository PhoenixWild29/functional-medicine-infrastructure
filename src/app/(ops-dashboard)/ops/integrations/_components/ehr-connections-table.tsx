// Ops: every clinic's EHR sync (Keragon) connection, read-only.

import type { ConnectionView } from '@/lib/integrations/keragon/connection'
import { CONNECTION_STATUS_LABEL, errorText } from '@/lib/integrations/keragon/labels'

type Row = ConnectionView & { clinicId: string; clinicName: string }
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US') : 'Never')

export function EhrConnectionsTable({ connections }: { connections: Row[] }) {
  if (connections.length === 0) return <p className="text-sm text-foreground">No clinic has connected an EHR yet.</p>
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-3xl text-left text-sm">
        <caption className="sr-only">EHR sync connections</caption>
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground dark:text-slate-300">
          <tr>
            <th scope="col" className="px-3 py-2">Clinic</th>
            <th scope="col" className="px-3 py-2">Status</th>
            <th scope="col" className="px-3 py-2">Last sync</th>
            <th scope="col" className="px-3 py-2">Last event</th>
            <th scope="col" className="px-3 py-2">Last error</th>
          </tr>
        </thead>
        <tbody>
          {connections.map(c => (
            <tr key={c.connectionId ?? c.clinicId} className="border-t border-border align-top">
              <td className="px-3 py-2 text-foreground">{c.clinicName}</td>
              <td className="px-3 py-2 text-foreground">{CONNECTION_STATUS_LABEL[c.status] ?? c.status}</td>
              <td className="px-3 py-2 text-foreground">{when(c.lastSuccessAt)}</td>
              <td className="px-3 py-2 text-foreground">{when(c.lastEventAt)}</td>
              <td className="px-3 py-2 text-foreground">{c.lastErrorCode ? `${errorText(c.lastErrorCode)} (${when(c.lastErrorAt)})` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
