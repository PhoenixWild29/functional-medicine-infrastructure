import { cn } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────
// Skeleton Loading System — WO-70
//
// Usage:
//   <SkeletonCard />          — metric card placeholder
//   <SkeletonTableRow />      — table row placeholder (repeat 5–10x)
//   <SkeletonKanbanCard />    — kanban card placeholder
//   <SkeletonText lines={3} /> — text block placeholder
//
// Rules:
//   - Show immediately on mount before data fetch completes
//   - Never show a blank screen during loading
//   - Remove the moment real data is available
// ─────────────────────────────────────────────────────────────

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  )
}

/** Placeholder for a metric/stat card */
function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-xl border border-border bg-card p-5 shadow-sm', className)}>
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
      <Skeleton className="mt-4 h-8 w-32" />
      <Skeleton className="mt-2 h-3 w-40" />
    </div>
  )
}

/** Placeholder for a single table row — repeat 5–10x */
function SkeletonTableRow({ cols = 7 }: { cols?: number }) {
  return (
    <tr aria-hidden>
      {Array.from({ length: cols }, (_, i) => (
        <td key={i} className="px-3 py-3">
          <Skeleton
            className="h-4"
            style={{ width: `${50 + (i * 17) % 45}%` }}
          />
        </td>
      ))}
    </tr>
  )
}

/** Placeholder for a kanban card */
function SkeletonKanbanCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-xl border border-border bg-card p-3 shadow-sm', className)}>
      <Skeleton className="h-3.5 w-3/4" />
      <Skeleton className="mt-2 h-3 w-1/2" />
      <div className="mt-3 flex items-center gap-2">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  )
}

/** Placeholder for a text block */
function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  const widths = ['w-full', 'w-5/6', 'w-4/5', 'w-3/4', 'w-2/3']
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-4', widths[i % widths.length])} />
      ))}
    </div>
  )
}

export { Skeleton, SkeletonCard, SkeletonTableRow, SkeletonKanbanCard, SkeletonText }
