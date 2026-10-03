'use strict'

// ============================================================
// no-unchecked-supabase-error — Batch 3
// ============================================================
//
// Batches 1 and 2 (#164–#170) fixed the clinical and money paths where a
// Supabase call's `.error` was ignored and the code carried on with
// `data = null` as if the read or write had succeeded. This rule makes
// that pattern impossible to add again.
//
// Flagged: an AWAITED Supabase query or RPC — a chain through
// `.from(…)`, `.rpc(…)`, `.storage…` or `.auth.admin…` (directly, through
// a query built in steps, or inside Promise.all) — whose `error` is never
// read:
//   - `const { data } = await …`            (no `error` destructured)
//   - `const { data, error } = await …`     (`error` never read)
//   - `const res = await …; res.data`       (`res.error` never touched)
//   - `await supabase.from(…).update(…)`    (result thrown away)
//
// Accepted:
//   - the error binding (or `res.error`) is read anywhere — checked and
//     thrown, returned as an error response, logged and returned. The
//     rule checks that it is READ, not what is done with it; review does
//     the rest;
//   - the whole result is handed on (`return res`, `fn(res)`) — the
//     receiver decides;
//   - the call is not awaited (the promise goes to a caller);
//   - the line above the statement is `// supabase-error-ok: <reason>`,
//     with a non-empty reason (an empty one is its own error).
//
// Baseline: existing violations are listed in a JSON file by file,
// enclosing function name and the trimmed text of the line — never by
// line number, which drifts. An exact match is skipped, as many times as
// the baseline counts it; anything else (a new site, or one more copy of
// a baselined line) fails. Option: { baselineFile: 'path.json' } or
// { baseline: [{ file, function, line, count }] }.

const fs = require('node:fs')
const path = require('node:path')

const MARKER = /^\s*supabase-error-ok:(.*)$/
const NOT_SUPABASE_FROM = new Set(['Array', 'Buffer', 'Uint8Array', 'Object', 'Promise', 'String', 'Set', 'Map'])

const baselineCache = new Map()

function loadBaseline(options) {
  if (Array.isArray(options.baseline)) return options.baseline
  if (typeof options.baselineFile !== 'string') return []
  const file = path.resolve(process.cwd(), options.baselineFile)
  if (!baselineCache.has(file)) {
    let entries = []
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'))
      entries = Array.isArray(json) ? json : Array.isArray(json.entries) ? json.entries : []
    } catch {
      entries = []
    }
    baselineCache.set(file, entries)
  }
  return baselineCache.get(file)
}

function unwrap(node) {
  let n = node
  while (n && (n.type === 'ChainExpression' || n.type === 'TSNonNullExpression' || n.type === 'TSAsExpression' || n.type === 'TSSatisfiesExpression')) {
    n = n.expression
  }
  return n
}

function propertyName(member) {
  if (!member.computed && member.property.type === 'Identifier') return member.property.name
  if (member.computed && member.property.type === 'Literal' && typeof member.property.value === 'string') return member.property.value
  return null
}

/** True when the expression is (or ends) a Supabase query, RPC, storage or auth.admin chain. */
function isSupabaseChain(node) {
  let n = unwrap(node)
  while (n) {
    if (n.type === 'CallExpression') {
      n = unwrap(n.callee)
      continue
    }
    if (n.type === 'MemberExpression') {
      const name = propertyName(n)
      const object = unwrap(n.object)
      if (name === 'from') {
        if (!(object.type === 'Identifier' && NOT_SUPABASE_FROM.has(object.name))) return true
      }
      if (name === 'rpc' || name === 'storage') return true
      if (name === 'admin' && object.type === 'MemberExpression' && propertyName(object) === 'auth') return true
      n = object
      continue
    }
    return false
  }
  return false
}

function findVariable(scope, name) {
  for (let s = scope; s; s = s.upper) {
    const v = s.set.get(name)
    if (v) return v
  }
  return null
}

/** A query built in steps: `let q = supabase.from(…); …; await q`. */
function isSupabaseIdentifier(sourceCode, node) {
  if (node.type !== 'Identifier') return false
  const variable = findVariable(sourceCode.getScope(node), node.name)
  if (!variable) return false
  return variable.defs.some(d => d.node.type === 'VariableDeclarator' && d.node.init && isSupabaseChain(d.node.init))
}

function isPromiseAll(node) {
  const n = unwrap(node)
  return n.type === 'CallExpression'
    && n.callee.type === 'MemberExpression'
    && unwrap(n.callee.object).type === 'Identifier'
    && unwrap(n.callee.object).name === 'Promise'
    && ['all', 'allSettled'].includes(propertyName(n.callee))
    && n.arguments[0]
    && n.arguments[0].type === 'ArrayExpression'
}

function enclosingFunctionName(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (n.type === 'FunctionDeclaration' && n.id) return n.id.name
    if (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') {
      if (n.id) return n.id.name
      const p = n.parent
      if (p.type === 'VariableDeclarator' && p.id.type === 'Identifier') return p.id.name
      if ((p.type === 'MethodDefinition' || p.type === 'Property' || p.type === 'PropertyDefinition') && p.key && p.key.type === 'Identifier') return p.key.name
      if (p.type === 'ExportDefaultDeclaration') return 'default'
      // an anonymous callback: name it by the function it sits in
    }
  }
  return '<module>'
}

function statementOf(node) {
  let n = node
  while (n.parent && !['Program', 'BlockStatement', 'StaticBlock', 'SwitchCase'].includes(n.parent.type)) n = n.parent
  return n
}

