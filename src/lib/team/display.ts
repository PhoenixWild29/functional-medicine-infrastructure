// Team invites: what the Team page shows for a role or an NPI check.
// Plain module (no server imports), shared by the page and its panel.

export const ROLE_LABEL: Record<string, string> = {
  clinic_admin: 'Clinic admin',
  provider: 'Provider',
  medical_assistant: 'Medical assistant',
}

export const NPI_CHECK_LABEL: Record<string, string> = {
  verified: 'Verified',
  unverified: 'Not verified: the registry could not be reached. Re-run it below.',
  mismatch: 'Does not match the registry',
  not_found: 'Not in the registry',
  invalid: 'Not a valid NPI',
}

export function roleLabel(role: string | null | undefined): string {
  return (role && ROLE_LABEL[role]) || 'No role'
}
