// ============================================================
// Patient protocol choice: types (PR 1 of 5, data model)
// ============================================================
//
// A provider sends a patient a treatment proposal: one or more options,
// each a set of DRAFT orders (orders.proposal_option_id), some required.
// The patient opens the plan link (/plan/{token}), checks their date of
// birth, picks one option (unticking optional items) and the provider
// then signs only what was chosen. docs/design/patient-protocol-choice.md.
//
// The link never depends on texting: the provider can copy it or show a
// QR code; the SMS (and the 48h reminder) go only when texting is on.
// How the link reached the patient is recorded as an event.
//
// Kept in step with migration 20261024000002 (the CHECK lists).

/** treatment_proposals.status, in the design's order. */
export const PROPOSAL_STATUSES = ['draft', 'sent', 'chosen', 'signed', 'declined', 'expired', 'cancelled'] as const
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]

/** treatment_proposal_events.event. No PHI is ever stored with an event. */
export const PROPOSAL_EVENTS = [
  'created',
  'sent',
  'resent',          // a new link replaced the old one (the old token is dead)
  'link_copied',     // delivery: the provider copied the link
  'qr_shown',        // delivery: the provider showed the QR code
  'sms_sent',        // delivery: texted (only when texting is enabled)
  'reminder_sent',   // the 48h reminder text (only when texting is enabled)
  'viewed',
  'dob_failed',
  'locked',          // 5 wrong dates of birth
  'chosen',
  'rechosen',
  'declined',
  'signed',
  'expired',
  'cancelled',
] as const
export type ProposalEvent = (typeof PROPOSAL_EVENTS)[number]

/** How the plan link reached the patient, and the event that records it. */
export const LINK_DELIVERY_EVENT = {
  copied: 'link_copied',
  qr:     'qr_shown',
  sms:    'sms_sent',
} as const satisfies Record<string, ProposalEvent>
export type LinkDelivery = keyof typeof LINK_DELIVERY_EVENT

/** treatment_proposal_events.actor */
export const PROPOSAL_EVENT_ACTORS = ['provider', 'clinic_staff', 'patient', 'system', 'ops'] as const
export type ProposalEventActor = (typeof PROPOSAL_EVENT_ACTORS)[number]

export const PROPOSAL_OPTION_LABEL_MAX = 80

export interface TreatmentProposal {
  proposal_id:      string
  clinic_id:        string
  patient_id:       string
  provider_id:      string
  created_by:       string | null
  status:           ProposalStatus
  token_hash:       string | null
  expires_at:       string | null
  sent_at:          string | null
  first_viewed_at:  string | null
  chosen_option_id: string | null
  chosen_at:        string | null
  signed_at:        string | null
  declined_at:      string | null
  cancelled_at:     string | null
  dob_failures:     number
  locked_at:        string | null
  created_at:       string
  updated_at:       string
}

export interface TreatmentProposalOption {
  option_id:   string
  proposal_id: string
  label:       string
  position:    number
  protocol_id: string | null
  created_at:  string
}

export interface ProposalChoiceItem {
  choice_item_id: string
  proposal_id:    string
  option_id:      string
  order_id:       string
  choice_no:      number
  created_at:     string
}

export interface TreatmentProposalEventRow {
  event_id:      string
  proposal_id:   string
  event:         ProposalEvent
  actor:         ProposalEventActor
  actor_user_id: string | null
  option_id:     string | null
  item_count:    number | null
  created_at:    string
}
