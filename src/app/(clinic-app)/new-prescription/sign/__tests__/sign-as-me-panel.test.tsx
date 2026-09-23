/**
 * WO-100 "Sign as me" panel: posts the reassignment and refreshes the
 * page into the signing form; surfaces the server's error otherwise.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SignAsMePanel } from '../_components/sign-as-me-panel'

const mockRefresh = jest.fn()
const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: mockRefresh }),
}))

const ORDER_ID = 'a6000000-0000-0000-0000-00000000000a'

beforeEach(() => {
  mockRefresh.mockClear()
  mockPush.mockClear()
  global.fetch = jest.fn()
})

describe('SignAsMePanel', () => {
  it('names both providers and how many lines move', () => {
    render(<SignAsMePanel orderId={ORDER_ID} assignedProviderName="Marcus Patel" myProviderName="Sarah Chen" lineCount={2} />)
    expect(screen.getByText(/assigned to Marcus Patel/)).toBeInTheDocument()
    expect(screen.getByText(/signed in as Sarah Chen/)).toBeInTheDocument()
    expect(screen.getByText(/all 2 prescriptions in this draft/)).toBeInTheDocument()
  })

  it('POSTs reassign-to-me and refreshes into the signing form', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ reassigned: true }) })
    render(<SignAsMePanel orderId={ORDER_ID} assignedProviderName="Marcus Patel" myProviderName="Sarah Chen" lineCount={1} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sign as me' }))

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled())
    expect(global.fetch).toHaveBeenCalledWith(`/api/orders/${ORDER_ID}/reassign-to-me`, { method: 'POST' })
  })

  it('shows the server error and re-enables the button', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: false, json: async () => ({ error: 'Only a draft can be reassigned' }) })
    render(<SignAsMePanel orderId={ORDER_ID} assignedProviderName="Marcus Patel" myProviderName="Sarah Chen" lineCount={1} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sign as me' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Only a draft can be reassigned')
    expect(screen.getByRole('button', { name: 'Sign as me' })).toBeEnabled()
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
