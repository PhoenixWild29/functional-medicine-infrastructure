// ============================================================
// /forgot-password (B11)
// ============================================================
//
// Public: for someone who cannot sign in. Supabase Auth emails the reset
// link; it comes back through /auth/callback to /reset-password.

import { ForgotPasswordForm } from './_components/forgot-password-form'

export const metadata = {
  title: 'Reset your password',
}

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-8 text-center text-2xl font-bold tracking-tight text-foreground">CompoundIQ</p>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Reset your password</h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">
          Enter the email you sign in with. We will email you a link to set a new password.
        </p>
        <ForgotPasswordForm />
      </div>
    </main>
  )
}
