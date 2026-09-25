// ============================================================
// Pharmacy Payload Transformers — WO-19
// ============================================================
//
// Registered transformer functions map the canonical CompoundIQ
// OrderPayload to the pharmacy-specific JSON format required by
// each Tier 1 / Tier 3 pharmacy API.
//
// Registration: transformer name is stored in
//   pharmacy_api_configs.payload_transformer (TEXT column)
// Lookup: getTransformer(name) returns the function or throws
//   a configuration error if the name is unknown.
//
// Transformer naming convention: transform{PharmacyName}Payload
//
// HIPAA: OrderPayload contains PHI (patient name, DOB, address,
// medication). These values flow from server memory directly to
// the pharmacy API over HTTPS. They are never logged.
// Transformers must not add any logging of PHI fields.

import { allergiesForPayload } from '@/lib/patients/allergies'
import { parseTitrationSteps, type TitrationStep } from '@/lib/orders/titration'
import { cyclePatternFromRow, cyclePatternText, dosingDaysIn, type CyclePattern } from '@/lib/orders/cycling'

// ============================================================
// CANONICAL ORDER PAYLOAD
// ============================================================
// Input shape for all transformers. Assembled by tier1-api.ts
// from order snapshot + joined entity data.

export interface OrderPayload {
  // Order identifiers
  orderId:        string
  orderNumber:    string | null
  // Provider (frozen snapshot)
  providerFirstName:    string
  providerLastName:     string
  providerNpi:          string
  providerDea:          string | null
  providerLicenseState: string
  // Patient (loaded at submission time)
  patientFirstName:     string
  patientLastName:      string
  patientDateOfBirth:   string    // YYYY-MM-DD
  patientAddressLine1:  string | null
  patientAddressLine2:  string | null
  patientCity:          string | null
  patientState:         string | null
  patientZip:           string | null
  // WO-97: allergies live on the patient and are loaded at submission
  // time like the address. Empty list + nkda false = not recorded.
  patientAllergies:     string[]
  patientNkda:          boolean
  // Medication (frozen snapshot)
  medicationName:       string
  medicationForm:       string
  medicationDose:       string
  quantity:             number
  sigText:              string | null
  // WO-96 Rx detail fields (all tiers). Derived + defaulted at order
  // creation; null/false-y only for orders written before WO-96.
  daysSupply:           number | null
  dispenseQuantity:     number | null
  dispenseUnit:         string | null
  refills:              number
  substitutionAllowed:  boolean
  syringeOption:        string | null    // sc_kit | im_kit | insulin_syringe | none
  shippingType:         string | null    // standard | cold_chain
  clinicalDifference:   string | null
  diagnosisCode:        string | null
  diagnosisText:        string | null
  specialInstructions:  string | null
  // WO-101a: the package the pharmacy fills from, and how many. null /
  // 1 for orders written without a package. dispenseQuantity stays the
  // total the Rx needs ("9.6 mL"); the package says what it comes in
  // ("2 × 5 mL vials").
  // Optional so payloads built before WO-101a keep compiling.
  packageLabel?:        string | null
  packageCount?:        number
  // WO-105: the titration schedule, structured. Empty for every other
  // line. sigText still reads as a sentence (Tier 4 is a fax), but a
  // pharmacy that takes fields gets the steps as fields — which is the
  // whole point: "some pharmacies don't really like you to send things
  // like free text written like this because it's like too vague for
  // them with titrations" (Gina Rooks, 2026-09-11).
  // Optional so payloads built before WO-105 keep compiling.
  titrationSteps?:      ReadonlyArray<TitrationStep>
  // Cycling dose math: a cycling line's on/off pattern, structured. The
  // dispense quantity was sized from its dosing days (5 on / 2 off for
  // 30 days = 22 doses), so the pharmacy gets the pattern that explains
  // it. null for every other line. Optional so older payloads compile.
  cyclePattern?:        CyclePattern | null
  // Clinic
  clinicName:           string
}

/**
 * WO-96: read the Rx detail columns off an `orders` row into the
 * canonical payload fields. Shared by every tier so a column added later
 * lands in one place.
 */
export function rxDetailPayloadFields(order: {
  days_supply?:          number | null
  dispense_quantity?:    number | string | null
  dispense_unit?:        string | null
  refills?:              number | null
  substitution_allowed?: boolean | null
  syringe_option?:       string | null
  shipping_type?:        string | null
  clinical_difference?:  string | null
  diagnosis_code?:       string | null
  diagnosis_text?:       string | null
  special_instructions?: string | null
  package_label?:        string | null
  package_count?:        number | null
  titration_steps?:      unknown
  sig_mode?:             string | null
  cycle_on_days?:        number | null
  cycle_off_days?:       number | null
}): Pick<OrderPayload,
  'daysSupply' | 'dispenseQuantity' | 'dispenseUnit' | 'refills' | 'substitutionAllowed' |
  'syringeOption' | 'shippingType' | 'clinicalDifference' | 'diagnosisCode' | 'diagnosisText' | 'specialInstructions' |
  'packageLabel' | 'packageCount' | 'titrationSteps' | 'cyclePattern'
