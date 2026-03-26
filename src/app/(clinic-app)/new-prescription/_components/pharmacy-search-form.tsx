'use client'

// ============================================================
// Pharmacy Search Form — WO-27
// ============================================================
//
// REQ-SCS-001: Medication autocomplete (3+ chars trigger).
// REQ-SCS-002: Patient shipping state required before search.
// REQ-SCS-003: Optional dosage form filter.
// REQ-SCS-010: Empty state message.
// REQ-SCS-005: SUSPENDED flag note (is_active = false excluded by API).
//
// State flow:
//   1. User types medication (autocomplete fires at 3+ chars)
//   2. User selects a suggestion (sets itemId)
//   3. User selects patient shipping state
//   4. [Search] button executes — results displayed below
//   5. User clicks a result card → navigates to margin builder

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { MedicationSuggestion } from '@/app/api/pharmacy-search/medications/route'
import type { PharmacySearchResult } from '@/app/api/pharmacy-search/route'
import { PharmacyResultCard } from './pharmacy-result-card'

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DC','DE','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY',
]

interface Props {
  /** Pre-populated from patient record if available */
  defaultState?: string
}

export function PharmacySearchForm({ defaultState }: Props) {
  const [medicationQuery, setMedicationQuery]     = useState('')
  const [selectedItem, setSelectedItem]           = useState<MedicationSuggestion | null>(null)
  const [showSuggestions, setShowSuggestions]     = useState(false)
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1)
  const [patientState, setPatientState]           = useState(defaultState ?? '')
  const [formFilter, setFormFilter]               = useState('')
  const [searchTriggered, setSearchTriggered]     = useState(false)
  // BLK-02/08: snapshot available forms from the unfiltered result set so the
  // dropdown doesn't collapse when a form is selected (filtering reduces results).
  const [availableFormsSnapshot, setAvailableFormsSnapshot] = useState<string[]>([])

  const suggestionsRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Medication autocomplete — REQ-SCS-001 ────────────────────
  const { data: autocompleteData, isFetching: isAutocompleting } = useQuery({
    queryKey:  ['medication-autocomplete', medicationQuery],
    queryFn:   async () => {
      if (medicationQuery.length < 3) return { suggestions: [] }
      const res = await fetch(
        `/api/pharmacy-search/medications?q=${encodeURIComponent(medicationQuery)}&limit=10`
      )
      // NB-06/07: surface errors instead of swallowing them
      if (!res.ok) throw new Error(`Autocomplete failed: ${res.status}`)
      return res.json() as Promise<{ suggestions: MedicationSuggestion[] }>
    },
    enabled:   medicationQuery.length >= 3 && !selectedItem,
    staleTime: 60_000,
  })

  const suggestions = autocompleteData?.suggestions ?? []

  // ── Full pharmacy search ──────────────────────────────────────
  const { data: searchData, isFetching: isSearching, isError: isSearchError } = useQuery({
    queryKey:  ['pharmacy-search', selectedItem?.item_id, patientState, formFilter],
    queryFn:   async () => {
      const params = new URLSearchParams({
        itemId: selectedItem!.item_id,
        state:  patientState,
      })
      if (formFilter) params.set('form', formFilter)
      const res = await fetch(`/api/pharmacy-search?${params.toString()}`)
      // NB-06/07: surface errors instead of swallowing them
      if (!res.ok) throw new Error(`Pharmacy search failed: ${res.status}`)
      return res.json() as Promise<{ results: PharmacySearchResult[] }>
    },
    enabled:   searchTriggered && !!selectedItem && patientState.length === 2,
    staleTime: 30_000,
  })

  const results = searchData?.results ?? []

  // BLK-02/08: snapshot available forms when unfiltered results arrive so the
  // form filter dropdown stays populated after a form is selected.
  const allResultForms = useMemo(
    () => [...new Set(results.map(r => r.form))].sort(),
    // Only recompute when the full unfiltered result set changes (not when formFilter changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchData]
  )
  useEffect(() => {
    if (!formFilter && allResultForms.length > 0) {
      setAvailableFormsSnapshot(allResultForms)
    }
  }, [allResultForms, formFilter])

  const availableForms = availableFormsSnapshot

  // Close suggestions on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleMedicationChange = useCallback((value: string) => {
    setMedicationQuery(value)
    setSelectedItem(null)
    setSearchTriggered(false)
    setShowSuggestions(value.length >= 3)
    setActiveSuggestionIndex(-1)
  }, [])

  function handleSelectSuggestion(suggestion: MedicationSuggestion) {
    setSelectedItem(suggestion)
    setMedicationQuery(suggestion.medication_name)
    setShowSuggestions(false)
    setActiveSuggestionIndex(-1)
  }

  // NB-05: Keyboard navigation for autocomplete dropdown (WCAG 1.1.1)
  function handleMedicationKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveSuggestionIndex(i => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveSuggestionIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && activeSuggestionIndex >= 0) {
      e.preventDefault()
      handleSelectSuggestion(suggestions[activeSuggestionIndex]!)
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
      setActiveSuggestionIndex(-1)
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedItem || !patientState) return
    setSearchTriggered(true)
  }

  const canSearch = !!selectedItem && patientState.length === 2

  return (
    <div className="space-y-6">
      <form onSubmit={handleSearch} className="space-y-4">

        {/* Medication autocomplete — REQ-SCS-001 */}
        <div className="relative">
          <label htmlFor="medication-search" className="block text-sm font-medium text-foreground mb-1">
            Medication <span className="text-destructive">*</span>
          </label>
          <input
            ref={inputRef}
            id="medication-search"
            type="text"
            autoComplete="off"
            placeholder="Type 3+ characters to search…"
            value={medicationQuery}
            onChange={e => handleMedicationChange(e.target.value)}
            onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true) }}
            onKeyDown={handleMedicationKeyDown}
            role="combobox"
            aria-expanded={showSuggestions && suggestions.length > 0}
            aria-autocomplete="list"
            aria-controls="medication-suggestions"
            aria-activedescendant={activeSuggestionIndex >= 0 ? `suggestion-${activeSuggestionIndex}` : undefined}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {isAutocompleting && (
            <span className="absolute right-3 top-9 text-xs text-muted-foreground">Searching…</span>
          )}

          {/* Suggestions dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div
              ref={suggestionsRef}
              id="medication-suggestions"
              className="absolute z-20 mt-1 w-full rounded-md border border-border bg-popover shadow-lg"
              role="listbox"
              aria-label="Medication suggestions"
            >
              {suggestions.map((s, idx) => (
                <button
                  key={s.item_id}
                  id={`suggestion-${idx}`}
                  type="button"
                  role="option"
                  aria-selected={idx === activeSuggestionIndex}
                  className={`w-full text-left px-3 py-2 text-sm first:rounded-t-md last:rounded-b-md ${
                    idx === activeSuggestionIndex
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent hover:text-accent-foreground'
                  }`}
                  onClick={() => handleSelectSuggestion(s)}
                >
                  <span className="font-medium">{s.medication_name}</span>
                  <span className="ml-2 text-muted-foreground">{s.form} · {s.dose}</span>
                  {(s.dea_schedule ?? 0) >= 2 && (
                    <span className="ml-2 text-xs text-red-600">DEA Sch. {s.dea_schedule}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* No suggestions found */}
          {showSuggestions && !isAutocompleting && suggestions.length === 0 && medicationQuery.length >= 3 && (
            <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-lg">
              No medications found matching &ldquo;{medicationQuery}&rdquo;
            </div>
          )}
        </div>

        {/* Patient shipping state — REQ-SCS-002 */}
        <div>
          <label htmlFor="patient-state" className="block text-sm font-medium text-foreground mb-1">
            Patient Shipping State <span className="text-destructive">*</span>
          </label>
          <select
            id="patient-state"
            value={patientState}
            onChange={e => { setPatientState(e.target.value); setSearchTriggered(false) }}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Select state…</option>
            {US_STATES.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Optional dosage form filter — REQ-SCS-003 */}
        {availableForms.length > 1 && (
          <div>
            <label htmlFor="dosage-form" className="block text-sm font-medium text-foreground mb-1">
              Dosage Form <span className="text-muted-foreground text-xs">(optional)</span>
            </label>
            <select
              id="dosage-form"
              value={formFilter}
              onChange={e => setFormFilter(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All forms</option>
              {availableForms.map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
        )}

        <button
          type="submit"
          disabled={!canSearch || isSearching}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {isSearching ? 'Searching…' : 'Search Pharmacies'}
        </button>
      </form>

      {/* Results — REQ-SCS-006/007 */}
      {searchTriggered && !isSearching && (
        <div>
          {/* NB-06/07: surface search errors */}
          {isSearchError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
              Search failed. Please try again or contact support.
            </div>
          )}

          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">
              {results.length > 0
                ? `${results.length} pharmacy${results.length !== 1 ? 'ies' : ''} found`
                : ''}
            </h2>
            {results.length > 0 && (
              <p className="text-xs text-muted-foreground">Sorted by price, then speed</p>
            )}
          </div>

          {/* Empty state — REQ-SCS-010 */}
          {results.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <p className="text-sm font-medium text-foreground">No pharmacies available</p>
              <p className="mt-1 text-sm text-muted-foreground">
                No licensed pharmacies carry this medication in {patientState}.
                Try a different state or contact your pharmacy network.
              </p>
            </div>
          )}

          {/* Result cards */}
          <div className="space-y-3">
            {results.map(r => (
              // BLK-01: key must be unique across pharmacies — catalog_item_id alone is not
              <PharmacyResultCard key={`${r.pharmacy_id}-${r.catalog_item_id}`} result={r} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
