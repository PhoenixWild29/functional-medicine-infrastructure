/**
 * Patient CSV import, 4 MB: a file over 4 MB is refused in the browser
 * before anything is sent (Vercel refuses bodies over about 4.5 MB), and the
 * error is announced and tied to the file field.
 */

import { render, screen, fireEvent, act } from '@testing-library/react'
import { ImportWizard } from '../_components/import-wizard'

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

it('a file over 4 MB: refused before upload, said plainly', async () => {
  render(<ImportWizard />)
  const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'patients.csv', { type: 'text/csv' })
  fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [big] } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Upload and check columns' })) })
  expect(fetchMock).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('The file is larger than 4 MB. Split it into smaller files.')
  expect(screen.getByLabelText('CSV file')).toHaveAttribute('aria-invalid', 'true')
})
