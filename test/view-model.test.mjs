import assert from 'node:assert/strict'
import test from 'node:test'
import { branchLayout, graphPresentation } from '../view-model.mjs'

const prerequisite = (from, to) => ({ from, to, kind: 'prerequisite' })
function joinedWorkflow() {
  return {
    revision: 10, title: 'Branch join', active: null, legalNext: [], skipChoices: [],
    nodes: [{ id: 'root', label: 'Project', kind: 'container', parent: null, status: 'CONTAINER_INCOMPLETE' },
      ...['environment', 'models', 'repair', 'balance', 'restore', 'visuals', 'integrate', 'quests', 'delivery'].map(id => ({
        id, label: id, kind: 'leaf', parent: 'root', status: id === 'balance' ? 'INCOMPLETE'
          : ['environment', 'models', 'repair', 'visuals'].includes(id) ? 'COMPLETE' : 'PENDING',
      }))],
    edges: [prerequisite('environment', 'models'), prerequisite('models', 'repair'),
      prerequisite('repair', 'balance'), prerequisite('repair', 'restore'), prerequisite('repair', 'visuals'),
      prerequisite('restore', 'integrate'), prerequisite('integrate', 'quests'),
      prerequisite('quests', 'delivery'), prerequisite('visuals', 'delivery')],
  }
}

function orthogonalPoints(path) {
  const words = path.split(' '), points = []
  for (let i = 0; i < words.length;) {
    const command = words[i++], previous = points.at(-1)
    if (command === 'M') points.push([Number(words[i++]), Number(words[i++])])
    else if (command === 'H') points.push([Number(words[i++]), previous[1]])
    else if (command === 'V') points.push([previous[0], Number(words[i++])])
    else assert.fail('Expected an orthogonal bypass, got ' + command)
  }
  return points
}

function checkBypass(layout, wire) {
  const points = orthogonalPoints(wire.path)
  assert.ok(points.every(point => point.every(Number.isFinite)))
  for (const [x, y] of points) {
    assert.ok(x >= 0 && x <= layout.width)
    assert.ok(y >= 0 && y <= layout.height)
  }
  const lane = Math.max(...points.map(point => point[1]))
  assert.ok(lane > Math.max(...layout.cards.map(card => card.y + layout.cardHeight)))
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i]
    for (const card of layout.cards) {
      const right = card.x + layout.cardWidth, bottom = card.y + layout.cardHeight
      const crosses = y0 === y1
        ? y0 > card.y && y0 < bottom && Math.max(x0, x1) > card.x && Math.min(x0, x1) < right
        : x0 > card.x && x0 < right && Math.max(y0, y1) > card.y && Math.min(y0, y1) < bottom
      assert.equal(crosses, false, `${wire.edge.from}->${wire.edge.to} crosses ${card.node.id}`)
    }
  }
  return lane
}

test('a shorter branch remains visibly connected to the final join without changing the graph', () => {
  const graph = joinedWorkflow(), before = JSON.stringify(graph), layout = branchLayout(graph)
  assert.equal(layout.wires.length, graph.edges.length)
  assert.deepEqual(layout.wires.filter(wire => wire.edge.to === 'delivery').map(wire => wire.edge.from), ['quests', 'visuals'])
  assert.deepEqual(graphPresentation(graph, 'delivery').conditions.map(node => node.id), ['quests', 'visuals'])
  const wire = layout.wires.find(wire => wire.edge.from === 'visuals' && wire.edge.to === 'delivery')
  assert.equal(wire.state, 'prerequisiteMet')
  checkBypass(layout, wire)
  assert.equal(layout.cards.find(card => card.node.id === 'delivery').additionalPrerequisites, 0)
  assert.equal(JSON.stringify(graph), before)
})

test('independent long prerequisites use distinct visible lanes and retain their own status', () => {
  const graph = joinedWorkflow()
  graph.edges.push(prerequisite('balance', 'delivery'))
  const layout = branchLayout(graph)
  const wires = ['visuals', 'balance'].map(id => layout.wires.find(wire => wire.edge.from === id && wire.edge.to === 'delivery'))
  assert.ok(wires.every(Boolean))
  assert.deepEqual(wires.map(wire => wire.state), ['prerequisiteMet', 'blocked'])
  assert.equal(new Set(wires.map(wire => checkBypass(layout, wire))).size, 2)
  assert.deepEqual(branchLayout(graph), layout)
})

test('proven transitive redundancy is still reduced while the independent join stays visible', () => {
  const graph = joinedWorkflow()
  graph.edges.push(prerequisite('repair', 'delivery'))
  const layout = branchLayout(graph)
  assert.equal(layout.wires.some(wire => wire.edge.from === 'repair' && wire.edge.to === 'delivery'), false)
  assert.equal(layout.wires.some(wire => wire.edge.from === 'visuals' && wire.edge.to === 'delivery'), true)
  assert.equal(graph.edges.length, 10)
})
