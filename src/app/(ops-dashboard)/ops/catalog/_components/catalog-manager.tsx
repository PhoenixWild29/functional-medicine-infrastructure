'use client'

// ============================================================
// Catalog Manager — WO-37
// ============================================================
//
// REQ-CTM-001: CSV upload with validation (Papa Parse + react-dropzone)
// REQ-CTM-002: Bulk insert via /api/ops/catalog/upload
// REQ-CTM-003: Version history table with delta summaries
// REQ-CTM-004: Side-by-side version comparison
// REQ-CTM-005: Price discrepancy alerting (>10% change)
// REQ-CTM-006: API sync status + manual trigger
// REQ-CTM-007: Normalized catalog view
// REQ-CTM-008: Catalog rollback

import { useState, useMemo, useCallback } from 'react'
import { useQuery, useQueryClient }       from '@tanstack/react-query'
import { useDropzone }                    from 'react-dropzone'
import Papa                               from 'papaparse'
import type {
  CatalogResponse, CatalogItem, CatalogUploadVersion,
  NormalizedEntry, PharmacySyncStatus,
} from '@/app/api/ops/catalog/route'
import type { UploadResult, PriceDiscrepancy } from '@/app/api/ops/catalog/upload/route'

// ── Tab types ─────────────────────────────────────────────────

type ActiveTab = 'catalog' | 'versions' | 'normalized' | 'sync'

// ── Props ─────────────────────────────────────────────────────

interface Props {
  initialData: CatalogResponse
}

// ── Regulatory status config ──────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  ACTIVE:       'bg-emerald-100 text-emerald-700',
  RECALLED:     'bg-red-100 text-red-700',
  DISCONTINUED: 'bg-gray-100 text-gray-500',
  SHORTAGE:     'bg-amber-100 text-amber-700',
}

// ── Component ─────────────────────────────────────────────────

