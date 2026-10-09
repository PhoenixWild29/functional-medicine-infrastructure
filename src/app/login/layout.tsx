import type { Metadata } from 'next'

// C10 (WCAG 2.4.2): a page title that says what the page is.
export const metadata: Metadata = { title: 'Sign in' }

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
