// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { digest, documentOf, TransactionGraph, validateDocument } from '../core.mjs'
import { FileGraphStore, MemoryGraphStore } from '../store.mjs'
import { branchLayout, graphPresentation } from '../view-model.mjs'
import { base, blueprint, commitRevision, group, inserted, leaf, pass, root, screen } from '../testing/unit-order-fixture.mjs'

const labels = nodes => nodes.map(node => node.label)

function legacyCopy(events) {
  let previousHash = null
  return documentOf(events.map(source => {
    const event = structuredClone(source)
    delete event.hash
    delete event.data.recordedAt
    event.previousHash = previousHash
    event.hash = digest(event)
    previousHash = event.hash
    return event
  }))
}

test('an appended unit goes between its predecessor and successor in the dock and level view, including after reload', t => {
  const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-unit-order-')))
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }))
  const disk = { projectRoot, directory: path.join(projectRoot, 'graph') }
  const graph = new TransactionGraph(new FileGraphStore(disk))
  const clock = t.mock.method(Date, 'now', () => 1000)
  graph.create({ operationId: 'create', definition: base() })
  const original = graph.store.read()
  clock.mock.mockImplementation(() => 2000)
  commitRevision(graph, inserted())
  const stored = graph.store.read()
  assert.deepEqual(labels(stored.state.plan.nodes), ['root', 'a', 'c', 'd', 'end', 'b'])
  const expected = ['a', 'b', 'c', 'd', 'end']
  for (const reader of [graph, new TransactionGraph(new FileGraphStore(disk))]) {
    const remote = screen(reader), rootId = remote.nodes.find(node => !node.parent).id
    assert.deepEqual(labels(remote.nodes), ['root', ...expected])
    assert.deepEqual(labels(graphPresentation(remote).children.get(rootId)), expected)
    const cards = branchLayout(remote, rootId).cards
    assert.deepEqual(labels(cards.map(card => card.node)), expected)
    assert.deepEqual(cards.map(card => card.ordinal), [1, 2, 3, 4, 5])
    assert.doesNotMatch(JSON.stringify(remote), /createdAt|recordedAt|unitOrder/)
  }
  const byKey = Object.fromEntries(stored.state.plan.nodes.map(node => [node.key, node.id]))
  assert.deepEqual(stored.state.unitOrder.ids, ['root', ...expected].map(key => byKey[key]))
  assert.equal(stored.state.unitOrder.createdAt[byKey.a], 1000)
  assert.equal(stored.state.unitOrder.createdAt[byKey.b], 2000)
  assert.deepEqual(stored.events[0], original.events[0])
  const reordered = inserted()
  reordered.nodes.reverse()
  clock.mock.mockImplementation(() => 3000)
  const display = commitRevision(graph, reordered)
  assert.deepEqual(graph.store.read().state.unitOrder, stored.state.unitOrder)
  const d = display.legalNext.find(choice => choice.label === 'd')
  graph.begin({ expectedRevision: 3, operationId: 'begin_d', choice: d.choice })
  assert.equal(graph.read().active.nodeId, byKey.d)
  assert.deepEqual(graph.store.read().state.unitOrder, stored.state.unitOrder)
})

test('a late group and its children are placed by nested rule references at their own levels', () => {
  const graph = new TransactionGraph(new MemoryGraphStore())
  graph.create({ operationId: 'create', definition: base() })
  const revision = blueprint([root, leaf('a', 'root'), leaf('c', 'root', { any: [pass('a'), { not: { node: 'middle', in: ['FAILED'] } }] }),
    leaf('d', 'root'), leaf('end', 'root'), leaf('inner_end', 'middle', pass('inner')), leaf('inner', 'middle'),
    { ...group('middle', 'root', 'inner_end'), rules: [{ id: 'entry', when: pass('a') }] }])
  commitRevision(graph, revision)
  const remote = screen(graph), model = graphPresentation(remote)
  assert.deepEqual(labels(remote.nodes), ['root', 'a', 'middle', 'inner', 'inner_end', 'c', 'd', 'end'])
  const middle = remote.nodes.find(node => node.label === 'middle')
  assert.deepEqual(labels(model.children.get(middle.parent)), ['a', 'middle', 'c', 'd', 'end'])
  assert.deepEqual(labels(model.children.get(middle.id)), ['inner', 'inner_end'])
})