export function CatalogManager({ initialData }: Props) {
  const queryClient = useQueryClient()

  const [activeTab,         setActiveTab]         = useState<ActiveTab>('catalog')
  const [pharmacyFilter,    setPharmacyFilter]    = useState('')
  const [statusFilter,      setStatusFilter]      = useState('')
  const [searchQuery,       setSearchQuery]       = useState('')
  const [uploadPharmacyId,  setUploadPharmacyId]  = useState('')
  const [uploadResult,      setUploadResult]      = useState<UploadResult | null>(null)
  const [uploadError,       setUploadError]       = useState<string | null>(null)
  const [isUploading,       setIsUploading]       = useState(false)
  const [actionError,       setActionError]       = useState<string | null>(null)
  const [comparingVersions, setComparingVersions] = useState<[string, string] | null>(null)
  const [compareSelected,   setCompareSelected]   = useState<string[]>([])
  const [confirmRollback,   setConfirmRollback]   = useState<string | null>(null)
  const [syncingPharmacy,   setSyncingPharmacy]   = useState<string | null>(null)
  const [showManualEntry,   setShowManualEntry]   = useState(false)
  const [manualForm,        setManualForm]        = useState({
    pharmacyId: '', medicationName: '', form: '', dose: '',
    wholesalePrice: '', regulatoryStatus: 'ACTIVE', retailPrice: '', requiresPriorAuth: false,
  })
  const [manualError,       setManualError]       = useState<string | null>(null)
  const [manualSuccess,     setManualSuccess]     = useState<string | null>(null)
  const [isSubmittingManual, setIsSubmittingManual] = useState(false)

  // ── Polling ──────────────────────────────────────────────────
  const { data, isFetching, isError, refetch } = useQuery<CatalogResponse>({
    queryKey:             ['ops-catalog', pharmacyFilter, statusFilter, searchQuery],
    queryFn:              async () => {
      const params = new URLSearchParams()
      if (pharmacyFilter) params.set('pharmacyId', pharmacyFilter)
      if (statusFilter)   params.set('status', statusFilter)
      if (searchQuery)    params.set('search', searchQuery)
      const qs  = params.toString()
      const res = await fetch(`/api/ops/catalog${qs ? `?${qs}` : ''}`)
      if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`)
      return res.json() as Promise<CatalogResponse>
    },
    ...(!pharmacyFilter && !statusFilter && !searchQuery
      ? {
          initialData: initialData,
          ...( initialData.fetchedAt
            ? { initialDataUpdatedAt: new Date(initialData.fetchedAt).getTime() }
            : {}),
        }
      : {}),
    refetchInterval: 60_000,
    staleTime:       30_000,
  })

  const items      = data?.items      ?? []
  const versions   = data?.versions   ?? []
  const normalized = data?.normalized ?? []
  const syncStatus = data?.syncStatus ?? []

  // ── Unique pharmacies for filter/upload dropdowns ────────────
  // NB-04: derive from both items AND upload versions for a complete list
  const pharmacies = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of (initialData.items ?? [])) {
      if (!map.has(item.pharmacyId)) map.set(item.pharmacyId, item.pharmacyName)
    }
    for (const v of (initialData.versions ?? [])) {
      if (!map.has(v.pharmacyId)) map.set(v.pharmacyId, v.pharmacyName)
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [initialData.items, initialData.versions])

  // ── CSV Upload ───────────────────────────────────────────────
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0]
    if (!file) return
    if (!uploadPharmacyId) {
      setUploadError('Select a pharmacy before uploading')
      return
    }

    setUploadError(null)
    setUploadResult(null)

    Papa.parse<Record<string, string>>(file, {
      header:       true,
      skipEmptyLines: true,
      complete: async (results) => {
        const requiredCols = ['medication_name', 'form', 'dose', 'wholesale_price', 'regulatory_status']
        const cols = results.meta.fields ?? []
        const missing = requiredCols.filter(c => !cols.includes(c))
        if (missing.length > 0) {
          setUploadError(`CSV missing required columns: ${missing.join(', ')}`)
          return
        }

        setIsUploading(true)
        try {
          const res = await fetch('/api/ops/catalog/upload', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ pharmacyId: uploadPharmacyId, rows: results.data }),
          })
          const json = await res.json() as UploadResult | { error: string; warnings?: string[] }
          if (!res.ok) {
            setUploadError((json as { error: string }).error ?? 'Upload failed')
          } else {
            setUploadResult(json as UploadResult)
            void queryClient.invalidateQueries({ queryKey: ['ops-catalog'] })
          }
        } catch (err) {
          setUploadError(err instanceof Error ? err.message : 'Upload failed')
        } finally {
          setIsUploading(false)
        }
      },
      error: (err: Error) => {
        setUploadError(`CSV parse error: ${err.message}`)
      },
    })
  }, [uploadPharmacyId, queryClient])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'], 'application/vnd.ms-excel': ['.csv'] },
    maxFiles: 1,
    disabled: isUploading,
  })

  // ── API Sync trigger ──────────────────────────────────────────
  async function handleSync(pharmacyId: string) {
    setSyncingPharmacy(pharmacyId)
    setActionError(null)
    try {
      const res = await fetch(`/api/ops/catalog/sync/${pharmacyId}`, { method: 'POST' })
      const json = await res.json() as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Sync failed')
      void refetch()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncingPharmacy(null)
    }
  }

  // ── Rollback ──────────────────────────────────────────────────
  async function handleRollback(historyId: string, pharmacyId: string) {
    setActionError(null)
    setConfirmRollback(null)
    try {
      const res = await fetch('/api/ops/catalog/rollback', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pharmacyId, targetHistoryId: historyId }),
      })
      const json = await res.json() as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Rollback failed')
      void queryClient.invalidateQueries({ queryKey: ['ops-catalog'] })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Rollback failed')
    }
  }

  // ── Version comparison selector — BLK-06 / REQ-CTM-004 ──────
  function handleToggleCompare(historyId: string) {
    setCompareSelected(prev => {
      if (prev.includes(historyId)) return prev.filter(id => id !== historyId)
      if (prev.length === 2) return [prev[1]!, historyId]  // replace oldest selection
      const next = [...prev, historyId]
      if (next.length === 2) setComparingVersions([next[0]!, next[1]!])
      return next
    })
  }

  // ── Manual entry handler — REQ-CTM-009 ───────────────────────
  async function handleManualEntry(e: React.FormEvent) {
    e.preventDefault()
    setManualError(null)
    setManualSuccess(null)
    if (!manualForm.pharmacyId) { setManualError('Select a pharmacy'); return }
    setIsSubmittingManual(true)
    try {
      const res = await fetch('/api/ops/catalog/item', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          pharmacyId:        manualForm.pharmacyId,
          medicationName:    manualForm.medicationName,
          form:              manualForm.form,
          dose:              manualForm.dose,
          wholesalePrice:    parseFloat(manualForm.wholesalePrice),
          regulatoryStatus:  manualForm.regulatoryStatus,
          retailPrice:       manualForm.retailPrice ? parseFloat(manualForm.retailPrice) : null,
          requiresPriorAuth: manualForm.requiresPriorAuth,
        }),
      })
      const json = await res.json() as { error?: string; itemId?: string }
      if (!res.ok) { setManualError(json.error ?? 'Add failed'); return }
      setManualSuccess(`Item added (ID: ${json.itemId ?? 'unknown'})`)
      setManualForm({ pharmacyId: manualForm.pharmacyId, medicationName: '', form: '', dose: '', wholesalePrice: '', regulatoryStatus: 'ACTIVE', retailPrice: '', requiresPriorAuth: false })
      void queryClient.invalidateQueries({ queryKey: ['ops-catalog'] })
    } catch (err) {
      setManualError(err instanceof Error ? err.message : 'Add failed')
    } finally {
      setIsSubmittingManual(false)
    }
  }

  // ── Version comparison ────────────────────────────────────────
  const comparisonVersions = comparingVersions
    ? [
        versions.find(v => v.historyId === comparingVersions[0]),
        versions.find(v => v.historyId === comparingVersions[1]),
      ].filter(Boolean) as CatalogUploadVersion[]
    : []

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="text-base font-semibold text-foreground">Catalog Management</div>
        {isFetching && <span className="text-[10px] text-muted-foreground">↻ refreshing</span>}
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span>{data?.totalCount ?? items.length} items</span>
          {versions.length > 0 && <span>{versions.length} versions</span>}
        </div>
      </div>

      {/* ── Error banners ── */}
      {isError && (
        <div className="flex items-center justify-between rounded-md border border-orange-300 bg-orange-50 px-4 py-2.5 text-sm text-orange-800" role="alert">
          <span>Connection lost — showing cached data</span>
          <button type="button" onClick={() => void refetch()} className="underline focus-visible:outline-none">Retry</button>
        </div>
      )}
      {actionError && (
        <div className="flex items-center gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700" role="alert">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="underline focus-visible:outline-none">Dismiss</button>
        </div>
      )}

      {/* ── Upload section ── */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">Upload Catalog CSV — REQ-CTM-001</p>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5 text-muted-foreground">
            Pharmacy:
            <select
              value={uploadPharmacyId}
              onChange={e => setUploadPharmacyId(e.target.value)}
              className="rounded border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Select pharmacy…</option>
              {pharmacies.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <span className="text-muted-foreground text-[10px]">
            Required columns: medication_name, form, dose, wholesale_price, regulatory_status
          </span>
        </div>

        <div
          {...getRootProps()}
          className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            isDragActive
              ? 'border-primary bg-primary/5'
              : 'border-border bg-muted/20 hover:border-primary/50'
          } ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <input {...getInputProps()} aria-label="Upload CSV file" />
          {isUploading ? (
            <p className="text-sm text-muted-foreground">Uploading…</p>
          ) : isDragActive ? (
            <p className="text-sm text-primary">Drop the CSV here</p>
          ) : (
            <>
              <p className="text-sm font-medium text-foreground">Drag & drop a CSV file, or click to select</p>
              <p className="text-[11px] text-muted-foreground mt-1">Accepts .csv files only</p>
            </>
          )}
        </div>

        {uploadError && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">{uploadError}</div>
        )}

        {uploadResult && (
          <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800 space-y-1">
            <p className="font-medium">Upload successful — Version {uploadResult.versionNumber}</p>
            <p>{uploadResult.rowsInserted} rows inserted | +{uploadResult.delta.added} added, ~{uploadResult.delta.modified} modified, -{uploadResult.delta.removed} removed</p>
            {uploadResult.priceDiscrepancies.length > 0 && (
              <PriceDiscrepancyAlert discrepancies={uploadResult.priceDiscrepancies} />
            )}
            {uploadResult.warnings.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-amber-700">{uploadResult.warnings.length} warning(s)</summary>
                <ul className="mt-1 space-y-0.5 list-disc list-inside">
                  {uploadResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      {/* ── Manual Entry section — REQ-CTM-009 ── */}
      <div className="rounded-lg border border-border bg-card">
        <button
          type="button"
          onClick={() => setShowManualEntry(p => !p)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
        >
          <span>Manual Entry — REQ-CTM-009</span>
          <span className="text-muted-foreground text-xs">{showManualEntry ? '▲' : '▼'}</span>
        </button>
        {showManualEntry && (
          <form onSubmit={(e) => { void handleManualEntry(e) }} className="border-t border-border px-4 pb-4 pt-3 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <label className="flex flex-col gap-1 text-muted-foreground">
                Pharmacy *
                <select
                  required
                  value={manualForm.pharmacyId}
                  onChange={e => setManualForm(p => ({ ...p, pharmacyId: e.target.value }))}
                  className="rounded border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Select…</option>
                  {pharmacies.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-muted-foreground">
                Medication Name *
                <input required type="text" value={manualForm.medicationName}
                  onChange={e => setManualForm(p => ({ ...p, medicationName: e.target.value }))}
                  className="rounded border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </label>
              <label className="flex flex-col gap-1 text-muted-foreground">
                Form *
                <input required type="text" value={manualForm.form} placeholder="e.g. capsule"
                  onChange={e => setManualForm(p => ({ ...p, form: e.target.value }))}
                  className="rounded border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </label>
              <label className="flex flex-col gap-1 text-muted-foreground">
                Dose *
                <input required type="text" value={manualForm.dose} placeholder="e.g. 10mg"
                  onChange={e => setManualForm(p => ({ ...p, dose: e.target.value }))}
                  className="rounded border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </label>
              <label className="flex flex-col gap-1 text-muted-foreground">
                Wholesale Price *
                <input required type="number" min="0" step="0.01" value={manualForm.wholesalePrice}
                  onChange={e => setManualForm(p => ({ ...p, wholesalePrice: e.target.value }))}
                  className="rounded border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </label>
              <label className="flex flex-col gap-1 text-muted-foreground">
                Retail Price
                <input type="number" min="0" step="0.01" value={manualForm.retailPrice}
                  onChange={e => setManualForm(p => ({ ...p, retailPrice: e.target.value }))}
                  className="rounded border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </label>
              <label className="flex flex-col gap-1 text-muted-foreground">
                Regulatory Status
                <select value={manualForm.regulatoryStatus}
                  onChange={e => setManualForm(p => ({ ...p, regulatoryStatus: e.target.value }))}
                  className="rounded border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="ACTIVE">Active</option>
                  <option value="RECALLED">Recalled</option>
                  <option value="DISCONTINUED">Discontinued</option>
                  <option value="SHORTAGE">Shortage</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-muted-foreground pt-4">
                <input type="checkbox" checked={manualForm.requiresPriorAuth}
                  onChange={e => setManualForm(p => ({ ...p, requiresPriorAuth: e.target.checked }))}
                  className="rounded border-input" />
                Requires Prior Auth
              </label>
            </div>
            {manualError   && <div className="rounded border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] text-red-700">{manualError}</div>}
            {manualSuccess && <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] text-emerald-800">{manualSuccess}</div>}
            <button type="submit" disabled={isSubmittingManual}
              className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {isSubmittingManual ? 'Adding…' : 'Add Item'}
            </button>
          </form>
        )}
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1" role="tablist">
        {(['catalog', 'versions', 'normalized', 'sync'] as ActiveTab[]).map(tab => (
          <button
            key={tab}
            role="tab"
            type="button"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-t px-3 py-1.5 text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              activeTab === tab
                ? 'bg-card border border-b-0 border-border text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'sync' ? 'API Sync' : tab === 'normalized' ? 'Normalized' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* ── Catalog tab ── */}
      {activeTab === 'catalog' && (
        <div className="space-y-3">
          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center text-xs" role="group" aria-label="Filter catalog">
            <label className="flex items-center gap-1.5 text-muted-foreground">
              Pharmacy:
              <select
                value={pharmacyFilter}
                onChange={e => setPharmacyFilter(e.target.value)}
                className="rounded border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">All pharmacies</option>
                {pharmacies.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-muted-foreground">
              Status:
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="rounded border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="RECALLED">Recalled</option>
                <option value="DISCONTINUED">Discontinued</option>
                <option value="SHORTAGE">Shortage</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-muted-foreground">
              Search:
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Medication name…"
                className="rounded border border-input bg-background px-2 py-1 text-xs w-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <span className="ml-auto text-muted-foreground">{items.length} items shown</span>
          </div>

          {/* Table */}
          {items.length === 0 ? (
            <div className="flex items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 py-12">
              <p className="text-sm text-muted-foreground">No catalog items found</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Medication</th>
                    <th className="px-3 py-2 font-medium">Form</th>
                    <th className="px-3 py-2 font-medium">Dose</th>
                    <th className="px-3 py-2 font-medium">Wholesale</th>
                    <th className="px-3 py-2 font-medium">Retail</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Pharmacy</th>
                    <th className="px-3 py-2 font-medium">PA</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.itemId} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium">{item.medicationName}</td>
                      <td className="px-3 py-2 text-muted-foreground">{item.form}</td>
                      <td className="px-3 py-2 text-muted-foreground">{item.dose}</td>
                      <td className="px-3 py-2">${item.wholesalePrice.toFixed(2)}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {item.retailPrice != null ? `$${item.retailPrice.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[item.regulatoryStatus] ?? 'bg-gray-100 text-gray-600'}`}>
                          {item.regulatoryStatus}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{item.pharmacyName}</td>
                      <td className="px-3 py-2 text-center">{item.requiresPriorAuth ? '✓' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Versions tab — REQ-CTM-003, REQ-CTM-004, REQ-CTM-008 ── */}
      {activeTab === 'versions' && (
        <div className="space-y-3">
          {/* Compare selector hint — BLK-06 */}
          {compareSelected.length > 0 && compareSelected.length < 2 && (
            <div className="flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-700">
              <span>1 version selected — select one more to compare</span>
              <button type="button" onClick={() => setCompareSelected([])} className="underline focus-visible:outline-none">Clear</button>
            </div>
          )}

          {/* Version comparison panel — REQ-CTM-004 */}
          {comparingVersions && comparisonVersions.length === 2 && (
            <VersionComparison
              vA={comparisonVersions[0]!}
              vB={comparisonVersions[1]!}
              onClose={() => { setComparingVersions(null); setCompareSelected([]) }}
            />
          )}

          {versions.length === 0 ? (
            <div className="flex items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 py-12">
              <p className="text-sm text-muted-foreground">No upload history found</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Version</th>
                    <th className="px-3 py-2 font-medium">Pharmacy</th>
                    <th className="px-3 py-2 font-medium">Source</th>
                    <th className="px-3 py-2 font-medium">Rows</th>
                    <th className="px-3 py-2 font-medium">Delta</th>
                    <th className="px-3 py-2 font-medium">Uploaded by</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Compare</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map(v => {
                    const isCompareSelected = compareSelected.includes(v.historyId)
                    return (
                    <tr key={v.historyId} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono font-medium">v{v.versionNumber}</td>
                      <td className="px-3 py-2">{v.pharmacyName}</td>
                      <td className="px-3 py-2 text-muted-foreground">{v.uploadSource}</td>
                      <td className="px-3 py-2">{v.rowCount}</td>
                      <td className="px-3 py-2">
                        <span className="text-emerald-700">+{v.deltaSummary.added}</span>
                        {' / '}
                        <span className="text-amber-600">~{v.deltaSummary.modified}</span>
                        {' / '}
                        <span className="text-red-600">-{v.deltaSummary.removed}</span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground truncate max-w-[120px]">{v.uploader}</td>
                      <td className="px-3 py-2 text-muted-foreground">{new Date(v.uploadedAt).toLocaleDateString()}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${v.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                          {v.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      {/* Compare toggle — BLK-06 / REQ-CTM-004 */}
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => handleToggleCompare(v.historyId)}
                          aria-pressed={isCompareSelected}
                          className={`rounded border px-1.5 py-0.5 text-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            isCompareSelected
                              ? 'border-blue-400 bg-blue-100 text-blue-700'
                              : 'border-border text-muted-foreground hover:bg-muted'
                          }`}
                        >
                          {isCompareSelected ? 'Selected' : 'Select'}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          {/* Rollback — REQ-CTM-008 */}
                          {!v.isActive && (
                            confirmRollback === v.historyId ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => { void handleRollback(v.historyId, v.pharmacyId) }}
                                  className="rounded bg-amber-600 px-1.5 py-0.5 text-[10px] text-white hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmRollback(null)}
                                  className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-muted focus-visible:outline-none"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmRollback(v.historyId)}
                                className="rounded border border-border px-1.5 py-0.5 text-[10px] text-amber-700 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                Rollback
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Normalized tab — REQ-CTM-007 ── */}
      {activeTab === 'normalized' && (
        <div className="space-y-3">
          {normalized.length === 0 ? (
            <div className="flex items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 py-12">
              <p className="text-sm text-muted-foreground">No normalized catalog entries found</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Canonical Name</th>
                    <th className="px-3 py-2 font-medium">Form</th>
                    <th className="px-3 py-2 font-medium">Dose</th>
                    <th className="px-3 py-2 font-medium">Pharmacy</th>
                    <th className="px-3 py-2 font-medium">Wholesale</th>
                    <th className="px-3 py-2 font-medium">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {normalized.map(n => (
                    <tr key={n.normalizedId} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium">{n.canonicalName}</td>
                      <td className="px-3 py-2 text-muted-foreground">{n.form}</td>
                      <td className="px-3 py-2 text-muted-foreground">{n.dose}</td>
                      <td className="px-3 py-2 text-muted-foreground">{n.pharmacyName}</td>
                      <td className="px-3 py-2">{n.wholesalePrice != null ? `$${n.wholesalePrice.toFixed(2)}` : '—'}</td>
                      <td className="px-3 py-2">
                        {n.confidence != null ? (
                          <span className={n.confidence >= 0.8 ? 'text-emerald-700 font-medium' : n.confidence >= 0.5 ? 'text-amber-600' : 'text-red-600'}>
                            {(n.confidence * 100).toFixed(0)}%
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── API Sync tab — REQ-CTM-006 ── */}
      {activeTab === 'sync' && (
        <div className="space-y-3">
          {syncStatus.length === 0 ? (
            <div className="flex items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 py-12">
              <p className="text-sm text-muted-foreground">No API-capable pharmacies found</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Pharmacy</th>
                    <th className="px-3 py-2 font-medium">Tier</th>
                    <th className="px-3 py-2 font-medium">Last Synced</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {syncStatus.map(s => (
                    <tr key={s.pharmacyId} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium">{s.pharmacyName}</td>
                      <td className="px-3 py-2 text-muted-foreground">{s.tier}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {s.lastSyncedAt
                          ? new Date(s.lastSyncedAt).toLocaleString()
                          : <span className="text-amber-600">Never synced</span>}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          disabled={syncingPharmacy === s.pharmacyId}
                          onClick={() => { void handleSync(s.pharmacyId) }}
                          className="rounded bg-primary px-2 py-0.5 text-[10px] text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {syncingPharmacy === s.pharmacyId ? 'Syncing…' : 'Trigger Sync'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Price Discrepancy Alert — REQ-CTM-005 ─────────────────────

function PriceDiscrepancyAlert({ discrepancies }: { discrepancies: PriceDiscrepancy[] }) {
  return (
    <div className="mt-1 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
      <p className="font-medium">⚠ Price discrepancies detected ({discrepancies.length})</p>
      <ul className="mt-1 space-y-0.5">
        {discrepancies.slice(0, 10).map((d) => (
          <li key={`${d.medicationName}|${d.form}|${d.dose}`} className="flex items-center gap-2">
            <span className={`rounded-full px-1 py-0 text-[10px] font-bold ${d.direction === 'increase' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
              {d.direction === 'increase' ? '↑' : '↓'} {d.changePct}%
            </span>
            <span>{d.medicationName} {d.form} {d.dose} — ${d.oldPrice.toFixed(2)} → ${d.newPrice.toFixed(2)}</span>
          </li>
        ))}
        {discrepancies.length > 10 && <li>…and {discrepancies.length - 10} more</li>}
      </ul>
    </div>
  )
}

