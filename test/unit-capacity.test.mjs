// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { TransactionGraph, digest, documentOf, validateDocument } from '../core.mjs'
import { MemoryGraphStore } from '../store.mjs'
import { formatGraphView } from '../host.mjs'
import { createRemoteContribution } from '../remote.mjs'
import { branchLayout, graphPresentation } from '../view-model.mjs'

function fixture(nodes) {
  const store = new MemoryGraphStore(), graph = new TransactionGraph(store)
  graph.create({ operationId: 'create_graph', definition: { title: 'Unit fixture', ruleVersion: 1,
    hierarchy: { version: 2 }, edges: [], nodes } })
  const view = () => {
    const projected = formatGraphView(graph.read(), store.read().state.plan)
    createRemoteContribution(z).descriptors[0].result.create().parse({ status: 'ready', sessionId: 'session', graph: projected })
    return projected
  }
  return { graph, store, view }
}
const root = { kind: 'unit', key: 'root', label: 'root' }
test('both layouts show a direct root and each incoming wire describes its own signed test', () => {
  const single = fixture([root]).view()
  assert.equal(single.nodes[0].kind, 'unit')
  assert.equal(single.nodes[0].mode, 'direct')
  assert.equal(branchLayout(single).cards.length, 1)
  assert.equal(branchLayout(single, single.hierarchy.focusScopeId, { expandedGroups: true }).cards.length, 1)
  const child = key => ({ key, kind: 'unit', label: key, parent: 'root' })
  const f = fixture([{ ...root, terminal: 'end', acceptance: 'verify' }, child('a'), child('b'),
    { ...child('end'), rules: [{ id: 'either', when: { any: [{ not: { node: 'a', in: ['FAILED'] } }, { node: 'b', in: ['PASS'] }] } }] }])
  f.graph.begin({ expectedRevision: 1, operationId: 'start', choice: 0 })
  f.graph.finish({ expectedRevision: 2, operationId: 'finish', outcome: 'complete', evidence: [{ kind: 'session_event', ref: 'fixture-receipt' }], note: 'verified' })
  const graph = f.view(), progress = graphPresentation(graph).progress
  assert.equal(progress.total, 4)
  assert.equal(progress.complete, 1)
  const origins = graph.nodes.filter(n => ['a', 'b'].includes(n.label))
  const states = Object.fromEntries(origins.map(n => [n.label, graph.edges.find(e => e.from === n.id).reference]))
  assert.deepEqual(states, { a: 'MATCH', b: 'PENDING' })
})
test('a dense unit graph retains 576 different prerequisite edges', () => {
  const children = prefix => Array.from({ length: 24 }, (_, i) => ({
    key: prefix + i, label: prefix + i, kind: 'unit', parent: 'root',
  }))
  const sources = children('source')
  const targets = children('target').map(node => ({ ...node, rules: [{ id: 'ready',
    when: { all: sources.map(source => ({ node: source.key, in: ['PASS'] })) },
  }] }))
  const graph = fixture([{ ...root, terminal: 'end', acceptance: 'verify' }, ...sources, ...targets,
    { key: 'end', label: 'end', kind: 'unit', parent: 'root' }]).view()
  assert.equal(graph.nodes.length, 50)
  assert.equal(graph.edges.filter(edge => edge.kind === 'rule').length, 576)
})

test('the kernel replays more than 1024 events and retains more than 32 evidence references', () => {
  const { graph, store } = fixture([root])
  graph.begin({ expectedRevision: 1, operationId: 'start', choice: 0 })
  const evidence = Array.from({ length: 40 }, (_, i) => ({ kind: 'session_event', ref: 'evidence-' + i }))
  graph.suspend({ expectedRevision: 2, operationId: 'hold', evidence, note: 'held' })
  graph.resolveSuspension({ expectedRevision: 3, operationId: 'resume', attemptId: store.read().state.suspended.active.attemptId, mode: 'resume' })
  const events = store.read().events
  for (let i = events.length; i < 1026; i++) {
    const { type, data } = events[2 + i % 2]
    const body = { type, data, id: 'event_' + i, operationId: 'op_' + i, seq: i + 1, previousHash: events.at(-1).hash }
    events.push({ ...body, hash: digest(body) })
  }
  const ledger = documentOf(events)
  assert.equal(ledger.revision, 1026)
  assert.equal(ledger.events.at(-2).data.evidence.length, 40)
  validateDocument(ledger)
})

test('historical hash chains retain their original blueprint bytes through new unit events', () => {
  const f = fixture([root]), snapshot = f.store.read()
  const created = snapshot.events[0]
  assert.equal(created.data.plan.nodes[0].kind, 'unit')
  assert.equal(created.data.plan.nodes[0].mode, 'direct')
  assert.equal(created.data.plan.hierarchy.maxDepth, 32)
  const { hash, ...historical } = created
  historical.data = { ...historical.data, plan: snapshot.state.plan }
  const oldEvent = { ...historical, hash: digest(historical) }
  const compatible = documentOf([oldEvent])
  assert.deepEqual(compatible.state, snapshot.state)
  const store = new MemoryGraphStore()
  store.compareAndSwap(0, () => compatible)
  const graph = new TransactionGraph(store)
  graph.begin({ expectedRevision: 1, operationId: 'begin', choice: 0 })
  const ledger = store.read()
  assert.deepEqual(ledger.events[0], oldEvent)
  assert.equal(ledger.events[1].previousHash, oldEvent.hash)
  validateDocument(ledger)
})
