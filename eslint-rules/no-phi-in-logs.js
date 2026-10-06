'use strict'

// ============================================================
// no-phi-in-logs — Compliance C9
// ============================================================
//
// A console.* call may not print a patient field. Server logs go to the
// hosting provider's log drain; PHI does not belong there. Log ids
// (order_id, patient_id) and outcomes instead.
//
// Flagged, anywhere inside the arguments of console.log / info / warn /
// error / debug / trace:
//   - member access to a patient field:      patient.first_name, row['dob']
//   - an identifier with a patient-field name: email, toNumber
//   - an object key with one:                { phone }, { dob: x }
//   - a bare patient object:                 patient, patients
//
// Ids pass: patient.patient_id is not a patient field. Names are matched
// exactly (lowercased, '_' and '-' removed), so actorEmail or
// pharmacyName are not caught: the list is patient fields only.
//
// Exceptions: an eslint-disable-next-line with a reason, for review.

const PHI_FIELDS = new Set([
  'firstname', 'lastname', 'fullname', 'middlename',
  'patientname', 'patientfirstname', 'patientlastname',
  'dateofbirth', 'dob', 'patientdateofbirth', 'birthdate',
  'email', 'patientemail', 'receiptemail',
  'phone', 'phonenumber', 'patientphone', 'tonumber', 'fromnumber',
  'address', 'addressline1', 'addressline2', 'patientaddressline1', 'patientaddressline2',
  'street', 'city', 'zip', 'zipcode', 'postalcode',
  'allergies', 'patientallergies',
  'sig', 'sigtext', 'diagnosiscode', 'diagnosistext', 'specialinstructions',
  'medicationname', 'ssn', 'rejectionreason',
])

/** Whole objects that are a patient (or patients). */
const PHI_OBJECTS = new Set(['patient', 'patients'])

const CONSOLE_METHODS = new Set(['log', 'info', 'warn', 'error', 'debug', 'trace'])

const norm = (name) => String(name).toLowerCase().replace(/[_-]/g, '')

function isConsoleCall(node) {
  const callee = node.callee
  return callee
    && callee.type === 'MemberExpression'
    && callee.object.type === 'Identifier'
    && callee.object.name === 'console'
    && !callee.computed
    && callee.property.type === 'Identifier'
    && CONSOLE_METHODS.has(callee.property.name)
}

function propertyName(member) {
  if (!member.computed && member.property.type === 'Identifier') return member.property.name
  if (member.computed && member.property.type === 'Literal' && typeof member.property.value === 'string') return member.property.value
  return null
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow logging patient fields (PHI) with console.*' },
    schema: [],
    messages: {
      phi: "'{{name}}' looks like patient data (PHI). Log ids (order_id, patient_id) and outcomes instead.",
    },
  },

  create(context) {
    // asObject: the node is the object of a member access (patient.patient_id),
    // where a whole-patient name is fine and only a field name counts.
    function check(node, report, asObject = false) {
      if (!node || typeof node !== 'object') return
      switch (node.type) {
        case 'MemberExpression': {
          const name = propertyName(node)
          if (name && PHI_FIELDS.has(norm(name))) { report(node, name); return }
          // Walk the object (a.b.first_name is caught above; a.email.x here).
          check(node.object, report, true)
          if (node.computed) check(node.property, report)
          return
        }
        case 'Identifier': {
          const n = norm(node.name)
          if (PHI_FIELDS.has(n) || (!asObject && PHI_OBJECTS.has(n))) report(node, node.name)
          return
        }
        case 'Property': {
          const key = !node.computed && node.key.type === 'Identifier' ? node.key.name
            : node.key.type === 'Literal' ? String(node.key.value) : null
          if (key && PHI_FIELDS.has(norm(key))) { report(node, key); return }
          check(node.value, report)
          return
        }
        case 'CallExpression': {
          // a.b.slice(-4): the callee's object is still the field.
          check(node.callee, report)
          node.arguments.forEach(a => check(a, report))
          return
        }
        default:
          for (const key of Object.keys(node)) {
            if (key === 'parent' || key === 'loc' || key === 'range') continue
            const child = node[key]
            if (Array.isArray(child)) child.forEach(c => c && typeof c.type === 'string' && check(c, report))
            else if (child && typeof child.type === 'string') check(child, report)
          }
      }
    }

    return {
      CallExpression(node) {
        if (!isConsoleCall(node)) return
        const report = (target, name) => context.report({ node: target, messageId: 'phi', data: { name } })
        node.arguments.forEach(arg => check(arg, report))
      },
    }
  },
}
