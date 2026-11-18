// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test'
import assert from 'node:assert/strict'
import { TransactionGraph, digest, normalizePlan, revisedPlan, validateDocument } from '../core.mjs'
import { MemoryGraphStore } from '../store.mjs'
import { childrenOf, scopeSignature } from '../hierarchy.mjs'
import { formatGraphView } from '../host.mjs'
import { createRemoteContribution } from '../remote.mjs'
import { z } from 'zod'

const leaf = (key, parent) => ({ key, parent, kind: 'leaf', label: key })
const group = (key, parent, terminal) => ({ key, ...(parent ? { parent } : {}), kind: 'container', label: key, terminal, acceptance: key + ' acceptance' })
const edge = (from, to) => ({ kind: 'prerequisite', from, to })
export const hierarchyPlan = () => ({ title: 'two groups', hierarchy: { version: 1, maxGroupDepth: 3 },
  nodes: [group('root', null, 'b'), group('a', 'root', 'a_end'), leaf('a_work', 'a'), leaf('a_end', 'a'),
    group('b', 'root', 'b_end'), leaf('b_end', 'b')], edges: [edge('a_work', 'a_end'), edge('a', 'b')] })
function fixture(definition = hierarchyPlan()) {
  let seq = 0
  const store = new MemoryGraphStore(), graph = new TransactionGraph(store, { id: prefix => `${prefix}_${++seq}` })
  const op = () => ({ expectedRevision: store.read()?.revision ?? 0, operationId: `op_${++seq}` })
  graph.create({ ...op(), definition })
  const finish = (outcome = 'complete') => { graph.begin({ ...op(), choice: 0 }); graph.finish({ ...op(), outcome, evidence: [{ kind: 'artifact', ref: 'evidence.txt', sha256: 'a'.repeat(64) }], note: outcome }) }
  const gate = () => {
    const state = store.read().state, pending = state.hierarchy.pending
    graph.reviewScope({ ...op(), ...pending, inputHash: scopeSignature(state, pending.scopeId), runId: `review_${++seq}`,
      ...(pending.kind === 'GROUP_REVIEW' ? { report: { outcome: 'COMPLETE', summary: 'Independent acceptance', children: childrenOf(state.plan, pending.scopeId).map(node => ({ id: node.id, sha256: digest(node.kind === 'leaf' ? state.leaves[node.id] : state.hierarchy.groups[node.id]) })) } } : {}) })
  }
  return { store, graph, finish, gate, op }
}
test('leaf acceptance, group final, parent review and root final are separate serial gates', () => {
  const f = fixture(); f.finish(); assert.equal(f.graph.read().legalNext.length, 0)
  assert.equal(f.store.read().state.hierarchy.pending.kind, 'PLAN_REVIEW'); f.gate()
  assert.equal(f.graph.read().legalNext[0].label, 'a_end'); f.finish()
  assert.equal(f.store.read().state.hierarchy.pending.kind, 'GROUP_REVIEW'); f.gate()
  assert.equal(f.store.read().state.hierarchy.pending.kind, 'PLAN_REVIEW'); f.gate()
  assert.equal(f.graph.read().legalNext[0].label, 'b_end'); f.finish(); f.gate()
  assert.equal(f.store.read().state.hierarchy.pending.kind, 'GROUP_REVIEW')
  assert.equal(f.graph.read().goalReached, false); f.gate(); assert.equal(f.graph.read().goalReached, true)
  assert.equal(f.graph.read().legalNext.length, 0); validateDocument(f.store.read())
})
test('accepted BLOCKED predecessor is visible to the terminal without becoming a successful leaf', () => {
  const f = fixture(); f.finish('incomplete'); f.gate()
  assert.equal(f.graph.read().legalNext[0].label, 'a_end'); f.finish(); f.gate()
  assert.equal(f.graph.read().nodes.find(node => node.key === 'a_work').status, 'INCOMPLETE')
  assert.equal(f.graph.read().nodes.find(node => node.key === 'a').status, 'COMPLETE')
})
test('single-group wrapper aliases one final audit and includes root in the gate identity', () => {
  const plan = { title: 'single', hierarchy: { version: 1, maxGroupDepth: 3 }, nodes: [group('root', null, 'a'), group('a', 'root', 'end'), leaf('end', 'a')], edges: [] }
  const f = fixture(plan); f.finish(); f.gate()
  assert.equal(f.graph.read().goalReached, true)
  assert.equal(f.store.read().events.filter(e => e.type === 'SCOPE_REVIEWED').length, 1)
})
test('depth counts containers, rejects cross-scope edges and unreachable terminals', () => {
  const plan = { title: 'deep', hierarchy: { version: 1, maxGroupDepth: 3 }, nodes: [group('root', null, 'a'), group('a', 'root', 'b'), group('b', 'a', 'end'), leaf('end', 'b')], edges: [] }
  assert.doesNotThrow(() => normalizePlan(plan))
  assert.throws(() => normalizePlan({ ...plan, hierarchy: { version: 1, maxGroupDepth: 2 } }), { code: 'GROUP_DEPTH_LIMIT' })
  const cross = hierarchyPlan(); cross.edges.push(edge('a_end', 'b_end'))
  assert.throws(() => normalizePlan(cross), { code: 'CROSS_SCOPE_EDGE' })
  const missing = hierarchyPlan(); missing.edges = [edge('a', 'b')]
  assert.throws(() => normalizePlan(missing), { code: 'GROUP_TERMINAL_COVERAGE_GAP' })
})
test('cannot bypass, replay or commit a stale scope gate', () => {
  const f = fixture(); f.finish()
  assert.throws(() => f.graph.begin({ ...f.op(), choice: 0 }), { code: 'NO_SUCH_LEGAL_CHOICE' })
  const state = f.store.read().state
  assert.throws(() => f.graph.reviewScope({ ...f.op(), ...state.hierarchy.pending, inputHash: '0'.repeat(64), runId: 'bad' }), { code: 'SCOPE_GATE_STALE' })
  f.gate()
  assert.throws(() => f.graph.reviewScope({ ...f.op(), ...state.hierarchy.pending, inputHash: scopeSignature(state, state.hierarchy.pending.scopeId), runId: 'bad' }), { code: 'SCOPE_GATE_NOT_PENDING' })
})
test('reopening terminal retains history and revokes ancestor completion', () => {
  const plan = { title: 'single', hierarchy: { version: 1, maxGroupDepth: 3 }, nodes: [group('root', null, 'end'), leaf('end', 'root')], edges: [] }
  const f = fixture(plan); f.finish(); f.gate()
  const before = f.store.read(), id = before.state.plan.nodes.find(node => node.key === 'end').id
  f.graph.reopen({ ...f.op(), nodeIds: [id], decisionId: 'rework_test', evidence: [{ kind: 'artifact', ref: 'defect.txt', sha256: 'b'.repeat(64) }], note: 'Contract defect with evidence' })
  assert.equal(f.graph.read().goalReached, false); assert.equal(f.graph.read().legalNext[0].id, id)
  assert.deepEqual(f.store.read().events.slice(0, -1), before.events)
})
test('legacy graph cannot acquire a hierarchy policy during revision', () => {
  const f = fixture(); const next = hierarchyPlan(); next.hierarchy.maxGroupDepth = 4
  assert.throws(() => revisedPlan(f.store.read(), next), { code: 'HIERARCHY_POLICY_IMMUTABLE' })
})
test('rework cascades through group interfaces and revokes downstream completion without deleting history', () => {
  const f = fixture(); f.finish(); f.gate(); f.finish(); f.gate(); f.gate(); f.finish(); f.gate(); f.gate()
  const before = f.store.read(), id = before.state.plan.nodes.find(node => node.key === 'a_work').id
  f.graph.reopen({ ...f.op(), nodeIds: [id], decisionId: 'rework_groups', evidence: [{ kind: 'artifact', ref: 'defect.txt', sha256: 'c'.repeat(64) }], note: 'Original premise contradicted by evidence.' })
  const state = f.store.read().state
  assert.ok(Object.values(state.leaves).every(leaf => leaf.status === 'PENDING'))
  assert.equal(Object.keys(state.hierarchy.groups).length, 0)
  assert.equal(f.graph.read().legalNext[0].label, 'a_work')
  assert.deepEqual(f.store.read().events.slice(0, -1), before.events)
})
test('real host projection transports group gates and terminal markers through strict frontend schema', () => {
  const f = fixture(); f.finish(); f.gate(); f.finish()
  const graph = formatGraphView(f.graph.read(), f.store.read().state.plan)
  createRemoteContribution(z).descriptors[0].result.create().parse({ status: 'ready', sessionId: 'fixture', graph })
  assert.equal(graph.hierarchy.pending.kind, 'GROUP_REVIEW')
  assert.equal(graph.nodes.find(node => node.label === 'a').gate, 'GROUP_REVIEW')
  assert.equal(graph.nodes.find(node => node.label === 'a_end').isTerminal, true)
})
