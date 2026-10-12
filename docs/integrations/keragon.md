# EHR patient sync via Keragon

Patient Intake v1.1, PR 5b. A clinic's EHR sends patients to CompoundIQ through
Keragon. Our side is built and switched off until a clinic admin generates a
shared secret. **Do not connect a real clinic until the Keragon account and
the BAA with Keragon are in place.**

## Setup (per clinic)

1. The clinic admin opens **Settings > Integrations > EHR sync** and selects
   **Generate secret**. The page shows, once:
   - the **webhook URL**: `https://<app host>/api/integrations/keragon/patients`
   - the **connection id** (not secret)
   - the **shared secret** (`kgn_whsec_...`). It is stored only in Supabase
     Vault and cannot be shown again; copy it straight into Keragon.
2. In Keragon, build a workflow from the EHR's "patient created / updated"
   trigger to an HTTP request: `POST` the webhook URL with the JSON below and
   the three headers in [Signing](#signing).
3. Send a test patient. The sync log on the same page shows it (applied,
   skipped, flagged or error).
4. **Rotate secret** writes a new secret into the same Vault entry: the old one
   stops working at once, so update Keragon straight away.
   **Disconnect** deletes the secret; every request is refused until a new
   one is generated.

Ops see every clinic's connection status at **/ops/integrations**.

## Signing

Every request carries:

| Header | Value |
|---|---|
| `x-compoundiq-connection` | the clinic's connection id |
| `x-compoundiq-timestamp` | unix time in seconds when it was signed |
| `x-compoundiq-signature` | `v1=` + hex HMAC-SHA256 |

The HMAC key is the shared secret. The message is the timestamp, a dot, and
the **raw request body exactly as sent**:

```
signature = "v1=" + hex(HMAC_SHA256(secret, timestamp + "." + rawBody))
```

Node example:

```js
const ts = Math.floor(Date.now() / 1000).toString()
const sig = 'v1=' + crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
```

A timestamp more than **5 minutes** from our clock is refused. The signature
is compared in constant time. Each `event_id` is accepted once per
connection.

## Contract

`Content-Type: application/json`. Samples:
`src/lib/integrations/keragon/__fixtures__/patient-upsert-full.json`,
`patient-upsert-minimal.json`, `patient-upsert-invalid.json`.

```json
{
  "event_id": "evt_demo_0001",
  "event_type": "patient.upsert",
  "occurred_at": "2026-10-12T15:00:00Z",
  "patient": {
    "external_patient_id": "EHR-DEMO-10001",
    "first_name": "Jordan",
    "last_name": "Sample",
    "date_of_birth": "1985-04-12",
    "sex": "female",
    "mobile": "+15125550147",
    "email": "jordan.sample@example.com",
    "address": { "line1": "100 Example St", "line2": "Apt 4", "city": "Austin", "state": "TX", "zip": "78701" },
    "allergies": ["Penicillin", "Sulfa"],
    "no_known_drug_allergies": false
  }
}
```

| Field | Required | Rules |
|---|---|---|
| `event_id` | yes | 1 to 128 of `A-Z a-z 0-9 . _ : -`; unique per connection |
| `event_type` | yes | `patient.upsert` |
| `occurred_at` | no | ISO 8601 |
| `patient.external_patient_id` | yes | the patient's id in the EHR, up to 128 characters |
| `patient.first_name`, `last_name` | yes | up to 100 characters |
| `patient.date_of_birth` | yes | `YYYY-MM-DD`, a real date, not in the future |
| `patient.sex` | no | `female`, `male` or `unknown` |
| `patient.mobile` | to create a patient | E.164 (`+15125550147`) or a 10-digit US number |
| `patient.email` | no | an email address |
| `patient.address` | no | `line1`, `line2`, `city`, `state` (2 letters), `zip` (`12345` or `12345-6789`) |
| `patient.allergies` | no | up to 50 strings; replaces the list |
| `patient.no_known_drug_allergies` | no | `true` / `false` |

A field that is absent or `null` is left as it is (sync never clears a field).
Unknown fields are ignored. **Nothing in the contract sets text-message
consent**, and sync never changes it.

## What happens to a patient

1. **Already linked** (this clinic, `keragon`, `external_patient_id`): that
   patient is updated.
2. Otherwise, the **intake duplicate rule**: an active patient of this clinic
   with the same date of birth and the same mobile or the same name.
   - Exactly one, with the same name, not linked to another EHR id: **linked**
     and updated (no duplicate).
   - None: **created** (`source = 'ehr'`) and linked.
   - Several matches, a mobile match under a different name (for example
     twins on a parent's phone), or a match linked to another EHR id: the
     patient is created and **flagged for staff** as a possible duplicate
     (the same flag self-intake uses). Patients are never merged.
3. **What a patient entered at self-intake is never overwritten.** If they
   completed intake and the EHR has a different name, date of birth, sex,
   address or allergies, the patient's value stays, the EHR's value is kept
   in `patient_field_changes` (`applied = false`), and the event is flagged.
   Every field sync does change is recorded there too, with the old and new
   values (clinic staff only). Staff see both on the patient record (the
   order drawer), under **Changes from EHR**: the field, the value we kept,
   the EHR's value, applied or kept, and the date. Opening it is written to
   the PHI access log.

## Responses

| Status | Meaning | Keragon should |
|---|---|---|
| 200 | `applied`, `skipped` (nothing changed) or `flagged` | continue |
| 401 | unknown or disconnected connection; missing, bad or stale signature | fix the setup; do not retry as is |
| 409 | this `event_id` was already received | stop (already done) |
| 422 | the payload does not match the contract (fields named in `errors`), or a new patient has no mobile | fix the data |
| 503 | a temporary error on our side | retry with the same `event_id` |

The body is `{ "status", "event_id", "patient_id", "error_code"? }`.

## The sync log

`ehr_sync_events`, shown to the clinic admin on the EHR sync page: one row per
event, with the outcome (`received`, `applied`, `skipped`, `flagged`,
`error`), the patient id, and codes and field names only. It never holds
names, dates of birth, contact details or allergies. Bad signatures are not
logged as events; the connection shows the last error code instead.

## Data model (migration 20261017000001)

- `ehr_connections`: one per clinic and provider; the secret's Vault id;
  connected / rotated / disconnected times; last event, success and error.
- `patient_external_ids`: patient to EHR id, unique per (clinic, system,
  external id) and per (patient, system).
- `ehr_sync_events`: the sync log; unique per (connection, event id).
- `patient_field_changes`: what sync changed or kept, with values (PHI;
  clinic staff only).

RLS reads the clinic and role from `app_metadata`. Clinic admins see their own
connection and log; ops see every connection and log; clinic staff see their
own clinic's links and field changes. Only the service role writes.
