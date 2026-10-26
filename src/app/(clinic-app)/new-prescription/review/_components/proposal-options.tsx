'use client'

// ============================================================
// Review: group the lines into options for the patient (PR 2)
// ============================================================
//
// Patient protocol choice (docs/design/patient-protocol-choice.md, 1.1).
// The provider groups Review's lines into options (Option A, B...), each
// with the name the patient reads (at most 80 characters). By default
// each loaded protocol is its own option, named after the protocol, and
// the other lines share one option. Every line starts Required (the star):
// the patient cannot untick it. The provider unticks "nice to have" items.
//
// Controlled: the plan lives in BatchReviewForm, which sends it.

import { PROPOSAL_OPTION_LABEL_MAX } from '@/lib/proposals/types'
import type { ProposalOptionInput } from '@/lib/proposals/propose'

export interface ProposalLine {
  id:             string
  medicationName: string
  protocolId:     string | null
  protocolName:   string | null
}

export interface OptionDraft {
  key:        string
  label:      string
  protocolId: string | null
}

export interface ProposalPlan {
  options:  OptionDraft[]
  /** line id → option key */
  optionOf: Record<string, string>
  /** line id → required */
  required: Record<string, boolean>
}

const letter = (i: number) => String.fromCharCode(65 + i)
const optionName = (i: number) => `Option ${letter(i)}`
let keySeq = 0
const newKey = () => `opt-${Date.now().toString(36)}-${(keySeq++).toString(36)}`

export function defaultProposalPlan(lines: ProposalLine[]): ProposalPlan {
  const options: OptionDraft[] = []
  const optionOf: Record<string, string> = {}
  const byProtocol = new Map<string, string>()
  let other: string | null = null
  for (const line of lines) {
    if (line.protocolId) {
      let key = byProtocol.get(line.protocolId)
      if (!key) {
        key = newKey()
        byProtocol.set(line.protocolId, key)
        const label = (line.protocolName ?? '').trim().slice(0, PROPOSAL_OPTION_LABEL_MAX) || optionName(options.length)
        options.push({ key, label, protocolId: line.protocolId })
      }
      optionOf[line.id] = key
    }
  }
  for (const line of lines) {
    if (line.protocolId) continue
    if (!other) {
      other = newKey()
      options.push({ key: other, label: optionName(options.length), protocolId: null })
    }
    optionOf[line.id] = other
  }
  if (options.length === 0) options.push({ key: newKey(), label: optionName(0), protocolId: null })
  return { options, optionOf, required: Object.fromEntries(lines.map(l => [l.id, true])) }
}

/**
 * The plan for the lines Review has now: a line added since goes in the
 * first option, Required; a removed line is dropped. Pure, so the plan
 * follows the lines without an effect.
 */
export function alignPlan(plan: ProposalPlan, lines: ProposalLine[]): ProposalPlan {
  const first = plan.options[0]?.key
  if (!first) return defaultProposalPlan(lines)
  const keys = new Set(plan.options.map(o => o.key))
  const optionOf: Record<string, string> = {}
  const required: Record<string, boolean> = {}
  for (const l of lines) {
    const key = plan.optionOf[l.id]
    optionOf[l.id] = key && keys.has(key) ? key : first
    required[l.id] = plan.required[l.id] ?? true
  }
  return { options: plan.options, optionOf, required }
}

/** What stops the plan from being sent, in the provider's words. */
export function planProblems(plan: ProposalPlan): string[] {
  const out: string[] = []
  const used = new Set(Object.values(plan.optionOf))
  plan.options.forEach((o, i) => {
    if (!o.label.trim()) out.push(`${optionName(i)} needs a name for the patient.`)
    else if (o.label.trim().length > PROPOSAL_OPTION_LABEL_MAX) out.push(`${optionName(i)}'s name is longer than ${PROPOSAL_OPTION_LABEL_MAX} characters.`)
    if (!used.has(o.key)) out.push(`${optionName(i)} has no prescriptions. Move one into it or remove it.`)
  })
  return out
}

