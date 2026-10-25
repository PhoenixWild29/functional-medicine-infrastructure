/**
 * Patient protocol choice, PR 2: grouping Review's lines into options.
 *
 * By default each loaded protocol is its own option, labelled with the
 * protocol's name; the other lines share one option. Every line starts
 * Required (the provider unticks "nice to have" items). Labels are what
 * the patient reads, at most 80 characters. axe clean.
 */

import { useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import {
  ProposalOptions, defaultProposalPlan, planProblems, proposalOptionsBody,
  type ProposalLine, type ProposalPlan,
} from '../_components/proposal-options'

const LINES: ProposalLine[] = [
  { id: 'l1', medicationName: 'Semaglutide 5 mg/mL', protocolId: 'proto-glp', protocolName: 'GLP-1 Foundation' },
  { id: 'l2', medicationName: 'Ondansetron 4 mg', protocolId: 'proto-glp', protocolName: 'GLP-1 Foundation' },
  { id: 'l3', medicationName: 'NAD+ 100 mg/mL', protocolId: 'proto-nad', protocolName: 'Energy support' },
  { id: 'l4', medicationName: 'Cyanocobalamin 1000 mcg/mL', protocolId: null, protocolName: null },
]

function Harness({ initial }: { initial?: ProposalPlan }) {
  const [plan, setPlan] = useState<ProposalPlan>(initial ?? defaultProposalPlan(LINES))
  return (
    <>
      <ProposalOptions lines={LINES} plan={plan} onChange={setPlan} />
      <output data-testid="plan">{JSON.stringify(plan)}</output>
    </>
  )
}
const plan = (): ProposalPlan => JSON.parse(screen.getByTestId('plan').textContent!)

describe('the default plan', () => {
  it('each protocol its own option with its name; other lines together; every line required', () => {
    const p = defaultProposalPlan(LINES)
    expect(p.options.map(o => [o.label, o.protocolId])).toEqual([['GLP-1 Foundation', 'proto-glp'], ['Energy support', 'proto-nad'], ['Option C', null]])
    expect(LINES.map(l => p.options.findIndex(o => o.key === p.optionOf[l.id]))).toEqual([0, 0, 1, 2])
    expect(LINES.map(l => p.required[l.id])).toEqual([true, true, true, true])
  })

  it('no protocol: one option, "Option A"', () => {
    const p = defaultProposalPlan([LINES[3]!])
    expect(p.options.map(o => o.label)).toEqual(['Option A'])
  })

  it('a protocol name over 80 characters is cut to 80', () => {
    const p = defaultProposalPlan([{ ...LINES[0]!, protocolName: 'x'.repeat(120) }])
    expect(p.options[0]!.label).toHaveLength(80)
  })
})

describe('editing', () => {
  it('a label is the patient-facing name, at most 80 characters', () => {
    render(<Harness />)
    const label = screen.getByLabelText('Option A name for the patient')
    expect(label).toHaveValue('GLP-1 Foundation')
    expect(label).toHaveAttribute('maxLength', '80')
    fireEvent.change(label, { target: { value: 'Foundation plan' } })
    expect(plan().options[0]!.label).toBe('Foundation plan')
  })

  it('the Required star on each line, on by default, turns off', () => {
    render(<Harness />)
    const star = screen.getByRole('checkbox', { name: 'Required: Ondansetron 4 mg' })
    expect(star).toBeChecked()
    fireEvent.click(star)
    expect(plan().required['l2']).toBe(false)
  })

  it('a line moves to another option; an option can be added', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Add an option' }))
    expect(screen.getByLabelText('Option D name for the patient')).toHaveValue('Option D')
    fireEvent.change(screen.getByLabelText('Option for Cyanocobalamin 1000 mcg/mL'), { target: { value: plan().options[3]!.key } })
    expect(plan().optionOf['l4']).toBe(plan().options[3]!.key)
    // Each line is listed under its option.
    expect(within(screen.getByRole('group', { name: 'Option D' })).getByText('Cyanocobalamin 1000 mcg/mL')).toBeInTheDocument()
  })

  it('an empty option can be removed; the last option cannot', () => {
    render(<Harness initial={defaultProposalPlan([LINES[3]!])} />)
    expect(screen.queryByRole('button', { name: /Remove Option A/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add an option' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Option B' }))
    expect(plan().options).toHaveLength(1)
  })
})

describe('problems and the request body', () => {
  it('an empty label, or an option with no lines, is named', () => {
    const p = defaultProposalPlan(LINES)
    p.options[1]!.label = '  '
    p.options.push({ key: 'k-empty', label: 'Spare', protocolId: null })
    expect(planProblems(p)).toEqual(['Option B needs a name for the patient.', 'Option D has no prescriptions. Move one into it or remove it.'])
  })

  it('the body carries each option with its lines, order ids and Required', () => {
    const p = defaultProposalPlan(LINES)
    p.required['l2'] = false
    const ids: Record<string, string> = { l1: 'o1', l2: 'o2', l3: 'o3', l4: 'o4' }
    expect(proposalOptionsBody(p, LINES, lineId => ids[lineId]!)).toEqual([
      { label: 'GLP-1 Foundation', protocolId: 'proto-glp', lines: [{ orderId: 'o1', required: true }, { orderId: 'o2', required: false }] },
      { label: 'Energy support', protocolId: 'proto-nad', lines: [{ orderId: 'o3', required: true }] },
      { label: 'Option C', protocolId: null, lines: [{ orderId: 'o4', required: true }] },
    ])
  })
})

it('no em dash, and axe clean', async () => {
  const { container } = render(<Harness />)
  expect(container.textContent).not.toContain('—')
  const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })
  expect((await axe(container)).violations.map(v => v.id)).toEqual([])
})
