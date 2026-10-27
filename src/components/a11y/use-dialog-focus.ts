'use client'

// ============================================================
// Keyboard behaviour for a modal dialog (WCAG 2.1.2, 2.4.3)
// ============================================================
//
// While `active`:
//   - focus moves into the dialog (the `initialFocus` element, or the
//     dialog itself, which needs tabIndex={-1});
//   - Tab and Shift+Tab stay inside it (wrapping at either end), so focus
//     never reaches the page behind the overlay;
//   - Escape calls `onEscape` (when given);
//   - when it closes, focus goes back to whatever had it before it opened
//     (the opener), unless `restoreFocus` is false (a caller that returns
//     focus itself, e.g. the dashboard to the order row).
// Dialogs stack: only the most recently opened one handles keys, so an
// Escape in a dialog opened over another closes just that one.

import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', 'iframe', 'audio[controls]', 'video[controls]',
  '[contenteditable]:not([contenteditable="false"])', '[tabindex]:not([tabindex="-1"])',
].join(',')

/** The dialog's tabbable elements, in order (hidden ones left out). */
export function focusableIn(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter(el => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true' && el.tabIndex >= 0)
}

const stack: symbol[] = []

export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  { active = true, onEscape, initialFocus, restoreFocus = true, returnFocusTo }: {
    active?: boolean
    onEscape?: () => void
    initialFocus?: RefObject<HTMLElement | null>
    restoreFocus?: boolean
    /** Asked at close: an element to focus instead of the opener (e.g. when the opener is about to be replaced). */
    returnFocusTo?: () => HTMLElement | null | undefined
  } = {},
) {
  const onEscapeRef = useRef(onEscape)
  const returnFocusToRef = useRef(returnFocusTo)
  useEffect(() => { onEscapeRef.current = onEscape; returnFocusToRef.current = returnFocusTo }, [onEscape, returnFocusTo])

  useEffect(() => {
    if (!active) return
    const id = Symbol('dialog')
    stack.push(id)
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const node = ref.current
    ;(initialFocus?.current ?? node)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id || !node) return
      if (e.key === 'Escape' && onEscapeRef.current) {
        e.preventDefault()
        e.stopPropagation()
        onEscapeRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusableIn(node)
      if (items.length === 0) { e.preventDefault(); node.focus(); return }
      const first = items[0]!
      const last = items[items.length - 1]!
      const current = document.activeElement
      if (!node.contains(current)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return }
      if (e.shiftKey && (current === first || current === node)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && current === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      const at = stack.indexOf(id)
      if (at !== -1) stack.splice(at, 1)
      if (!restoreFocus) return
      const target = returnFocusToRef.current?.() ?? opener
      if (target && target.isConnected) target.focus()
    }
    // initialFocus is a ref: reading .current at open time is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ref, restoreFocus])
}
