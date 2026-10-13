/**
 * Settings > Integrations > EHR sync (clinic admin), and the ops view of
 * every clinic's connection.
 *
 *   - status: not connected / connected / disconnected, last sync, errors
 *     (codes in words, never request content);
 *   - generate or rotate the shared secret: shown once, with the
 *     connection id and webhook URL to give Keragon; rotating and
 *     disconnecting ask first;
 *   - the sync log: received time, event id, outcome, patient id, codes.
 */

import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { EhrSyncPanel } from '../_components/ehr-sync-panel'
import { EhrConnectionsTable } from '@/app/(ops-dashboard)/ops/integrations/_components/ehr-connections-table'
import type { ConnectionView, SyncEventView } from '@/lib/integrations/keragon/connection'

const fetchMock = jest.fn()
beforeEach(() => { fetchMock.mockReset(); global.fetch = fetchMock as unknown as typeof fetch })
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response

const CONN = 'c0000000-0000-4000-8000-0000000000c1'
const base: ConnectionView = {
  connectionId: null, status: 'not_connected', connectedAt: null, secretRotatedAt: null, disconnectedAt: null,
  lastEventAt: null, lastSuccessAt: null, lastErrorAt: null, lastErrorCode: null, webhookPath: '/api/integrations/keragon/patients',
}
const connected: ConnectionView = { ...base, connectionId: CONN, status: 'connected', connectedAt: '2026-10-12T10:00:00Z', lastSuccessAt: '2026-10-12T14:00:00Z', lastEventAt: '2026-10-12T14:00:00Z', lastErrorAt: '2026-10-12T13:00:00Z', lastErrorCode: 'bad_signature' }
const events: SyncEventView[] = [
  { syncEventId: 's1', eventId: 'evt_demo_0001', eventType: 'patient.upsert', status: 'applied', patientId: 'p0000000-0000-4000-8000-000000000001', errorCode: null, detail: { action: 'created' }, receivedAt: '2026-10-12T14:00:00Z' },
  { syncEventId: 's2', eventId: 'evt_demo_0002', eventType: 'patient.upsert', status: 'flagged', patientId: 'p0000000-0000-4000-8000-000000000002', errorCode: null, detail: { action: 'created', reason: 'several_matches' }, receivedAt: '2026-10-12T14:01:00Z' },
  { syncEventId: 's3', eventId: 'evt_demo_0003', eventType: 'patient.upsert', status: 'error', patientId: null, errorCode: 'invalid_payload', detail: { fields: ['patient.date_of_birth'] }, receivedAt: '2026-10-12T14:02:00Z' },
]

describe('the clinic admin panel', () => {
  it('not connected: says so and offers to generate a secret', () => {
    render(<EhrSyncPanel initial={{ connection: base, events: [] }} appOrigin="https://app.example" />)
    expect(screen.getByText('Not connected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate secret' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /disconnect/i })).toBeNull()
  })

  it('connected: status, connection id, webhook URL, last sync and the last error in words', () => {
    render(<EhrSyncPanel initial={{ connection: connected, events }} appOrigin="https://app.example" />)
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByText(CONN)).toBeInTheDocument()
    expect(screen.getByText('https://app.example/api/integrations/keragon/patients')).toBeInTheDocument()
    expect(screen.getByText(/signature did not match/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rotate secret' })).toBeInTheDocument()
  })

  it('generate: the secret is shown once, with a copy button, and the status becomes connected', async () => {
    fetchMock.mockResolvedValue(reply({ secret: 'kgn_whsec_shown_once', rotated: false, connection: { ...connected, lastErrorCode: null, lastErrorAt: null } }))
    render(<EhrSyncPanel initial={{ connection: base, events: [] }} appOrigin="https://app.example" />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Generate secret' })) })
    expect(fetchMock).toHaveBeenCalledWith('/api/integrations/keragon/connection/secret', expect.objectContaining({ method: 'POST' }))
    expect(screen.getByLabelText(/shared secret/i)).toHaveValue('kgn_whsec_shown_once')
    expect(screen.getByText(/shown once/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy the secret/i })).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  it('rotate asks first: the current secret stops working at once', async () => {
    fetchMock.mockResolvedValue(reply({ secret: 'kgn_whsec_rotated', rotated: true, connection: connected }))
    render(<EhrSyncPanel initial={{ connection: connected, events }} appOrigin="https://app.example" />)
    fireEvent.click(screen.getByRole('button', { name: 'Rotate secret' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/stops working/i)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Rotate now' })) })
    expect(screen.getByLabelText(/shared secret/i)).toHaveValue('kgn_whsec_rotated')
  })

  it('disconnect asks first, then calls DELETE', async () => {
    fetchMock.mockResolvedValue(reply({ connection: { ...connected, status: 'disconnected', connectionId: CONN, disconnectedAt: '2026-10-12T15:00:00Z' } }))
    render(<EhrSyncPanel initial={{ connection: connected, events }} appOrigin="https://app.example" />)
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(fetchMock).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Disconnect now' })) })
    expect(fetchMock).toHaveBeenCalledWith('/api/integrations/keragon/connection', expect.objectContaining({ method: 'DELETE' }))
    expect(screen.getByText('Disconnected')).toBeInTheDocument()
  })

  it('a failure is announced and changes nothing', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'The secret could not be stored. Nothing was changed. Try again.' }, 503))
    render(<EhrSyncPanel initial={{ connection: base, events: [] }} appOrigin="https://app.example" />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Generate secret' })) })
    expect(screen.getByRole('alert')).toHaveTextContent('could not be stored')
    expect(screen.getByText('Not connected')).toBeInTheDocument()
  })

  it('the sync log: time, event id, outcome, patient id and codes; no PHI to show', () => {
    render(<EhrSyncPanel initial={{ connection: connected, events }} appOrigin="https://app.example" />)
    const table = within(screen.getByRole('table', { name: 'Sync log' }))
    const rows = table.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('evt_demo_0001'); expect(rows[0]).toHaveTextContent('Applied')
    expect(rows[1]).toHaveTextContent('Flagged for review'); expect(rows[1]).toHaveTextContent('several_matches')
    expect(rows[2]).toHaveTextContent('Error'); expect(rows[2]).toHaveTextContent('invalid_payload'); expect(rows[2]).toHaveTextContent('patient.date_of_birth')
  })
})

describe('ops: every clinic', () => {
  it('lists each clinic with its status, last sync and last error', () => {
    render(<EhrConnectionsTable connections={[
      { ...connected, clinicId: 'c-1', clinicName: 'Demo Clinic' },
      { ...base, connectionId: 'c0000000-0000-4000-8000-0000000000c2', status: 'disconnected', disconnectedAt: '2026-10-11T00:00:00Z', clinicId: 'c-2', clinicName: 'Other Clinic' },
    ]} />)
    const rows = within(screen.getByRole('table', { name: 'EHR sync connections' })).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('Demo Clinic'); expect(rows[0]).toHaveTextContent('Connected'); expect(rows[0]).toHaveTextContent('bad_signature')
    expect(rows[1]).toHaveTextContent('Other Clinic'); expect(rows[1]).toHaveTextContent('Disconnected')
  })

  it('none yet: says so', () => {
    render(<EhrConnectionsTable connections={[]} />)
    expect(screen.getByText(/no clinic has connected/i)).toBeInTheDocument()
  })
})