> {
  const dq = order.dispense_quantity
  const dispenseQuantity = typeof dq === 'string' ? Number(dq) : dq ?? null
  return {
    daysSupply:          order.days_supply ?? null,
    dispenseQuantity:    dispenseQuantity != null && Number.isFinite(dispenseQuantity) ? dispenseQuantity : null,
    dispenseUnit:        order.dispense_unit ?? null,
    refills:             order.refills ?? 0,
    substitutionAllowed: order.substitution_allowed !== false,
    syringeOption:       order.syringe_option ?? null,
    shippingType:        order.shipping_type ?? null,
    clinicalDifference:  order.clinical_difference ?? null,
    diagnosisCode:       order.diagnosis_code ?? null,
    diagnosisText:       order.diagnosis_text ?? null,
    specialInstructions: order.special_instructions ?? null,
    // WO-101a
    packageLabel:        order.package_label ?? null,
    packageCount:        typeof order.package_count === 'number' && order.package_count > 0 ? order.package_count : 1,
    // WO-105
    titrationSteps:      parseTitrationSteps(order.titration_steps),
    // Cycling dose math
    cyclePattern:        cyclePatternFromRow(order),
  }
}

/**
 * Cycling dose math: the pattern as the pharmacy receives it, with the
 * dosing days the dispense quantity was sized from. null when the line
 * is not cycling.
 */
export function cycleScheduleField(
  pattern: CyclePattern | null | undefined,
  daysSupply: number | null | undefined,
): { on_days: number; off_days: number; dosing_days: number | null; days_supply: number | null } | null {
  if (!pattern) return null
  const days = typeof daysSupply === 'number' && daysSupply > 0 ? daysSupply : null
  return {
    on_days:     pattern.onDays,
    off_days:    pattern.offDays,
    dosing_days: days != null ? dosingDaysIn(days, pattern) : null,
    days_supply: days,
  }
}

/** One line of text for free-text fields: "5 days on / 2 days off: 22 dosing days in 30 days". '' when not cycling. */
export function cycleScheduleText(pattern: CyclePattern | null | undefined, daysSupply: number | null | undefined): string {
  if (!pattern) return ''
  const days = typeof daysSupply === 'number' && daysSupply > 0 ? daysSupply : null
  return days != null
    ? `${cyclePatternText(pattern)}: ${dosingDaysIn(days, pattern)} dosing days in ${days} days`
    : cyclePatternText(pattern)
}

/**
 * WO-105: the titration schedule as the pharmacy receives it — one entry
 * per step, with the week range spelled out so the pharmacy never has to
 * count. Empty array when the line is not a titration.
 */
export function titrationScheduleField(
  steps: ReadonlyArray<TitrationStep> | undefined,
): Array<{ step: number; weeks: string; dose: string; unit: string; frequency: string; duration_weeks: number }> {
  if (!steps || steps.length === 0) return []
  const out: Array<{ step: number; weeks: string; dose: string; unit: string; frequency: string; duration_weeks: number }> = []
  let week = 1
  steps.forEach((s, i) => {
    const to = week + s.weeks - 1
    out.push({
      step:           i + 1,
      weeks:          week === to ? `Week ${week}` : `Weeks ${week}-${to}`,
      dose:           s.dose,
      unit:           s.unit,
      frequency:      s.frequency,
      duration_weeks: s.weeks,
    })
    week = to + 1
  })
  return out
}

/**
 * WO-97: read the allergy columns off a `patients` row into the
 * canonical payload fields. Shared by every tier.
 */
export function patientAllergyPayloadFields(patient: {
  allergies?: readonly string[] | null
  nkda?:      boolean | null
}): Pick<OrderPayload, 'patientAllergies' | 'patientNkda'> {
  return {
    patientAllergies: Array.isArray(patient.allergies) ? [...patient.allergies] : [],
    patientNkda:      patient.nkda === true,
  }
}

/** WO-97: the single-string form pharmacies print — "NKDA" / "penicillin, sulfa" / "Not recorded". */
function allergiesText(p: Pick<OrderPayload, 'patientAllergies' | 'patientNkda'>): string {
  return allergiesForPayload({ allergies: p.patientAllergies, nkda: p.patientNkda })
}

