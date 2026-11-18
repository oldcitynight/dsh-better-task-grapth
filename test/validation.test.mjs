// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test'
import assert from 'node:assert/strict'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { parseModelJSON, diagnostic, checkedTool, validationBoundary } from '../validation.mjs'
import { GraphError, normalizePlan } from '../core.mjs'

for (const [name, source, expected] of [
  ['trailing object comma', '{"content":"a,b}",}', { content: 'a,b}' }],
  ['nested trailing commas', '{"items":[1,{"value":2,},],}', { items: [1, { value: 2 }] }],
  ['literal controls', '{"content":"first\nsecond\tline\u0000"}', { content: 'first\nsecond\tline\u0000' }],
  ['BOM and one fence', '\uFEFF\nReport follows\n```json\n{"ready":true,}\n```\nEnd of report.', { ready: true }],
]) test(name + ' repairs without guessing or changing decoded values', () => {
  const input = source
  const result = parseModelJSON(source, { envelope: true })
  assert.deepEqual(result.value, expected)
  assert.deepEqual(JSON.parse(result.normalized), expected)
  assert.ok(result.repairs.length)
  assert.equal(source, input)
})

for (const [name, raw, code, field, offset] of [
  ['unknown escape', '{\n  "value":"bad\\q"\n}', 'MODEL_JSON_AMBIGUOUS_ESCAPE', '/value', 16],
  ['duplicate decoded key', '{"a":1,"\\u0061":2}', 'MODEL_JSON_DUPLICATE_KEY', '/a', 7],
  ['missing comma', '{"a":1 "b":2}', 'MODEL_JSON_SYNTAX', '', 7],
  ['unclosed string', '{"a":"x}', 'MODEL_JSON_SYNTAX', '/a', 5],
  ['two values', '{} {}', 'MODEL_JSON_SYNTAX', '', 3],
]) test(name + ' is rejected at its original source position', () => {
  assert.throws(() => parseModelJSON(raw), error => {
    const detail = diagnostic(error)
    assert.equal(error.code, code)
    assert.equal(detail.category, 'syntax')
    assert.equal(detail.issues[0].path, field)
    assert.equal(detail.issues[0].location.offset, offset)
    assert.equal(detail.issues[0].location.line, raw.slice(0, offset).split('\n').length)
    assert.match(detail.repair, /only the indicated/)
    return true
  })
})

test('valid strings and prototype-named data remain exact and inert', () => {
  const source = '{"value":"C:\\\\tmp\\nquoted \\\"text\\\"", "__proto__":{"polluted":true}}'
  const result = parseModelJSON(source)
  assert.deepEqual(result.value, JSON.parse(source))
  assert.equal(Object.getPrototypeOf(result.value), Object.prototype)
  assert.equal({}.polluted, undefined)
  assert.deepEqual(result.repairs, [])
})

test('native plugin tools repair raw syntax before schema checks and reject duplicate original keys', async () => {
  let effects = 0
  const tool = checkedTool(defineTool, { name: 'validation_fixture', description: 'Fixture', parameters: { value: { type: 'string', required: true } },
    output: { schema: { type: 'object', properties: {}, additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: args => { effects++; return args } })
  assert.deepEqual(await tool.execute('{"value":"line\nbreak",}', {}), { value: 'line\nbreak' })
  await assert.rejects(tool.execute({ value: 4 }, {}), error => {
    assert.equal(error.diagnostic.issues[0].path, '/value'); assert.match(error.message, /must be.*string/); return true
  })
  const exec = { callId: 'duplicate', agent: { session: { snapshotEvents: () => [{ type: 'assistant/message', data: { message: { content: [
    { type: 'tool-call', id: 'duplicate', name: tool.name, arguments: '{"value":"one","value":"two"}' },
  ] } } }] } } }
  assert.throws(() => tool.execute({ value: 'two' }, exec), { code: 'MODEL_JSON_DUPLICATE_KEY' })
  assert.equal(effects, 1)
})

test('semantic and invariant refusals retain a concrete field or source rejection point', () => {
  assert.throws(() => normalizePlan({ title: 'Invalid', nodes: [{ key: 'root', kind: 'container' }, { key: 'task', kind: 'leaf', parent: 'missing', label: 'Task' }], edges: [] }), error => {
    assert.ok(error.diagnostic.issues[0].reason)
    assert.ok(error.diagnostic.rejectionPoint.module.endsWith('.mjs'))
    assert.ok(error.diagnostic.issues[0].path)
    return true
  })
  assert.throws(() => validationBoundary({ stage: 'host-state' }, () => { throw new GraphError('HOST_FIXTURE_REJECTED') }), error => {
    assert.equal(error.diagnostic.stage, 'host-state')
    assert.match(error.diagnostic.issues[0].reason, /exact check/)
    return true
  })
})
