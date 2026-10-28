'use client'

// ============================================================
// A proposed order in the drawer (patient protocol choice, PR 2)
// ============================================================
//
// Where the plan is (prepared, awaiting the patient's choice, chosen),
// which option this line is in and whether it is required. The provider
// or a clinic admin (canSend) can send the link, or a new one (the old
// link stops working, and every signing check runs again), or cancel the
// plan (its prescriptions are cancelled and the link stops working). To
// change a line, edit it as any draft: that turns the link off until a
// new one is sent.

import { useState } from 'react'
import { PlanLinkPanel } from '@/components/proposals/plan-link-panel'
import type { DashboardProposal } from '@/lib/proposals/dashboard'
import type { SentLink } from '@/lib/proposals/propose'

function stateText(p: DashboardProposal): string {
  if (p.status === 'draft') return 'Prepared for the patient to choose. Not sent yet.'
  if (p.status === 'chosen') return 'The patient has chosen. Signing comes next.'
  return p.linkActive
    ? 'Awaiting patient choice'
    : 'Awaiting patient choice. The link was turned off when a line was edited; send a new link.'
}

const button = 'inline-flex min-h-[44px] items-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
const danger = 'inline-flex min-h-[44px] items-center rounded-md bg-red-700 px-3 text-sm font-medium text-white hover:bg-red-800 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'

export function ProposalPanel({ proposal, canSend, onChanged }: {
  proposal:  DashboardProposal
  /** The provider or a clinic admin (a medical assistant prepares, never sends). */
  canSend:   boolean
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [link, setLink] = useState<{ link: SentLink; resent: boolean } | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelled, setCancelled] = useState(false)

  async function post(path: 'send' | 'cancel'): Promise<Record<string, unknown> | null> {
    setBusy(true)
    setErrors([])
    try {
      const res = await fetch(`/api/proposals/${proposal.proposalId}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const body = await res.json().catch(() => ({})) as { error?: string; problems?: Array<{ message?: string }> } & Record<string, unknown>
      if (!res.ok) {
        const lines = (body.problems ?? []).map(p => p.message).filter((m): m is string => typeof m === 'string')
        setErrors(lines.length > 0 ? lines : [body.error ?? 'That did not work. Try again.'])
        return null
      }
      return body
    } catch {
      setErrors(['The connection failed. Check your network and try again.'])
      return null
    } finally {
      setBusy(false)
    }
  }

  async function send() {
    const body = await post('send')
    if (!body) return
    setLink({ link: body['link'] as SentLink, resent: body['resent'] === true })
    onChanged()
  }

  async function cancel() {
    setConfirmCancel(false)
    const body = await post('cancel')
    if (!body) return
    setCancelled(true)
    onChanged()
  }

  return (
    <section aria-label="Patient choice" className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
      <h3 className="text-sm font-semibold text-foreground">Patient choice</h3>
      <p className="text-sm text-foreground">{cancelled ? 'The plan was cancelled.' : stateText(proposal)}</p>
      <p className="text-sm text-muted-foreground">
        {proposal.optionLabel}, {proposal.required ? 'required' : 'optional (the patient can untick it)'}
      </p>

      {errors.length > 0 && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <ul className="list-disc space-y-1 pl-5">{errors.map(e => <li key={e}>{e}</li>)}</ul>
        </div>
      )}

      {link && (
        <>
          {link.resent && <p className="text-sm text-foreground">A new link was made. The previous link no longer works.</p>}
          <PlanLinkPanel proposalId={proposal.proposalId} url={link.link.url} expiresAt={link.link.expiresAt} texting={link.link.texting} />
        </>
      )}

      {canSend && !cancelled && (
        confirmCancel ? (
          <div className="space-y-2">
            <p className="text-sm text-foreground">Cancel this plan? Its prescriptions are cancelled and the patient&apos;s link stops working.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => void cancel()} className={danger}>Yes, cancel the plan</button>
              <button type="button" onClick={() => setConfirmCancel(false)} className={button}>Keep the plan</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void send()} className={button}>
              {proposal.status === 'draft' ? 'Send the plan link' : 'Send a new link'}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirmCancel(true)} className={button}>Cancel the plan</button>
          </div>
        )
      )}
    </section>
  )
}
