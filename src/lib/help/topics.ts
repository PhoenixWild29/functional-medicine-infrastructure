// ============================================================
// In-app Help for clinic staff (/help)
// ============================================================
//
// Short task pages a pilot clinic can use to answer its own "how do I"
// questions. Plain language; every button or field named is quoted
// exactly as the app shows it, and listed in `labels` with the file that
// renders it, so a test (src/lib/help/__tests__/topics.test.ts) fails
// when a label is renamed and the help would point at nothing.
//
// No screenshots, no external links. Saved clinical difference statements
// are not described: that feature is not in this branch's base yet.

export interface HelpLabel {
  /** The exact text, as it appears on screen (and so in the source). */
  text: string
  /** The file that renders it, relative to src/. */
  file: string
}

export interface HelpSection {
  heading: string
  /** Plain sentences or numbered steps; a label is written in quotes. */
  steps:   string[]
}

export interface HelpTopic {
  slug:     string
  title:    string
  summary:  string
  sections: HelpSection[]
  labels:   HelpLabel[]
}

const NP = 'app/(clinic-app)/new-prescription'
const DASH = 'app/(clinic-app)/dashboard'
const SETTINGS = 'app/(clinic-app)/settings'

/** Who to contact. No support address is configured in the app yet. */
export const HELP_CONTACT = 'Contact CompoundIQ'

