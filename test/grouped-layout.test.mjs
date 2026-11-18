import assert from 'node:assert/strict'
import test from 'node:test'
import { branchLayout } from '../view-model.mjs'
import { visualFixtures } from '../testing/visual-fixtures.mjs'

const layoutOf = (graph, collapsedIds = []) => branchLayout(graph, undefined, { expandedGroups: true, collapsedIds })
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const contains = (a, b) => b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height
function ancestors(graph, id) {
  const rows = new Map(graph.nodes.map(node => [node.id, node])), found = new Set()
  for (let p = rows.get(id)?.parent; p && !found.has(p); p = rows.get(p)?.parent) found.add(p)
  return found
}

test('expanded hierarchy retains every real scope relation and shows each non-root node once', () => {
  for (const { graph } of Object.values(visualFixtures).filter(row => row.graph?.hierarchy)) {
    const before = structuredClone(graph), layout = layoutOf(graph)
    assert.deepEqual([...layout.cards, ...layout.groups].map(item => item.node.id).sort(), graph.nodes.filter(node => node.parent).map(node => node.id).sort())
    const expected = graph.nodes.filter(node => node.kind === 'container').flatMap(node => branchLayout(graph, node.id).wires.map(wire => wire.key))
    assert.deepEqual(layout.wires.map(wire => wire.key).sort(), expected.sort())
    assert.deepEqual(layoutOf(graph), layout, 'stable geometry across identical polling responses')
    assert.deepEqual(graph, before, 'display does not change execution data')
  }
})

test('group boundaries contain their descendants without overlapping unrelated groups or tasks', () => {
  for (const { graph } of Object.values(visualFixtures).filter(row => row.graph?.hierarchy)) {
    const layout = layoutOf(graph), items = [...layout.cards, ...layout.groups]
    for (const item of items) {
      assert.ok(contains({x:0,y:0,width:layout.width,height:layout.height}, item), `${item.node.id} within canvas`)
      for (const other of items) {
        if (item === other) continue
        if (ancestors(graph, other.node.id).has(item.node.id)) {
          assert.ok(contains(item, other), `${other.node.id} within ${item.node.id}`)
          assert.ok(other.y >= item.y + 58, 'descendants do not cover group header')
        } else if (!ancestors(graph, item.node.id).has(other.node.id)) assert.equal(overlaps(item, other), false, `${item.node.id} overlaps ${other.node.id}`)
      }
    }
  }
})

test('group edges bypass unequal sibling boxes and long intervening scopes', () => {
  const graph = visualFixtures.hierarchy_multi.graph, layout = layoutOf(graph)
  for (const wire of layout.wires.filter(wire => wire.scopeId === 'root')) {
    const words = wire.path.split(' '), points = []
    for (let i = 0; i < words.length;) {
      const cmd = words[i++], last = points.at(-1)
      if (cmd === 'M') points.push([Number(words[i++]), Number(words[i++])])
      else if (cmd === 'H') points.push([Number(words[i++]), last[1]])
      else if (cmd === 'V') points.push([last[0], Number(words[i++])])
      else assert.fail(`Unexpected command ${cmd}`)
    }
    for (let i = 1; i < points.length; i++) {
      const [x0,y0] = points[i-1], [x1,y1] = points[i]
      assert.ok([x0,y0,x1,y1].every(Number.isFinite))
      assert.ok(x1 >= 0 && x1 <= layout.width && y1 >= 0 && y1 <= layout.height)
      for (const box of layout.groups) {
        const crosses = y0 === y1 ? y0 > box.y && y0 < box.y + box.height && Math.max(x0,x1) > box.x && Math.min(x0,x1) < box.x + box.width
          : x0 > box.x && x0 < box.x + box.width && Math.max(y0,y1) > box.y && Math.min(y0,y1) < box.y + box.height
        assert.equal(crosses, false, `${wire.edge.from}->${wire.edge.to} crosses ${box.node.id}`)
      }
    }
  }
})

test('collapsing a group hides only its internals and preserves outer edge identity and state', () => {
  const graph = visualFixtures.hierarchy_deep.graph, expanded = layoutOf(graph), folded = layoutOf(graph, ['g1'])
  assert.deepEqual(folded.groups.map(item => item.node.id), ['g2'])
  assert.deepEqual(folded.cards.map(item => item.node.id).sort(), ['g1','g2_end'])
  const outer = expanded.wires.find(wire => wire.edge.from === 'g1')
  assert.deepEqual(folded.wires.map(wire => [wire.key,wire.state]), [[outer.key,outer.state]])
  const nested = layoutOf(graph, ['sub'])
  assert.deepEqual(nested.groups.map(item => item.node.id), ['g1','g2'])
  assert.deepEqual(nested.cards.map(item => item.node.id).sort(), ['g2_end','sub'])
  assert.deepEqual(layoutOf(graph, ['deleted-group']), expanded)
})

test('mixed leaf/group siblings and single-scope graphs retain membership and edges', () => {
  const graph = structuredClone(visualFixtures.hierarchy.graph)
  graph.nodes.push({id:'root_end',parent:'root',kind:'leaf',status:'PENDING',label:'Root delivery',isTerminal:true})
  graph.edges.push({from:'g2',to:'root_end',kind:'prerequisite'})
  const layout = layoutOf(graph)
  assert.equal(layout.cards.find(item => item.node.id === 'root_end').node.parent, 'root')
  assert.equal(layout.wires.find(wire => wire.edge.to === 'root_end').edge.from, 'g2')
  const simple = structuredClone(visualFixtures.minimal.graph)
  simple.hierarchy = {version:1,focusScopeId:'root'}
  assert.equal(layoutOf(simple).groups.length, 0)
  assert.equal(layoutOf(simple).cards.length, 1)
})

test('legacy graphs retain original cross-level layout regardless of expanded-view options', () => {
  const graph = visualFixtures.nested.graph
  assert.deepEqual(layoutOf(graph), branchLayout(graph))
})
