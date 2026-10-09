// The one text a patient gets to start intake (spec v1.1, PR 2). No PHI:
// the clinic's name and the link, nothing about the patient, a
// prescription or a pharmacy. A plain module: staff screens use the same
// wording for "Email this link".

export function intakeSmsText(clinicName: string, url: string): string {
  return `${clinicName} has sent you a secure link to complete your details: ${url}`
}
