// ============================================================
// Pharmacy Response Parsers — WO-19
// ============================================================
//
// Registered parser functions map a pharmacy HTTP response body
// to the canonical SubmissionResult used by the audit trail.
//
// Registration: parser name is stored in
//   pharmacy_api_configs.response_parser (TEXT column)
// Lookup: getParser(name) returns the function or throws
//   a configuration error if the name is unknown.
//
// Parser naming convention: parse{PharmacyName}Response
//
// The parser is responsible for:
//   1. Extracting external_order_id (pharmacy's reference number)
//      → stored in adapter_submissions.external_reference_id
//   2. Classifying the outcome: accepted | rejected | unknown
//      'accepted'  = pharmacy received and queued the order
//      'rejected'  = pharmacy explicitly refused (non-retriable)
//      'unknown'   = response is ambiguous (treat as transient, retry)
//   3. Extracting error_code and error_message on failure

// ============================================================
// RESULT TYPE
// ============================================================

export type SubmissionOutcome = 'accepted' | 'rejected' | 'unknown'

export interface SubmissionResult {
  outcome:         SubmissionOutcome
  externalOrderId: string | null   // pharmacy's reference number (REQ-AAT-004)
  errorCode:       string | null
  errorMessage:    string | null
}

// Parser function signature
type ParserFn = (
  statusCode: number,
  body: Record<string, unknown>
) => SubmissionResult

// ============================================================
// VIOS RESPONSE PARSER
// ============================================================
// Vios returns:
//   200/201 success: { order_id: "vios-xxx", status: "received" }
//   422 rejection:   { error_code: "DRUG_UNAVAILABLE", message: "..." }
//   5xx / others:    treat as transient (unknown)

function parseViosResponse(statusCode: number, body: Record<string, unknown>): SubmissionResult {
  if (statusCode === 200 || statusCode === 201) {
    return {
      outcome:         'accepted',
      externalOrderId: body['order_id'] as string | null ?? null,
      errorCode:       null,
      errorMessage:    null,
    }
  }

  if (statusCode === 422) {
    return {
      outcome:         'rejected',
      externalOrderId: null,
      errorCode:       (body['error_code'] as string | null) ?? 'REJECTED',
      errorMessage:    (body['message'] as string | null) ?? null,
    }
  }

  return {
    outcome:         'unknown',
    externalOrderId: null,
    errorCode:       String(statusCode),
    errorMessage:    (body['message'] as string | null) ?? `HTTP ${statusCode}`,
  }
}

// ============================================================
// LIFEFILE RESPONSE PARSER
// ============================================================
// LifeFile returns:
//   200/201 success: { prescriptionId: "lf-xxx", status: "ACCEPTED" }
//   400 rejection:   { status: "REJECTED", reason: "...", code: "..." }
//   5xx:             transient

function parseLifeFileResponse(statusCode: number, body: Record<string, unknown>): SubmissionResult {
  if ((statusCode === 200 || statusCode === 201) && body['status'] === 'ACCEPTED') {
    return {
      outcome:         'accepted',
      externalOrderId: (body['prescriptionId'] as string | null) ?? null,
      errorCode:       null,
      errorMessage:    null,
    }
  }

  if (statusCode === 400 && body['status'] === 'REJECTED') {
    return {
      outcome:         'rejected',
      externalOrderId: null,
      errorCode:       (body['code'] as string | null) ?? 'REJECTED',
      errorMessage:    (body['reason'] as string | null) ?? null,
    }
  }

  return {
    outcome:         'unknown',
    externalOrderId: null,
    errorCode:       String(statusCode),
    errorMessage:    (body['reason'] as string | null) ?? `HTTP ${statusCode}`,
  }
}

// ============================================================
// MEDIVERA RESPONSE PARSER
// ============================================================
// MediVera returns:
//   200 success:     { Success: true, ReferenceID: "mv-xxx" }
//   200 rejection:   { Success: false, ErrorCode: "...", ErrorMsg: "..." }
//   4xx/5xx:         transient (non-200 is always unexpected)

function parseMediVeraResponse(statusCode: number, body: Record<string, unknown>): SubmissionResult {
  if (statusCode === 200 && body['Success'] === true) {
    return {
      outcome:         'accepted',
      externalOrderId: (body['ReferenceID'] as string | null) ?? null,
      errorCode:       null,
      errorMessage:    null,
    }
  }

  if (statusCode === 200 && body['Success'] === false) {
    return {
      outcome:         'rejected',
      externalOrderId: null,
      errorCode:       (body['ErrorCode'] as string | null) ?? 'REJECTED',
      errorMessage:    (body['ErrorMsg'] as string | null) ?? null,
    }
  }

  return {
    outcome:         'unknown',
    externalOrderId: null,
    errorCode:       String(statusCode),
    errorMessage:    (body['ErrorMsg'] as string | null) ?? `HTTP ${statusCode}`,
  }
}

// ============================================================
// GENERIC FALLBACK PARSER
// ============================================================
// For pharmacies without a specific parser.
// 2xx = accepted (extracts common field names for external ID).
// 4xx = rejected. 5xx = unknown (transient).

function parseGenericResponse(statusCode: number, body: Record<string, unknown>): SubmissionResult {
  if (statusCode >= 200 && statusCode < 300) {
    const externalId =
      (body['order_id'] ?? body['orderId'] ?? body['id'] ?? body['referenceId'] ?? null) as string | null

    return {
      outcome:         'accepted',
      externalOrderId: externalId,
      errorCode:       null,
      errorMessage:    null,
    }
  }

  if (statusCode >= 400 && statusCode < 500) {
    return {
      outcome:         'rejected',
      externalOrderId: null,
      errorCode:       (body['error_code'] ?? body['code'] ?? String(statusCode)) as string,
      errorMessage:    (body['message'] ?? body['error'] ?? `HTTP ${statusCode}`) as string,
    }
  }

  return {
    outcome:         'unknown',
    externalOrderId: null,
    errorCode:       String(statusCode),
    errorMessage:    (body['message'] ?? `HTTP ${statusCode}`) as string,
  }
}

// ============================================================
// REGISTRY + LOOKUP
// ============================================================

const PARSER_REGISTRY: Record<string, ParserFn> = {
  parseViosResponse,
  parseLifeFileResponse,
  parseMediVeraResponse,
  parseGenericResponse,
}

/**
 * Returns the registered parser function for the given name.
 * Falls back to parseGenericResponse if name is null/unknown.
 *
 * @param name - Value from pharmacy_api_configs.response_parser
 */
export function getParser(name: string | null | undefined): ParserFn {
  if (!name) return parseGenericResponse

  const fn = PARSER_REGISTRY[name]
  if (!fn) {
    console.warn(
      `[parsers] unknown parser '${name}' — falling back to parseGenericResponse`
    )
    return parseGenericResponse
  }
  return fn
}