test('old ledgers recover order from actual revisions and keep unknown creation times across a new edit', () => {
  const source = new TransactionGraph(new MemoryGraphStore())
  source.create({ operationId: 'create', definition: base() })
  commitRevision(source, inserted())
  const reordered = inserted()
  reordered.nodes.reverse()
  commitRevision(source, reordered)
  const old = legacyCopy(source.store.read().events)
  assert.equal(Object.hasOwn(old.state, 'unitOrder'), false)
  const reader = new TransactionGraph(new MemoryGraphStore(old))
  assert.deepEqual(labels(screen(reader).nodes), ['root', 'a', 'b', 'c', 'd', 'end'])
  assert.deepEqual(reader.store.read(), old)
  const next = inserted()
  next.nodes.find(node => node.key === 'c').rules[0].when = pass('newer')
  next.nodes.push(leaf('newer', 'root', pass('b')))
  commitRevision(reader, next)
  const upgraded = reader.store.read()
  assert.deepEqual(upgraded.events.slice(0, -1), old.events)
  assert.deepEqual(labels(screen(reader).nodes), ['root', 'a', 'b', 'newer', 'c', 'd', 'end'])
  for (const node of upgraded.state.plan.nodes) {
    const createdAt = upgraded.state.unitOrder.createdAt[node.id]
    if (node.key === 'newer') assert.ok(Number.isSafeInteger(createdAt))
    else assert.equal(createdAt, null)
  }
  assert.equal(validateDocument(upgraded), true)
})

test('rewiring, removing and inserting one-sided peers updates only current membership and positions', () => {
  const graph = new TransactionGraph(new MemoryGraphStore())
  graph.create({ operationId: 'create', definition: inserted() })
  const old = graph.store.read().state
  const removedId = old.plan.nodes.find(node => node.key === 'b').id
  const next = blueprint([root, leaf('a', 'root'), leaf('c', 'root', { all: [pass('before'), pass('d')] }),
    leaf('d', 'root'), leaf('end', 'root'), leaf('before', 'root'), leaf('after', 'root', pass('a'))])
  commitRevision(graph, next)
  assert.deepEqual(labels(screen(graph).nodes), ['root', 'a', 'd', 'before', 'c', 'after', 'end'])
  const { unitOrder } = graph.store.read().state
  assert.equal(unitOrder.ids.includes(removedId), false)
  assert.equal(Object.hasOwn(unitOrder.createdAt, removedId), false)
  const tampered = graph.store.read()
  tampered.state.unitOrder.ids.reverse()
  const { checksum, ...body } = tampered
  assert.throws(() => validateDocument({ ...body, checksum: digest(body) }), { code: 'SNAPSHOT_REPLAY_MISMATCH' })
})

test('a legacy cross-group route and switch position the containing groups as well as the leaves', () => {
  const graph = new TransactionGraph(new MemoryGraphStore(), { enableSwitch: true })
  const unit = (key, kind, parent) => ({ key, label: key, kind, parent })
  const definition = { title: 'Cross-scope branches', nodes: [
    unit('root', 'container', null), unit('targets', 'container', 'root'),
    unit('left', 'leaf', 'targets'), unit('right', 'leaf', 'targets'),
    unit('sources', 'container', 'root'), { ...unit('choice', 'leaf', 'sources'), switchCases: ['left', 'right'] },
    unit('first', 'leaf', 'sources') ], edges: [
    { kind: 'case', from: 'choice', to: 'left', case: 'left' }, { kind: 'case', from: 'choice', to: 'right', case: 'right' },
    { kind: 'route', from: 'first', to: 'choice', outcome: 'complete' } ] }
  graph.create({ operationId: 'create', definition })
  const remote = screen(graph), model = graphPresentation(remote)
  assert.deepEqual(labels(remote.nodes), ['root', 'sources', 'first', 'choice', 'targets', 'left', 'right'])
  assert.deepEqual(labels(model.children.get(remote.nodes[0].id)), ['sources', 'targets'])
  assert.deepEqual(labels(branchLayout(remote).cards.map(card => card.node)), ['first', 'choice', 'left', 'right'])
  assert.deepEqual(graph.read().legalNext.map(choice => choice.label), ['first'])
})

test('interleaved legacy groups keep a stable outline and every real cross-group edge in flat view', () => {
  const graph = new TransactionGraph(new MemoryGraphStore())
  const nodes = [['four', 'root'], ['tail', 'four'], ['one', 'root'], ['end', 'one'], ['two', 'root'], ['middle', 'three'],
    ['extra', 'two'], ['join', 'two'], ['three', 'root'], ['start', 'one'], ['root', null]].map(([key, parent]) =>
    ({ key, parent, label: key, kind: ['root', 'one', 'two', 'three', 'four'].includes(key) ? 'container' : 'leaf' }))
  const definition = { title: 'Interleaved work', nodes, edges: [
    ['start', 'middle'], ['middle', 'join'], ['extra', 'join'], ['join', 'end'], ['end', 'tail'],
  ].map(([from, to]) => ({ kind: 'prerequisite', from, to })) }
  graph.create({ operationId: 'create', definition })
  const initial = screen(graph)
  commitRevision(graph, definition)
  const remote = screen(graph)
  assert.deepEqual(labels(remote.nodes), labels(initial.nodes))
  const indexes = new Map(remote.nodes.map((node, index) => [node.id, index]))
  for (const edge of remote.edges) assert.ok(indexes.get(edge.from) < indexes.get(edge.to))
  const rootId = remote.nodes.find(node => node.label === 'root').id
  assert.deepEqual(labels(graphPresentation(remote).children.get(rootId)), ['one', 'two', 'three', 'four'])
})
