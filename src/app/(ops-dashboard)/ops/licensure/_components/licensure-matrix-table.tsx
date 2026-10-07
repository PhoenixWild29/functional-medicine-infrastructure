// ============================================================
// Licensure matrix table — Compliance C5
// ============================================================
//
// Pharmacy x state. Each cell: expiry, license type and sterile scope.
// Flagged: expiring within 30 days (amber), expired (red), inactive
// (grey), sterile scope not recorded (amber note: sterile products cannot
// route to that pharmacy in that state until it is recorded).

import type { LicensureMatrix, MatrixCell } from '@/lib/compliance/pharmacy-licensure'

const LICENSE_TYPE_LABEL: Record<string, string> = {
  resident_pharmacy:    'Resident',
  nonresident_pharmacy: 'Non-resident',
  outsourcing_facility: 'Outsourcing facility',
}

const STATUS_CLASS: Record<MatrixCell['status'], string> = {
  valid:    'border-emerald-200 bg-emerald-50 text-emerald-900',
  expiring: 'border-amber-300 bg-amber-50 text-amber-900',
  expired:  'border-red-300 bg-red-50 text-red-900',
  inactive: 'border-border bg-muted text-muted-foreground',
}

function statusLine(cell: MatrixCell): string {
  switch (cell.status) {
    case 'expired':  return 'Expired'
    case 'inactive': return 'Inactive'
    case 'expiring': return cell.daysLeft === 0 ? 'Expires today' : `Expires in ${cell.daysLeft} day${cell.daysLeft === 1 ? '' : 's'}`
    default:         return 'Valid'
  }
}

function sterileLine(sterile: boolean | null): string {
  if (sterile === true) return 'Sterile'
  if (sterile === false) return 'Non-sterile'
  return 'Sterile scope not recorded'
}

export function LicensureMatrixTable({ matrix }: { matrix: LicensureMatrix }) {
  const { summary } = matrix
  return (
    <div className="space-y-4">
      <p data-testid="licensure-summary" className="text-sm text-muted-foreground">
        {summary.expiring} expiring within 30 days · {summary.expired} expired · {summary.sterileUnrecorded} with sterile scope not recorded
        <span className="block text-xs">
          As of {matrix.today} (UTC). A sterile product (injectable, pellet) cannot route to a pharmacy whose sterile scope
          in the patient&apos;s state is not recorded, unless it is a 503B outsourcing facility.
        </span>
      </p>

      {matrix.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active pharmacies.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th scope="col" className="sticky left-0 bg-muted/50 px-3 py-2 text-left font-semibold">Pharmacy</th>
                {matrix.states.map(state => (
                  <th key={state} scope="col" className="px-3 py-2 text-left font-semibold">{state}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map(row => (
                <tr key={row.pharmacyId} data-testid={`licensure-row-${row.pharmacyId}`} className="border-t border-border align-top">
                  <th scope="row" className="sticky left-0 bg-card px-3 py-2 text-left font-medium">
                    <span className="block">{row.pharmacyName}</span>
                    <span className="block text-muted-foreground">{row.facilityType ?? '503A/503B not recorded'}</span>
                  </th>
                  {matrix.states.map(state => {
                    const cell = row.cells[state]
                    if (!cell) {
                      return (
                        <td key={state} data-testid={`licensure-cell-${row.pharmacyId}-${state}`} className="px-3 py-2 text-muted-foreground">
                          Not licensed
                        </td>
                      )
                    }
                    return (
                      <td key={state} className="px-2 py-2">
                        <div
                          data-testid={`licensure-cell-${row.pharmacyId}-${state}`}
                          data-status={cell.status}
                          className={`rounded-md border px-2 py-1 ${STATUS_CLASS[cell.status]}`}
                        >
                          <span className="block font-medium">{cell.expirationDate ?? 'No expiry on record'}</span>
                          <span className="block">{statusLine(cell)}</span>
                          <span className="block">{cell.licenseType ? (LICENSE_TYPE_LABEL[cell.licenseType] ?? cell.licenseType) : 'Type not recorded'}</span>
                          <span className={`block ${cell.sterile == null ? 'font-medium text-amber-800' : ''}`}>{sterileLine(cell.sterile)}</span>
                          {cell.licenseNumber && <span className="block font-mono opacity-70">{cell.licenseNumber}</span>}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
