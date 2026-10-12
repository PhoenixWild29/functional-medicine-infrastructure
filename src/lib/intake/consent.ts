// ============================================================
// Intake consent wording and versions (Patient Intake PR 2)
// ============================================================
//
// The exact words a patient agrees to are stored by version on the
// patient (sms_consent_text_version, privacy_notice_version). Change the
// wording, change the version: a stored version must always mean the words
// the patient saw. Plain module: the intake page and the API both use it.

export const SMS_CONSENT_TEXT_VERSION = 'intake-sms-2026-10-v1'
export const SMS_CONSENT_TEXT =
  'I agree to receive text messages about my prescriptions, payments and deliveries at this number. Message and data rates may apply. Reply STOP to opt out at any time.'

export const PRIVACY_NOTICE_VERSION = 'privacy-notice-2026-10-v1'

/** Where the source of a consent decision made on the intake page is recorded. */
export const INTAKE_CONSENT_SOURCE = 'self_intake'

export const ID_SCAN_PURPOSE =
  'If you choose to scan your driver’s license, the barcode on the back of your license is read on this phone to fill in your name, date of birth, sex and address. The picture of your license is not saved, and nothing is uploaded: only the details you confirm are sent to your clinic.'