// Output of a transformer — pharmacy-native JSON to POST
export type PharmacyPayload = Record<string, unknown>

// Transformer function signature
type TransformerFn = (payload: OrderPayload) => PharmacyPayload

// ============================================================
// VIOS PHARMACY TRANSFORMER
// ============================================================
// Vios uses a flat JSON format with snake_case keys.
// Reference: pharmacy_api_configs.payload_transformer = 'transformViosPayload'

function transformViosPayload(p: OrderPayload): PharmacyPayload {
  return {
    external_reference: p.orderId,
    order_number:       p.orderNumber,
    prescriber: {
      first_name:     p.providerFirstName,
      last_name:      p.providerLastName,
      npi:            p.providerNpi,
      dea:            p.providerDea,
      license_state:  p.providerLicenseState,
    },
    patient: {
      first_name:   p.patientFirstName,
      last_name:    p.patientLastName,
      dob:          p.patientDateOfBirth,
      address: {
        line1: p.patientAddressLine1,
        line2: p.patientAddressLine2,
        city:  p.patientCity,
        state: p.patientState,
        zip:   p.patientZip,
      },
      // WO-97
      allergies: p.patientAllergies,
      nkda:      p.patientNkda,
    },
    medication: {
      name:      p.medicationName,
      form:      p.medicationForm,
      dose:      p.medicationDose,
      quantity:  p.quantity,
      sig:       p.sigText,
      // WO-96
      days_supply:          p.daysSupply,
      dispense_quantity:    p.dispenseQuantity,
      dispense_unit:        p.dispenseUnit,
      refills:              p.refills,
      substitution_allowed: p.substitutionAllowed,
      syringe_option:       p.syringeOption,
      shipping_type:        p.shippingType,
      clinical_difference:  p.clinicalDifference,
      diagnosis_code:       p.diagnosisCode,
      diagnosis_text:       p.diagnosisText,
      special_instructions: p.specialInstructions,
      // WO-101a
      package_label:        p.packageLabel ?? null,
      package_count:        p.packageCount ?? 1,
      // WO-105: [] for a line that is not a titration.
      titration_schedule:   titrationScheduleField(p.titrationSteps),
      // Cycling dose math: null for a line that is not cycling.
      cycle_schedule:       cycleScheduleField(p.cyclePattern, p.daysSupply),
    },
    clinic_name: p.clinicName,
  }
}

// ============================================================
// LIFEFILE PHARMACY TRANSFORMER
// ============================================================
// LifeFile uses a nested camelCase format with a "prescription" wrapper.
// Reference: pharmacy_api_configs.payload_transformer = 'transformLifeFilePayload'

function transformLifeFilePayload(p: OrderPayload): PharmacyPayload {
  return {
    clientReferenceId: p.orderId,
    prescription: {
      prescriber: {
        firstName:    p.providerFirstName,
        lastName:     p.providerLastName,
        npiNumber:    p.providerNpi,
        deaNumber:    p.providerDea ?? undefined,
        licenseState: p.providerLicenseState,
      },
      patient: {
        firstName:    p.patientFirstName,
        lastName:     p.patientLastName,
        dateOfBirth:  p.patientDateOfBirth,
        address: {
          street1: p.patientAddressLine1 ?? '',
          street2: p.patientAddressLine2 ?? '',
          city:    p.patientCity ?? '',
          state:   p.patientState ?? '',
          zipCode: p.patientZip ?? '',
        },
        // WO-97 — LifeFile takes allergies as one free-text field.
        allergies: allergiesText(p),
        nkda:      p.patientNkda,
      },
      drug: {
        brandName:   p.medicationName,
        dosageForm:  p.medicationForm,
        strength:    p.medicationDose,
        quantity:    p.quantity,
        directions:  p.sigText ?? '',
      },
      // WO-96 — LifeFile mandates a clinical-difference statement and
      // takes refills / DAW / days supply on the prescription block.
      rxDetails: {
        daysSupply:          p.daysSupply,
        dispenseQuantity:    p.dispenseQuantity,
        dispenseUnit:        p.dispenseUnit ?? '',
        refills:             p.refills,
        dispenseAsWritten:   !p.substitutionAllowed,
        syringeOption:       p.syringeOption ?? 'none',
        shippingType:        p.shippingType ?? 'standard',
        clinicalDifference:  p.clinicalDifference ?? '',
        diagnosisCode:       p.diagnosisCode ?? '',
        diagnosisText:       p.diagnosisText ?? '',
        specialInstructions: p.specialInstructions ?? '',
        // WO-105
        titrationSchedule:   titrationScheduleField(p.titrationSteps),
        // Cycling dose math
        cycleSchedule:       cycleScheduleField(p.cyclePattern, p.daysSupply),
        // WO-101a
        packageLabel:        p.packageLabel ?? '',
        packageCount:        p.packageCount ?? 1,
      },
      clinic: p.clinicName,
    },
  }
}

