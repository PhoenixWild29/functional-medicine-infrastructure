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
  // Medication (frozen snapshot)
  medicationName:       string
  medicationForm:       string
  medicationDose:       string
  quantity:             number
  sigText:              string | null
  // Clinic
  clinicName:           string
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
    },
    medication: {
      name:      p.medicationName,
      form:      p.medicationForm,
      dose:      p.medicationDose,
      quantity:  p.quantity,
      sig:       p.sigText,
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
      },
      drug: {
        brandName:   p.medicationName,
        dosageForm:  p.medicationForm,
        strength:    p.medicationDose,
        quantity:    p.quantity,
        directions:  p.sigText ?? '',
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
    },
    RxInfo: {
      MedicationName: p.medicationName,
      Form:           p.medicationForm,
      Dose:           p.medicationDose,
      Qty:            p.quantity,
      SigText:        p.sigText ?? '',
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
