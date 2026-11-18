import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import { createRemoteContribution } from '../remote.mjs'
import { branchLayout, graphPresentation } from '../view-model.mjs'
import { visualFixtures } from '../testing/visual-fixtures.mjs'

const schema = createRemoteContribution(z).descriptors[0].result.create()

test('extreme visual fixtures meet the actual RPC schema and cover its capacity boundaries', () => {
  for (const [name, fixture] of Object.entries(visualFixtures)) {
    schema.parse({ sessionId: 'visual-' + name, status: fixture.graph ? 'ready' : 'empty',
      graph: fixture.graph, execution: fixture.execution ?? null })
  }
  assert.equal(visualFixtures.chain.graph.nodes.length, 128)
  assert.equal(visualFixtures.dense.graph.nodes.length, 128)
  assert.equal(visualFixtures.dense.graph.edges.length, 512)
  assert.equal(visualFixtures.long.graph.title.length, 512)
})

test('extreme layouts keep all cards and wires inside the canvas without mutating execution data', () => {
  for (const [name, { graph }] of Object.entries(visualFixtures)) {
    if (!graph) continue
    const before = structuredClone(graph), layout = branchLayout(graph)
    for (const card of layout.cards) {
      assert.ok(card.x >= 0 && card.y >= 0 && card.x + layout.cardWidth <= layout.width &&
        card.y + layout.cardHeight <= layout.height, `${name}: card outside canvas`)
      for (const other of layout.cards) {
        if (card === other) continue
        assert.ok(card.x + layout.cardWidth <= other.x || other.x + layout.cardWidth <= card.x ||
          card.y + layout.cardHeight <= other.y || other.y + layout.cardHeight <= card.y, `${name}: cards overlap`)
      }
    }
    for (const wire of layout.wires) {
      const points = wire.path.match(/-?\d+(?:\.\d+)?/g).map(Number)
      assert.ok(points.every(Number.isFinite), `${name}: invalid path`)
      assert.ok(wire.labelX >= 0 && wire.labelX <= layout.width && wire.labelY >= 0 && wire.labelY <= layout.height)
    }
    assert.deepEqual(graph, before, `${name}: presentation changed the source graph`)
  }
  assert.equal(branchLayout(visualFixtures.dense.graph).wires.length, 512)
})

test('condition inspection keeps full branch evidence and the source remains unchanged', () => {
  const graph = visualFixtures.branches.graph, before = structuredClone(graph)
  const view = graphPresentation(graph, 'case7')
  assert.equal(view.entryEdges[0].case, graph.edges.find(edge => edge.to === 'case7').case)
  assert.equal(view.conditions[0].id, 'inspect')
  assert.equal(view.selected.branchState, 'NOT_SELECTED')
  assert.deepEqual(graph, before)
})
