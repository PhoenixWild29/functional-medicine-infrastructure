// ============================================================
// /onboard/* — invite pages (public: the token is the credential)
// ============================================================
//
// Minimal, mobile-first shell with a single <main> landmark. No session
// is read here: the visitor has no account yet.

export default function OnboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-xl items-center px-4 py-4">
          <span className="text-lg font-bold tracking-tight text-foreground">CompoundIQ</span>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-10">{children}</main>
    </div>
  )
}
