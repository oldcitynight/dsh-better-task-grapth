// SPDX-License-Identifier: GPL-3.0-only
// Generic diagnostics only; this base plugin has no dynamic-context dependency.
import { AsyncLocalStorage } from 'node:async_hooks'
const scopes = new AsyncLocalStorage()
export const pointer = parts => '/' + parts.map(part => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')
export const withValidation = (scope, fn) => scopes.run({ ...scopes.getStore(), ...scope }, fn)
function publicDiagnostic(saved, scope) {
  const { rejectionPoint, ...body } = saved
  const location = rejectionPoint && { module: rejectionPoint.module, line: rejectionPoint.line, column: rejectionPoint.column }
  return { ...body, ...scope, ...(location ? { rejectionPoint: location } : {}), issues: body.issues.map(issue => ({
    ...issue, path: issue.path || scope.path || '',
    // Persisted diagnostics from older releases can contain the old source fallback.
    reason: issue.reason?.startsWith('The program rejected this exact check in ')
      ? 'Validation rule ' + body.code + ' rejected this operation.' : issue.reason,
  })) }
}
export function diagnostic(error, scope = {}) {
  if (error?.diagnostic) return publicDiagnostic(error.diagnostic, scope)
  const frame = String(error?.stack ?? '').split('\n').find(line => /^\s+at /.test(line) && /\.(mjs|js):\d+:\d+/.test(line) && !/validation\.mjs|new (GraphError|DynamicContextError)|at (fail|reportFailure|problem|invalid) |at RequestContract\.reject /.test(line))
  const origin = frame?.match(/([^/\s()]+\.(?:mjs|js)):(\d+):(\d+)/)
  const detail = error?.details ?? error?.detail ?? {}
  const context = { ...scopes.getStore(), ...scope }
  const code = error?.code ?? error?.info?.code ?? (error?.issues ? 'SCHEMA_VALIDATION_FAILED' : error?.name ?? 'VALIDATION_FAILED')
  const root = context.path ?? ''
  const issues = error?.issues?.flatMap(issue => {
    const paths = issue.code === 'unrecognized_keys' ? issue.keys.map(key => [...issue.path, key]) : [issue.path]
    return paths.map(parts => ({ path: root + (parts.length ? pointer(parts) : ''), reason: issue.message,
      ...(issue.expected ? { expected: issue.expected } : {}), rule: issue.code }))
  }) ?? detail.issues ?? (error?.violations ? schemaIssues(error.violations, root) : null) ?? [{ path: detail.path ?? root,
    reason: detail.reason ?? (error?.message && error.message !== code && !error.path
      ? error.message : `Validation rule ${code} rejected this operation.`),
    ...Object.fromEntries(Object.entries(detail).filter(([key]) => key !== 'issues')) }]
  return { protocol: 'validation-feedback-v1', category: error?.issues || error?.violations ? 'schema' : 'program', code,
    ...context, issues, ...(origin ? { rejectionPoint: { module: origin[1], line: +origin[2], column: +origin[3] } } : {}),
    repair: detail.repair ?? 'Correct the identified fields only. Preserve valid content and existing evidence. A rejection grants no new authority.' }
}
// Preserve the native path verbatim as well as its JSON Pointer when the native
// renderer uses ordinary identifier/index segments (never guess exotic keys).
export function schemaIssues(violations, root = '') {
  return violations.map(reason => {
    const nativePath = reason.match(/^"([^"]*)"\s/)?.[1] ?? reason.split(/\s/)[0]
    const valuePath = nativePath.replace(/^\./, '')
    const parts = /^[\w.\[\]-]*$/.test(valuePath) ? valuePath.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean) : []
    return { path: root + (parts.length ? pointer(parts) : ''), nativePath, reason }
  })
}
export function checkedTool(defineTool, options) {
  const tool = defineTool(options), execute = tool.execute
  return { ...tool, execute: (args, exec) => validationBoundary({ stage: 'tool', tool: options.name, path: '' }, () => {
    // Native DSH preserves malformed argument JSON as text. Repair only that
    // declaration; keep the original call in the native session unchanged.
    if (typeof args === 'string') args = parseModelJSON(args).value
    else {
      const events = exec?.agent?.session?.snapshotEvents?.() ?? []
      const call = events.findLast(row => row.type === 'assistant/message' && row.data.message.content?.some(block => block.type === 'tool-call' && block.id === exec.callId))
        ?.data.message.content.find(block => block.type === 'tool-call' && block.id === exec.callId)
      // JSON.parse in the native loop discards duplicate keys. Recheck the
      // original owned wire declaration before it can mutate either graph.
      if (call?.name === options.name && typeof call.arguments === 'string') parseModelJSON(call.arguments)
    }
    return execute(args, exec)
  }) }
}
export function attachDiagnostic(error, detail) {
  if (detail && typeof detail === 'object') error.details = detail
  error.diagnostic = diagnostic(error)
  return error
}
export function feedbackText(error, scope) {
  const value = diagnostic(error, scope)
  return value.code + ': ' + JSON.stringify(value)
}
export function located(code, detail) {
  const error = Object.assign(new Error(detail.reason ?? code), { code, details: detail })
  attachDiagnostic(error); error.message = feedbackText(error); return error
}
export function validationBoundary(scope, fn) {
  return withValidation(scope, () => {
    const reject = error => { if (error?.name !== 'AbortError') { error.diagnostic = diagnostic(error, scope); error.message = feedbackText(error) } throw error }
    try {
      const value = fn()
      if (value?.then) return value.catch(reject)
      return value
    } catch (error) { return reject(error) }
  })
}