// ============================================================
// MEDIVERA PHARMACY TRANSFORMER
// ============================================================
// MediVera uses an XML-inspired flat JSON with PascalCase keys.
// Reference: pharmacy_api_configs.payload_transformer = 'transformMediVeraPayload'

function transformMediVeraPayload(p: OrderPayload): PharmacyPayload {
  return {
    ReferenceID:    p.orderId,
    OrderNumber:    p.orderNumber ?? '',
    PrescriberInfo: {
      FirstName:    p.providerFirstName,
      LastName:     p.providerLastName,
      NPI:          p.providerNpi,
      DEA:          p.providerDea ?? '',
      LicenseState: p.providerLicenseState,
    },
    PatientInfo: {
      FirstName:    p.patientFirstName,
      LastName:     p.patientLastName,
      DOB:          p.patientDateOfBirth,
      AddressLine1: p.patientAddressLine1 ?? '',
      AddressLine2: p.patientAddressLine2 ?? '',
      City:         p.patientCity ?? '',
      State:        p.patientState ?? '',
      PostalCode:   p.patientZip ?? '',
      // WO-97
      Allergies:    allergiesText(p),
      NKDA:         p.patientNkda ? 'Y' : 'N',
    },
    RxInfo: {
      MedicationName: p.medicationName,
      Form:           p.medicationForm,
      Dose:           p.medicationDose,
      Qty:            p.quantity,
      SigText:        p.sigText ?? '',
      // WO-96
      DaysSupply:          p.daysSupply ?? '',
      DispenseQty:         p.dispenseQuantity ?? '',
      DispenseUnit:        p.dispenseUnit ?? '',
      Refills:             p.refills,
      DAW:                 p.substitutionAllowed ? 'N' : 'Y',
      SyringeOption:       p.syringeOption ?? 'none',
      ShippingType:        p.shippingType ?? 'standard',
      ClinicalDifference:  p.clinicalDifference ?? '',
      DiagnosisCode:       p.diagnosisCode ?? '',
      DiagnosisText:       p.diagnosisText ?? '',
      SpecialInstructions: p.specialInstructions ?? '',
      // WO-101a
      PackageLabel:        p.packageLabel ?? '',
      PackageCount:        p.packageCount ?? 1,
      // Cycling dose math — MediVera's RxInfo is flat text fields.
      CycleSchedule:       cycleScheduleText(p.cyclePattern, p.daysSupply),
    },
    ClinicName: p.clinicName,
  }
}

// ============================================================
// TIER 3 STANDARDIZED SPEC TRANSFORMER — WO-21
// ============================================================
// Tier 3 pharmacies implement the CompoundIQ canonical OpenAPI spec,
// so they accept the OrderPayload natively — no transformation needed.
// (AC-SPC-002.2: "passes the canonical OrderPayload through without
// modification, since Tier 3 pharmacies accept the CompoundIQ-native
// schema directly")
// Reference: pharmacy_api_configs.payload_transformer = 'tier3_standard'

function transformTier3StandardPayload(p: OrderPayload): PharmacyPayload {
  return p as unknown as PharmacyPayload
}

// ============================================================
// GENERIC FALLBACK TRANSFORMER
// ============================================================
// Used when no specific transformer is configured.
// Sends the canonical OrderPayload as-is (pharmacy must accept it).

function transformGenericPayload(p: OrderPayload): PharmacyPayload {
  return p as unknown as PharmacyPayload
}

// ============================================================
// REGISTRY + LOOKUP
// ============================================================

const TRANSFORMER_REGISTRY: Record<string, TransformerFn> = {
  transformViosPayload,
  transformLifeFilePayload,
  transformMediVeraPayload,
  tier3_standard: transformTier3StandardPayload,
  transformGenericPayload,
}

/**
 * Returns the registered transformer function for the given name.
 * Throws a configuration error if the transformer is not registered.
 *
 * @param name - Value from pharmacy_api_configs.payload_transformer
 */
export function getTransformer(name: string | null | undefined): TransformerFn {
  if (!name) return transformGenericPayload

  const fn = TRANSFORMER_REGISTRY[name]
  if (!fn) {
    throw new Error(
      `[transformers] unknown transformer '${name}' — register it in TRANSFORMER_REGISTRY`
    )
  }
  return fn
}