module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Require the `error` of an awaited Supabase call to be read (Batch 3).' },
    schema: [{
      type: 'object',
      properties: {
        baselineFile: { type: 'string' },
        baseline: { type: 'array' },
      },
      additionalProperties: false,
    }],
    messages: {
      unchecked:
        'The `error` from this Supabase call is never checked (in {{fn}}). Check it and fail loud — throw, return an error response, or log and return — or mark it `// supabase-error-ok: <reason>`.',
      missingReason:
        '`// supabase-error-ok:` needs a reason after the colon (in {{fn}}).',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode()
    const options = context.options[0] ?? {}
    const file = path.relative(process.cwd(), context.filename ?? context.getFilename()).split(path.sep).join('/')
    const baseline = loadBaseline(options).filter(e => e && e.file === file)
    const used = new Map()

    function baselined(fn, lineText) {
      const entry = baseline.find(e => e.function === fn && e.line === lineText)
      if (!entry) return false
      const key = `${fn}\u0000${lineText}`
      const n = used.get(key) ?? 0
      if (n >= (entry.count ?? 1)) return false
      used.set(key, n + 1)
      return true
    }

    function marker(node) {
      const stmt = statementOf(node)
      const lines = new Set([stmt.loc.start.line - 1, node.loc.start.line - 1])
      const comment = sourceCode.getAllComments().find(c => c.type === 'Line' && lines.has(c.loc.end.line) && MARKER.test(c.value))
      if (!comment) return null
      return MARKER.exec(comment.value)[1].trim()
    }

    function report(node) {
      const fn = enclosingFunctionName(node)
      const reason = marker(node)
      if (reason !== null) {
        if (reason.length === 0) context.report({ node, messageId: 'missingReason', data: { fn } })
        return
      }
      const lineText = (sourceCode.lines[node.loc.start.line - 1] ?? '').trim()
      if (baselined(fn, lineText)) return
      context.report({ node, messageId: 'unchecked', data: { fn } })
    }

    /** Is the error of this destructuring pattern read? */
    function patternChecksError(pattern) {
      if (pattern.type === 'Identifier') return identifierChecksError(pattern)
      if (pattern.type !== 'ObjectPattern') return true // array or unusual pattern: not ours to judge
      for (const prop of pattern.properties) {
        if (prop.type === 'RestElement') {
          if (prop.argument.type === 'Identifier' && identifierChecksError(prop.argument)) return true
          continue
        }
        const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.type === 'Literal' ? prop.key.value : null
        if (key !== 'error') continue
        let value = prop.value
        if (value.type === 'AssignmentPattern') value = value.left
        if (value.type !== 'Identifier') return true
        const variable = findVariable(sourceCode.getScope(value), value.name)
        return !!variable && variable.references.some(r => r.isRead())
      }
      return false
    }

    /** A whole result held in a variable: is `.error` read, or is it handed on? */
    function identifierChecksError(id) {
      const variable = findVariable(sourceCode.getScope(id), id.name)
      if (!variable) return true
      const reads = variable.references.filter(r => r.isRead())
      if (reads.length === 0) return false // the result is never used at all
      for (const ref of reads) {
        const parent = ref.identifier.parent
        if (parent.type === 'MemberExpression' && parent.object === ref.identifier) {
          if (propertyName(parent) === 'error') return true
          continue // .data, .count, .status — a use, not a check
        }
        if (parent.type === 'VariableDeclarator' && parent.init === ref.identifier) {
          if (patternChecksError(parent.id)) return true
          continue
        }
        return true // handed on whole: returned, passed, spread — the receiver decides
      }
      return false
    }

    function checkTarget(target, reportNode) {
      if (!target) {
        report(reportNode)
        return
      }
      if (!patternChecksError(target)) report(reportNode)
    }

    return {
      AwaitExpression(node) {
        const arg = unwrap(node.argument)
        const direct = isSupabaseChain(arg) || isSupabaseIdentifier(sourceCode, arg)
        const all = !direct && isPromiseAll(arg)
        if (!direct && !all) return

        const parent = node.parent

        if (all) {
          // const [a, { data: b }] = await Promise.all([q1, q2])
          const elements = arg.arguments[0] && arg.arguments[0].type === 'ArrayExpression'
            ? arg.arguments[0].elements
            : []
          const isQuery = el => !!el && (isSupabaseChain(el) || isSupabaseIdentifier(sourceCode, el))
          if (parent.type !== 'VariableDeclarator' || parent.id.type !== 'ArrayPattern') {
            // await Promise.all([q1, q2]) as a statement: only when some
            // element is a Supabase call (helpers check their own errors).
            if (parent.type === 'ExpressionStatement' && elements.some(isQuery)) report(node)
            return
          }
          elements.forEach((el, i) => {
            if (!isQuery(el)) return
            const target = parent.id.elements[i]
            if (!target) return // skipped in the pattern: thrown away
            if (!patternChecksError(target)) report(node)
          })
          return
        }

        if (parent.type === 'ExpressionStatement') {
          report(node) // the result, and its error, thrown away
          return
        }
        if (parent.type === 'VariableDeclarator' && parent.init === node) {
          checkTarget(parent.id, node)
          return
        }
        if (parent.type === 'AssignmentExpression' && parent.right === node) {
          checkTarget(parent.left, node)
          return
        }
        if (parent.type === 'MemberExpression' && parent.object === node) {
          // (await q).data
          if (propertyName(parent) !== 'error') report(node)
          return
        }
        // returned, passed as an argument, spread, …: handed on.
      },
    }
  },
}