export const HELP_TOPICS: HelpTopic[] = [
  {
    slug: 'add-a-patient',
    title: 'Add a patient',
    summary: 'Text the patient a link, let walk-ins sign up with a QR code, or upload a list.',
    sections: [
      {
        heading: 'Text the patient a link (most common)',
        steps: [
          'Go to New Prescription and click "+ New patient".',
          'Enter the patient\'s "Mobile number". Their name and state are optional; the patient fills in the rest.',
          'Click "Add patient". The patient gets a secure link to enter their details, allergies and consent to texts on their phone.',
          'If texting is not set up, click "Copy link" and send it to the patient yourself.',
          'You can prescribe right away. Nothing is signed or charged until the patient finishes.',
          'If the app asks "Is this the same patient?", pick the existing patient rather than adding a duplicate.',
        ],
      },
      {
        heading: 'Fill the form from a face sheet',
        steps: [
          'When it is switched on for your clinic, the new-patient form shows "Drop a face sheet". Drop a PDF, PNG or JPG (up to 4 MB) and check the fields it fills.',
        ],
      },
      {
        heading: 'Let walk-in patients sign themselves up',
        steps: [
          'Go to Settings and click "Patient sign-up link".',
          'The first time, a clinic admin clicks "Create a sign-up link".',
          'Click "Print" for a sheet with the QR code for your waiting room, or "Copy link" to share it.',
        ],
      },
      {
        heading: 'Upload a list of patients',
        steps: [
          'Go to Settings and click "Import patients".',
          'Choose a .csv file (up to 4 MB) and click "Upload and check columns".',
          'Match your columns to ours, then click "Check rows" and fix anything flagged before you import.',
        ],
      },
    ],
    labels: [
      { text: '+ New patient', file: `${NP}/_components/patient-provider-selector.tsx` },
      { text: 'Mobile number', file: `${NP}/_components/new-patient-form.tsx` },
      { text: 'Add patient', file: `${NP}/_components/new-patient-form.tsx` },
      { text: 'Is this the same patient?', file: `${NP}/_components/new-patient-form.tsx` },
      { text: 'Drop a face sheet', file: `${NP}/_components/new-patient-form.tsx` },
      { text: 'Copy link', file: 'components/intake-link-panel.tsx' },
      { text: 'Patient sign-up link', file: `${SETTINGS}/page.tsx` },
      { text: 'Create a sign-up link', file: `${SETTINGS}/patients/signup-link/_components/signup-link-panel.tsx` },
      { text: 'Print', file: `${SETTINGS}/patients/signup-link/_components/signup-link-panel.tsx` },
      { text: 'Import patients', file: `${SETTINGS}/page.tsx` },
      { text: 'Upload and check columns', file: `${SETTINGS}/patients/import/_components/import-wizard.tsx` },
      { text: 'Check rows', file: `${SETTINGS}/patients/import/_components/import-wizard.tsx` },
    ],
  },
  {
    slug: 'write-and-sign',
    title: 'Write and sign a prescription',
    summary: 'Build the prescription, check what the pharmacy receives, and sign one or many at once.',
    sections: [
      {
        heading: 'Build it',
        steps: [
          'Click "+ New Prescription", choose the patient (and provider), then search for the medication in "Search medications".',
          'Choose the formulation, then set "Dose amount", "Dose unit", "Frequency" and "Duration". The days supply and the number of vials are worked out for you.',
          'Pick a pharmacy. Each card shows the price, the suggested vials and the shipping it adds.',
          'Choose "Refills" (0 to 12), then click "Continue to Set Retail Price", set the price, and go to "Review & Send".',
        ],
      },
      {
        heading: 'Check what the pharmacy receives',
        steps: [
          'On each card, open "Rx details": days supply, how much to dispense and in which vials, refills, "Syringe option", "Shipping" (cold chain for GLP-1s), the clinical difference reason, "Diagnosis code" and "Special instructions (optional)".',
          'GLP-1s need a "Clinical difference" reason. Choose one, or choose "Other (describe)" and type the patient-specific reason.',
          'Allergies or "no known drug allergies" are required before signing. If the patient has none recorded, click "Confirm NKDA", or "Record allergies" to enter them.',
          'To change a line, click "Edit", change it, then "Save Changes and Back to Review".',
        ],
      },
      {
        heading: 'Sign',
        steps: [
          'A provider signs once for every prescription on the page. The patient then gets one payment link.',
          'Not ready to sign? Click "Save as Draft: Provider Signs Later".',
          'To sign saved drafts together, open the dashboard "Drafts" tab and click "Sign all".',
          'If the order uses two pharmacies, a notice shows that shipping is charged twice, and Review can move everything to one pharmacy when that is cheaper.',
        ],
      },
    ],
    labels: [
      { text: '+ New Prescription', file: `${DASH}/_components/orders-dashboard.tsx` },
      { text: 'Search medications', file: `${NP}/_components/cascading-prescription-builder.tsx` },
      { text: 'Dose amount', file: `${NP}/_components/structured-sig-builder.tsx` },
      { text: 'Dose unit', file: `${NP}/_components/structured-sig-builder.tsx` },
      { text: 'Frequency', file: `${NP}/_components/structured-sig-builder.tsx` },
      { text: 'Duration', file: `${NP}/_components/structured-sig-builder.tsx` },
      { text: 'Refills', file: `${NP}/_components/cascading-prescription-builder.tsx` },
      { text: 'Continue to Set Retail Price', file: `${NP}/_components/cascading-prescription-builder.tsx` },
      { text: 'Review & Send', file: `${NP}/review/page.tsx` },
      { text: 'Rx details', file: `${NP}/review/_components/rx-details-row.tsx` },
      { text: 'Syringe option', file: `${NP}/review/_components/rx-details-row.tsx` },
      { text: 'Shipping', file: `${NP}/review/_components/rx-details-row.tsx` },
      { text: 'Clinical difference', file: `${NP}/review/_components/rx-details-row.tsx` },
      { text: 'Other (describe)', file: `${NP}/review/_components/rx-details-row.tsx` },
      { text: 'Diagnosis code', file: `${NP}/review/_components/rx-details-row.tsx` },
      { text: 'Special instructions (optional)', file: `${NP}/review/_components/rx-details-row.tsx` },
      { text: 'Confirm NKDA', file: `${NP}/review/_components/allergy-notice.tsx` },
      { text: 'Record allergies', file: `${NP}/review/_components/allergy-notice.tsx` },
      { text: 'Edit', file: `${NP}/review/_components/batch-review-form.tsx` },
      { text: 'Save Changes and Back to Review', file: `${NP}/margin/_components/margin-builder-form.tsx` },
      { text: 'Save as Draft: Provider Signs Later', file: `${NP}/review/_components/batch-review-form.tsx` },
      { text: 'Drafts', file: `${DASH}/_lib/tabs.ts` },
      { text: 'Sign all (', file: `${DASH}/_components/orders-dashboard.tsx` },
    ],
  },
  {
    slug: 'favorites',
    title: 'Favorites and Frequently used',
    summary: 'Prescribe your common doses in one click.',
    sections: [
      {
        heading: 'Use a favorite',
        steps: [
          'On New Prescription, click "Favorites". Each drug has its common doses as buttons; click one to open the dose step already filled in, or "Custom" to enter your own.',
          'Favorites are grouped by category and sorted A to Z. Favorites saved for the selected patient come first.',
        ],
      },
      {
        heading: 'Save a favorite',
        steps: [
          'While writing a prescription, click "Save as favorite". Choose whether it is for the practice or only for this patient.',
        ],
      },
      {
        heading: 'Frequently used',
        steps: [
          'At the top of Favorites, "Frequently used" lists the doses you ordered most in the last 90 days, with how many times.',
          'Click "Make favorite" to keep one. Choose "The practice" or "Only for" this patient, tick the doses to include, and click "Save favorite".',
        ],
      },
    ],
    labels: [
      { text: 'Favorites (', file: `${NP}/_components/quick-actions-panel.tsx` },
      { text: 'Custom', file: `${NP}/_components/quick-actions-panel.tsx` },
      { text: 'Save as favorite', file: `${NP}/_components/save-favorite-button.tsx` },
      { text: 'Frequently used', file: `${NP}/_components/quick-actions-panel.tsx` },
      { text: 'Make favorite', file: `${NP}/_components/quick-actions-panel.tsx` },
      { text: 'The practice', file: `${NP}/_components/make-favorite-dialog.tsx` },
      { text: 'Only for', file: `${NP}/_components/make-favorite-dialog.tsx` },
      { text: 'Save favorite', file: `${NP}/_components/make-favorite-dialog.tsx` },
    ],
  },
  {
    slug: 'treatment-plans',
    title: 'Send a treatment plan for the patient to choose',
    summary: 'Offer options, let the patient choose on their phone, then sign only what they chose.',
    sections: [
      {
        heading: 'Send the plan',
        steps: [
          'Build the prescriptions as usual and go to "Review & Send".',
          'Under "Let the patient choose", tick "Send the patient a plan to choose from, instead of signing now".',
          'Name each option for the patient. Use "Add an option" for more, and mark the items the patient must keep as required.',
          'Click "Send to patient for choice". Nothing is signed or charged yet.',
          'Under "Share the plan link", click "Copy link" or "Show QR code" to share it. It is texted too when texting is set up and the patient agreed to texts.',
        ],
      },
      {
        heading: 'What the patient does',
        steps: [
          'The patient confirms their date of birth, sees the options with estimated prices, can untick optional items, and chooses. The link works for 7 days.',
        ],
      },
      {
        heading: 'Sign the choice',
        steps: [
          'The dashboard shows "Plans ready to sign". Click "Review and sign" and sign; only the chosen items are signed, the rest are cancelled.',
          'Plans still waiting for the patient are on the dashboard "Proposed" tab, where you can resend the link or "Cancel the plan".',
        ],
      },
    ],
    labels: [
      { text: 'Let the patient choose', file: `${NP}/review/_components/batch-review-form.tsx` },
      { text: 'Send the patient a plan to choose from, instead of signing now', file: `${NP}/review/_components/batch-review-form.tsx` },
      { text: 'Add an option', file: `${NP}/review/_components/proposal-options.tsx` },
      { text: 'Send to patient for choice', file: `${NP}/review/_components/batch-review-form.tsx` },
      { text: 'Share the plan link', file: 'components/proposals/plan-link-panel.tsx' },
      { text: 'Copy link', file: 'components/proposals/plan-link-panel.tsx' },
      { text: 'Show QR code', file: 'components/proposals/plan-link-panel.tsx' },
      { text: 'Plans ready to sign', file: `${DASH}/_components/chosen-plans-queue.tsx` },
      { text: 'Review and sign', file: `${DASH}/_components/chosen-plans-queue.tsx` },
      { text: 'Proposed', file: `${DASH}/_lib/tabs.ts` },
      { text: 'Cancel the plan', file: `${DASH}/_components/proposal-panel.tsx` },
    ],
  },
  {
    slug: 'payment-links',
    title: 'Payment links',
    summary: 'What the patient sees, how long a link lasts, and how to send another.',
    sections: [
      {
        heading: 'What the patient sees',
        steps: [
          'After a provider signs, the patient gets one payment link. The page shows the "Amount due" and a card form; it never shows the medication or diagnosis. HSA and FSA cards work like any card.',
        ],
      },
      {
        heading: 'Expiry and resending',
        steps: [
          'A payment link works for 72 hours. To send another, open the order on the dashboard and click "Copy Payment Link", or "Regenerate Payment Link" once it has expired, and send it to the patient.',
          'If a patient has several unpaid prescriptions, "Combine into one payment link" puts them on one link, so shipping is charged once per pharmacy.',
        ],
      },
    ],
    labels: [
      { text: 'Amount due', file: 'app/checkout/[token]/_components/checkout-page-content.tsx' },
      { text: 'Copy Payment Link', file: `${DASH}/_components/order-drawer.tsx` },
      { text: 'Regenerate Payment Link', file: `${DASH}/_components/order-drawer.tsx` },
      { text: 'Combine into one payment link', file: `${DASH}/_components/order-drawer.tsx` },
    ],
  },
  {
    slug: 'order-status',
    title: 'Order status',
    summary: 'What each dashboard tab means, and what to do when an order shows a problem.',
    sections: [
      {
        heading: 'The dashboard tabs',
        steps: [
          '"Drafts": written, not signed yet.',
          '"Proposed": a plan waiting for the patient to choose.',
          '"Pending Payment": signed; the patient has not paid yet.',
          '"Submitting": paid; being sent to the pharmacy.',
          '"Processing": the pharmacy is preparing it.',
          '"Shipped": on its way, with tracking when the pharmacy provides it.',
          '"Errors": something needs attention.',
        ],
      },
      {
        heading: 'When an order shows a problem',
        steps: [
          'Open the order. If it could not be sent to the pharmacy, it says why in plain words and that "CompoundIQ ops has been alerted". You do not need to do anything; CompoundIQ re-routes or retries it.',
          'If a payment failed or a link expired, send the patient a new payment link (see Payment links).',
        ],
      },
    ],
    labels: [
      { text: 'Drafts', file: `${DASH}/_lib/tabs.ts` },
      { text: 'Proposed', file: `${DASH}/_lib/tabs.ts` },
      { text: 'Pending Payment', file: `${DASH}/_lib/tabs.ts` },
      { text: 'Submitting', file: `${DASH}/_lib/tabs.ts` },
      { text: 'Processing', file: `${DASH}/_lib/tabs.ts` },
      { text: 'Shipped', file: `${DASH}/_lib/tabs.ts` },
      { text: 'Errors', file: `${DASH}/_lib/tabs.ts` },
      { text: 'CompoundIQ ops has been alerted', file: 'lib/orders/submission-failure.ts' },
    ],
  },
  {
    slug: 'team',
    title: 'Team',
    summary: 'Add a provider, invite a medical assistant or admin, and turn off access.',
    sections: [
      {
        heading: 'Add a provider (clinic admin)',
        steps: [
          'Go to Settings, then Team, and fill in "Add a provider": name, email, NPI and state licenses. Click "Add provider".',
          'Copy the invite link it shows and send it to the provider yourself. CompoundIQ does not email it. The link works once, for 7 days.',
          'The NPI is checked against the national registry. A provider can only sign with a verified NPI and a current license in the patient\'s state.',
        ],
      },
      {
        heading: 'Invite a medical assistant or another admin',
        steps: [
          'Use "Invite a medical assistant or clinic admin" and click "Create invite", then copy the link and send it.',
          'Waiting invites are listed under "Pending invites", where you can "Resend" or "Revoke" them.',
        ],
      },
      {
        heading: 'Turn off access',
        steps: [
          'Click "Deactivate" next to the person, then "Yes, deactivate". They are signed out at once; their history is kept, and "Reactivate" turns access back on.',
        ],
      },
    ],
    labels: [
      { text: 'Add a provider', file: `${SETTINGS}/team/_components/team-panel.tsx` },
      { text: 'Add provider', file: `${SETTINGS}/team/_components/team-panel.tsx` },
      { text: 'Invite a medical assistant or clinic admin', file: `${SETTINGS}/team/_components/team-panel.tsx` },
      { text: 'Create invite', file: `${SETTINGS}/team/_components/team-panel.tsx` },
      { text: 'Pending invites', file: `${SETTINGS}/team/_components/team-panel.tsx` },
      { text: 'Resend', file: `${SETTINGS}/team/_components/team-panel.tsx` },
      { text: 'Revoke', file: `${SETTINGS}/team/_components/team-panel.tsx` },
      { text: 'Deactivate', file: `${SETTINGS}/team/_components/team-panel.tsx` },
      { text: 'Yes, deactivate', file: `${SETTINGS}/team/_components/team-panel.tsx` },
      { text: 'Reactivate', file: `${SETTINGS}/team/_components/team-panel.tsx` },
    ],
  },
  {
    slug: 'settings',
    title: 'Settings',
    summary: 'Practice details, what is sent to patients, the access log and your agreements.',
    sections: [
      {
        heading: 'Practice details (clinic admin)',
        steps: [
          'Under "Practice details", keep your legal name, address, phone and NPI current; they appear on prescriptions. Click "Save practice details".',
          'A clinic admin can let providers see the practice dashboard with "Show the practice dashboard to providers".',
        ],
      },
      {
        heading: 'Notifications',
        steps: [
          'Click "See what is sent" for the list of texts CompoundIQ sends your patients and what your team sees in the app. It also says whether texting is on. CompoundIQ does not send email.',
        ],
      },
      {
        heading: 'Access log (clinic admin)',
        steps: [
          'Click "Open the access log" to see who viewed or changed a patient\'s record, and when. Filter by patient and date.',
        ],
      },
      {
        heading: 'Agreements',
        steps: [
          'Under "Agreements" you can read the exact text your clinic accepted. When a new version is available, a clinic admin accepts it there.',
        ],
      },
    ],
    labels: [
      { text: 'Practice details', file: `${SETTINGS}/_components/practice-details-form.tsx` },
      { text: 'Save practice details', file: `${SETTINGS}/_components/practice-details-form.tsx` },
      { text: 'Show the practice dashboard to providers', file: `${SETTINGS}/_components/clinic-settings-form.tsx` },
      { text: 'See what is sent', file: `${SETTINGS}/page.tsx` },
      { text: 'Open the access log', file: `${SETTINGS}/page.tsx` },
      { text: 'Agreements', file: `${SETTINGS}/agreements/page.tsx` },
    ],
  },
  {
    slug: 'contact',
    title: 'Who to contact',
    summary: 'When this help does not answer your question.',
    sections: [
      {
        heading: 'Getting help',
        steps: [
          `${HELP_CONTACT} through your CompoundIQ account contact. For a problem with one order, include the order number shown on the dashboard.`,
          'Questions about a patient\'s medication or treatment go to the pharmacy or the prescribing provider, not CompoundIQ.',
        ],
      },
    ],
    labels: [],
  },
]

export function helpTopic(slug: string): HelpTopic | undefined {
  return HELP_TOPICS.find(t => t.slug === slug)
}
