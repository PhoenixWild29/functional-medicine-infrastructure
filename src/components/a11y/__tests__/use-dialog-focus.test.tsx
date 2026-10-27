/**
 * useDialogFocus (B-2026-10-25-11): the keyboard contract of every modal
 * dialog in the clinic app. Focus moves in on open; Tab and Shift+Tab
 * wrap inside; a Tab while focus is outside comes back in; Escape closes
 * only the topmost of stacked dialogs; on close focus returns to the
 * opener, unless the caller returns it itself.
 */

import { useRef, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { useDialogFocus } from '../use-dialog-focus'

function Dialog({ name, onClose, withInitial = false, restoreFocus = true, children }: {
  name: string; onClose: () => void; withInitial?: boolean; restoreFocus?: boolean; children?: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const initial = useRef<HTMLButtonElement>(null)
  useDialogFocus(ref, { onEscape: onClose, restoreFocus, ...(withInitial ? { initialFocus: initial } : {}) })
  return (
    <div ref={ref} role="dialog" aria-label={name} tabIndex={-1}>
      <button type="button">{name} first</button>
      <button type="button" ref={initial}>{name} middle</button>
      <button type="button" onClick={onClose}>{name} last</button>
      {children}
    </div>
  )
}

function Page({ nested = false, withInitial = false, restoreFocus = true }: { nested?: boolean; withInitial?: boolean; restoreFocus?: boolean }) {
  const [open, setOpen] = useState(false)
  const [inner, setInner] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <button type="button">Behind</button>
      {open && (
        <Dialog name="Outer" onClose={() => setOpen(false)} withInitial={withInitial} restoreFocus={restoreFocus}>
          {nested && <button type="button" onClick={() => setInner(true)}>Open inner</button>}
          {inner && <Dialog name="Inner" onClose={() => setInner(false)} />}
        </Dialog>
      )}
    </>
  )
}

const open = (name = 'Open') => {
  const opener = screen.getByRole('button', { name })
  opener.focus()
  fireEvent.click(opener)
  return opener
}

it('focus moves into the dialog, or to its initial-focus element', () => {
  const { unmount } = render(<Page />)
  open()
  expect(screen.getByRole('dialog', { name: 'Outer' })).toHaveFocus()
  unmount()
  render(<Page withInitial />)
  open()
  expect(screen.getByRole('button', { name: 'Outer middle' })).toHaveFocus()
})

it('Tab wraps from the last control to the first, Shift+Tab from the first to the last', () => {
  render(<Page />)
  open()
  const first = screen.getByRole('button', { name: 'Outer first' })
  const last = screen.getByRole('button', { name: 'Outer last' })
  last.focus()
  fireEvent.keyDown(last, { key: 'Tab' })
  expect(first).toHaveFocus()
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
  expect(last).toHaveFocus()
})

it('a Tab while focus is behind the dialog brings it back inside', () => {
  render(<Page />)
  open()
  const behind = screen.getByRole('button', { name: 'Behind' })
  behind.focus()
  fireEvent.keyDown(behind, { key: 'Tab' })
  expect(screen.getByRole('button', { name: 'Outer first' })).toHaveFocus()
})

it('Escape closes it and focus returns to the opener', () => {
  render(<Page />)
  const opener = open()
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(opener).toHaveFocus()
})

it('stacked dialogs: Escape closes only the top one, and focus goes back to its opener inside the first', () => {
  render(<Page nested />)
  open()
  const innerOpener = open('Open inner')
  expect(screen.getByRole('dialog', { name: 'Inner' })).toHaveFocus()
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: 'Inner' })).toBeNull()
  expect(screen.getByRole('dialog', { name: 'Outer' })).toBeInTheDocument()
  expect(innerOpener).toHaveFocus()
})

it('restoreFocus false leaves focus to the caller (the dashboard returns it to the order row)', () => {
  render(<Page restoreFocus={false} />)
  const opener = open()
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(opener).not.toHaveFocus()
})