// ── Version Comparison — REQ-CTM-004 ────────────────────────

function VersionComparison({
  vA, vB, onClose,
}: {
  vA: CatalogUploadVersion
  vB: CatalogUploadVersion
  onClose: () => void
}) {
  const [left, right] = vA.versionNumber < vB.versionNumber ? [vA, vB] : [vB, vA]

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Version Comparison</h3>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground focus-visible:outline-none" aria-label="Close comparison">✕</button>
      </div>
      <div className="grid grid-cols-2 gap-4 text-xs">
        {[left, right].map(v => (
          <div key={v.historyId} className="rounded border border-border p-3 space-y-1">
            <p className="font-semibold">Version {v.versionNumber} {v.isActive ? '(active)' : ''}</p>
            <p className="text-muted-foreground">{new Date(v.uploadedAt).toLocaleString()}</p>
            <p>{v.rowCount} rows · {v.uploadSource}</p>
            <p>
              <span className="text-emerald-700">+{v.deltaSummary.added}</span>
              {' added / '}
              <span className="text-amber-600">~{v.deltaSummary.modified}</span>
              {' modified / '}
              <span className="text-red-600">-{v.deltaSummary.removed}</span>
              {' removed'}
            </p>
            <p className="text-muted-foreground">by {v.uploader}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