/** Parse model declarations, never durable records. Repair syntax only when the
 * decoded value is unique. Preserve source offsets and an explicit repair list. */
export function parseModelJSON(source, { path = '', envelope = false } = {}) {
  if (typeof source !== 'string') throw located('MODEL_JSON_TEXT_REQUIRED', { path, reason: 'Expected JSON text.' })
  let start = 0, end = source.length, i = 0, presentation
  const repairs = [], edits = []
  if (source[0] === '\uFEFF') { start = 1; repairs.push({ kind: 'leading_bom', offset: 0 }) }
  if (envelope) {
    const matches = [...source.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```/g)]
    if (matches.length === 1) {
      const m = matches[0], before = source.slice(start, m.index), after = source.slice(m.index + m[0].length)
      if (!/[{}\[\]]|```/.test(before + after)) {
        start = m.index + m[0].indexOf('\n') + 1; end = start + m[1].length
        repairs.push({ kind: 'single_json_envelope', offset: m.index }); presentation = { before: before.trim(), after: after.trim() }
      }
    }
  }
  i = start
  const position = offset => { const before = source.slice(0, offset); const lines = before.split('\n'); return { offset, line: lines.length, column: lines.at(-1).length + 1, unit: 'UTF-16' } }
  const reject = (reason, field, offset = i, code = 'MODEL_JSON_SYNTAX', extra = {}) => {
    const error = located(code, { path: field, reason, location: position(offset), ...extra,
      repair: 'Edit only the indicated source region; do not regenerate unaffected content. The original input is unchanged.' })
    error.diagnostic.category = 'syntax'; error.message = feedbackText(error); throw error
  }
  const ws = () => { while (i < end && /[ \t\r\n]/.test(source[i])) i++ }
  const repair = (from, to, value, kind) => { edits.push({ from, to, value }); repairs.push({ kind, ...position(from) }) }
  function string(field) {
    const begin = i++; let raw = '"'
    while (i < end) {
      const offset = i, char = source[i++]
      if (char === '"') { raw += '"'; return JSON.parse(raw) }
      if (char === '\\') {
        if (i === end) reject('Unterminated escape; the missing character cannot be inferred.', field, offset)
        const escaped = source[i++]
        if ('"\\/bfnrt'.includes(escaped)) raw += '\\' + escaped
        else if (escaped === 'u') {
          const hex = source.slice(i, i + 4)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) reject('Unicode escape requires exactly four hexadecimal digits.', field, offset)
          raw += '\\u' + hex; i += 4
        } else reject('Unknown escape: choose an escaped literal backslash or the intended character explicitly.', field, offset, 'MODEL_JSON_AMBIGUOUS_ESCAPE', { found: '\\' + escaped })
      } else if (char.charCodeAt(0) < 32) {
        const encoded = JSON.stringify(char).slice(1, -1); raw += encoded
        repair(offset, i, encoded, 'literal_control_character')
      } else raw += char
    }
    reject('Unterminated string; the missing boundary cannot be inferred.', field, begin)
  }
  function value(field) {
    ws(); const char = source[i]
    if (char === '"') return string(field)
    if (char === '{' || char === '[') {
      const object = char === '{', result = object ? {} : [], seen = new Map(), close = object ? '}' : ']'
      i++; ws(); if (source[i] === close) { i++; return result }
      for (;;) {
        let key, keyOffset = i
        if (object) {
          if (source[i] !== '"') reject('Object keys must be double-quoted strings.', field)
          key = string(field); ws()
          if (seen.has(key)) reject('Duplicate object key has more than one possible value; select one explicitly.', field + pointer([key]), keyOffset, 'MODEL_JSON_DUPLICATE_KEY', { firstLocation: position(seen.get(key)) })
          seen.set(key, keyOffset)
          if (source[i++] !== ':') reject('Expected : after this object key.', field + pointer([key]), i - 1)
        } else key = result.length
        const item = value(field + pointer([key]))
        Object.defineProperty(result, key, { value: item, writable: true, configurable: true, enumerable: true })
        ws(); if (source[i] === close) { i++; return result }
        if (source[i] !== ',') reject('Expected a comma or the closing ' + close + '; do not guess a missing field boundary.', field)
        const comma = i++; ws()
        if (source[i] === close) { repair(comma, comma + 1, '', 'trailing_comma'); i++; return result }
      }
    }
    const token = source.slice(i, end).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0]
    if (!token) reject(i >= end ? 'Unexpected end of JSON; missing content cannot be inferred.' : 'Expected a JSON value.', field)
    i += token.length; return JSON.parse(token)
  }
  const parsed = value(path); ws()
  if (i !== end) reject('Unexpected text after the JSON value; multiple values or extra text are ambiguous.', path)
  let normalized = source.slice(start, end)
  for (const edit of edits.sort((a, b) => b.from - a.from)) normalized = normalized.slice(0, edit.from - start) + edit.value + normalized.slice(edit.to - start)
  return { value: parsed, normalized, repairs, presentation }
}
