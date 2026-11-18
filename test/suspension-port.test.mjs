import test from 'node:test'
import assert from 'node:assert/strict'
import { TransactionGraph, revisedPlan, validateDocument, digest } from '../core.mjs'
import { MemoryGraphStore } from '../store.mjs'
const definition = { title: 'Host-controlled suspension', nodes: [{ key: 'root', kind: 'container', label: 'Root' }, { key: 'a', parent: 'root', kind: 'leaf', label: 'A' }], edges: [] }
function fixture() { let i = 0; const store = new MemoryGraphStore(), graph = new TransactionGraph(store, { id: prefix => prefix + '_' + ++i }); graph.create({ operationId: 'create', definition }); graph.begin({ expectedRevision: 1, operationId: 'begin', choice: 0 }); return { store, graph } }
test('suspended attempt owns the serial lane without a fabricated finish, and exact resume survives replay', () => {
  const { store, graph } = fixture(), active = store.read().state.active, original = store.read().events
  graph.suspend({ expectedRevision: 2, operationId: 'hold', evidence: [{ kind: 'artifact', ref: 'host:immutable-checkpoint' }], note: 'User correction', metadata: { instruction: 'Inspect plan' } })
  assert.equal(graph.read().legalNext.length, 0); assert.equal(graph.read().skipChoices.length, 0)
  assert.throws(() => graph.begin({ expectedRevision: 3, operationId: 'illegal', choice: 0 }), /NO_SUCH_LEGAL_CHOICE/)
  assert.throws(() => graph.skip({ expectedRevision: 3, operationId: 'skip', choice: 0, note: 'No' }), /SKIP_NOT_LEGAL/)
  graph.resolveSuspension({ expectedRevision: 3, operationId: 'resume', attemptId: active.attemptId, mode: 'resume' })
  assert.deepEqual(store.read().state.active, active); validateDocument(store.read())
  assert.deepEqual(store.read().events.slice(0, 2), original); assert.equal(store.read().events.some(row => row.type === 'FINISHED'), false)
})
test('changed leaf contract cannot resume the old attempt, but can supersede with all old evidence retained', () => {
  const { store, graph } = fixture(), active = store.read().state.active
  graph.suspend({ expectedRevision: 2, operationId: 'hold', evidence: [{ kind: 'artifact', ref: 'host:snapshot' }], note: 'Changed requirement' })
  const changed = structuredClone(definition); changed.nodes[1].label = 'New A'
  const plan = revisedPlan(store.read(), changed)
  graph.revise({ expectedRevision: 3, operationId: 'revision', plan, review: { verdict: 'APPROVE', baseRevision: 3, planChecksum: digest(plan), proposalHash: 'a'.repeat(64), updaterRunId: 'updater', reviewerRunId: 'reviewer' } })
  assert.throws(() => graph.resolveSuspension({ expectedRevision: 4, operationId: 'badresume', attemptId: active.attemptId, mode: 'resume' }), /SUSPENSION_CONTRACT_CHANGED/)
  graph.resolveSuspension({ expectedRevision: 4, operationId: 'supersede', attemptId: active.attemptId, mode: 'supersede' })
  graph.begin({ expectedRevision: 5, operationId: 'newbegin', choice: 0 }); assert.notEqual(store.read().state.active.attemptId, active.attemptId)
  validateDocument(store.read()); assert.equal(store.read().events.find(row => row.type === 'SUSPENDED').data.evidence[0].ref, 'host:snapshot')
})
