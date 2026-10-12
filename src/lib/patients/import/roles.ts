// Who may import patients: the clinic admin and medical assistants.
// Providers and ops may not. No server imports, so pages can share it.

export const IMPORT_ROLES: ReadonlySet<string> = new Set(['clinic_admin', 'medical_assistant'])