/** The options for POST /api/proposals, with each line's saved order id. */
export function proposalOptionsBody(plan: ProposalPlan, lines: ProposalLine[], orderIdOf: (lineId: string) => string): ProposalOptionInput[] {
  return plan.options
    .map(o => ({
      label:      o.label.trim(),
      protocolId: o.protocolId,
      lines:      lines.filter(l => plan.optionOf[l.id] === o.key).map(l => ({ orderId: orderIdOf(l.id), required: plan.required[l.id] !== false })),
    }))
    .filter(o => o.lines.length > 0)
}

export function ProposalOptions({ lines, plan, onChange, disabled = false }: {
  lines:     ProposalLine[]
  plan:      ProposalPlan
  onChange:  (next: ProposalPlan) => void
  disabled?: boolean
}) {
  const setLabel = (key: string, label: string) =>
    onChange({ ...plan, options: plan.options.map(o => (o.key === key ? { ...o, label } : o)) })
  const moveLine = (lineId: string, key: string) =>
    onChange({ ...plan, optionOf: { ...plan.optionOf, [lineId]: key } })
  const setRequired = (lineId: string, required: boolean) =>
    onChange({ ...plan, required: { ...plan.required, [lineId]: required } })
  const addOption = () =>
    onChange({ ...plan, options: [...plan.options, { key: newKey(), label: optionName(plan.options.length), protocolId: null }] })
  const removeOption = (key: string) =>
    onChange({ ...plan, options: plan.options.filter(o => o.key !== key) })

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        The patient picks one option. Required items are always included; the patient can untick the others.
      </p>
      {plan.options.map((option, i) => {
        const name = optionName(i)
        const inOption = lines.filter(l => plan.optionOf[l.id] === option.key)
        const labelId = `proposal-option-${option.key}`
        return (
          <fieldset key={option.key} className="space-y-3 rounded-lg border border-border p-4">
            <legend className="px-1 text-sm font-semibold text-foreground">{name}</legend>
            <div>
              <label htmlFor={labelId} className="block text-sm font-medium text-foreground">{name} name for the patient</label>
              <input
                id={labelId}
                type="text"
                value={option.label}
                maxLength={PROPOSAL_OPTION_LABEL_MAX}
                disabled={disabled}
                onChange={e => setLabel(option.key, e.target.value)}
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            {inOption.length === 0 ? (
              <p className="text-sm text-muted-foreground">No prescriptions in this option yet.</p>
            ) : (
              <ul className="space-y-2">
                {inOption.map(line => {
                  const selectId = `proposal-line-${line.id}`
                  const starId = `proposal-required-${line.id}`
                  return (
                    <li key={line.id} className="flex flex-wrap items-center gap-3 rounded-md bg-muted/30 px-3 py-2">
                      <span className="min-w-0 flex-1 wrap-break-word text-sm text-foreground">{line.medicationName}</span>
                      <label htmlFor={starId} className="flex min-h-[44px] items-center gap-1.5 text-sm text-foreground">
                        <input
                          id={starId}
                          type="checkbox"
                          checked={plan.required[line.id] !== false}
                          disabled={disabled}
                          onChange={e => setRequired(line.id, e.target.checked)}
                          aria-label={`Required: ${line.medicationName}`}
                        />
                        <span aria-hidden="true">★</span> Required
                      </label>
                      <label htmlFor={selectId} className="sr-only">Option for {line.medicationName}</label>
                      <select
                        id={selectId}
                        value={option.key}
                        disabled={disabled}
                        onChange={e => moveLine(line.id, e.target.value)}
                        className="min-h-[44px] rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {plan.options.map((o, j) => (
                          <option key={o.key} value={o.key}>{optionName(j)}{o.label.trim() ? `: ${o.label.trim()}` : ''}</option>
                        ))}
                      </select>
                    </li>
                  )
                })}
              </ul>
            )}
            {inOption.length === 0 && plan.options.length > 1 && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => removeOption(option.key)}
                className="inline-flex min-h-[44px] items-center rounded-md border border-input px-3 text-sm text-foreground hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                Remove {name}
              </button>
            )}
          </fieldset>
        )
      })}
      <button
        type="button"
        disabled={disabled}
        onClick={addOption}
        className="inline-flex min-h-[44px] items-center rounded-md border border-input px-3 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        Add an option
      </button>
    </div>
  )
}
