// SPDX-License-Identifier: GPL-3.0-only
export const expandedUnit = node => node?.kind === 'container' || node?.kind === 'unit' && node.mode === 'planned'
export const directUnit = node => node?.kind === 'leaf' || node?.kind === 'unit' && node.mode === 'direct'

// Only reduce a prerequisite that is already implied by a chain of leaf
// prerequisites. Entering a conditional task can change branch participation.
function chainEdges(graph) {
  const leaves = new Set(graph.nodes.filter(node => directUnit(node)).map(node => node.id))
  const prerequisites = new Map()
  const conditional = new Set()
  for (const edge of graph.edges) {
    if (edge.kind !== 'prerequisite') {
      conditional.add(edge.to)
      continue
    }
    const sources = prerequisites.get(edge.to) ?? []
    sources.push(edge.from)
    prerequisites.set(edge.to, sources)
  }
  return graph.edges.filter(edge => {
    if (edge.kind !== 'prerequisite' || !leaves.has(edge.from)) return true
    const sources = prerequisites.get(edge.to)
    if (sources.length < 2) return true
    const pending = sources.filter(id => id !== edge.from)
    const seen = new Set()
    while (pending.length) {
      const id = pending.pop()
      if (id === edge.from) return false
      if (!leaves.has(id) || conditional.has(id) || seen.has(id)) continue
      seen.add(id)
      pending.push(...(prerequisites.get(id) ?? []))
    }
    return true
  })
}

// Host supplies legal choices. The browser only organizes them for display.
export function graphPresentation(graph, selectedId) {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]))
  const children = new Map()
  for (const node of graph.nodes) {
    const siblings = children.get(node.parent) ?? []
    siblings.push(node)
    children.set(node.parent, siblings)
  }
  const active = graph.active ? nodes.get(graph.active.nodeId) ?? null : null
  const legal = new Set(graph.legalNext.map(choice => choice.id))
  const selected = nodes.get(selectedId) ?? active ?? nodes.get(graph.hierarchy?.pending?.scopeId) ?? nodes.get(graph.legalNext[0]?.id) ?? children.get(null)?.[0] ?? null
  const entryEdges = chainEdges(graph).filter(edge => edge.to === selected?.id)
  const conditionIds = new Set(entryEdges.map(edge => edge.from))
  const conditions = [...conditionIds].map(id => nodes.get(id)).filter(Boolean)
  const units = graph.hierarchy?.version === 2
  const participants = units ? graph.nodes : graph.nodes.filter(node => directUnit(node))
  const included = participants.filter(node => node.branchState !== 'NOT_SELECTED')
  const count = status => included.filter(node => node.status === status).length
  return {
    nodes, children, active, legal, selected, conditions, entryEdges,
    progress: {
      total: included.length, complete: units ? included.filter(n => n.ruleState === 'PASS').length : count('COMPLETE'),
      incomplete: units ? included.filter(n => n.ruleState === 'FAILED').length : count('INCOMPLETE'),
      skipped: count('SKIPPED'), inactive: count('INACTIVE'), excluded: participants.length - included.length, ready: legal.size,
    },
  }
}

function branchEdgeState(edge, source, target) {
  if (edge.kind === 'rule') {
    const states = { MATCH: 'prerequisiteMet', MISS: 'branchExcluded', MIXED: 'ruleMixed', PENDING: 'edgeWaiting' }
    return states[edge.reference] ?? 'edgeWaiting'
  }
  if (source.branchState === 'NOT_SELECTED' || target.branchState === 'NOT_SELECTED') return 'branchExcluded'
  if (edge.kind === 'prerequisite') {
    if (target.isTerminal && directUnit(target) && ['INCOMPLETE','SKIPPED'].includes(source.status)) return 'dispositionReady'
    if (source.status === 'COMPLETE') return 'prerequisiteMet'
    if (source.status === 'INCOMPLETE' || source.status === 'SKIPPED' || source.blocked) return 'blocked'
    return 'edgeWaiting'
  }
  const selected = source.selectedBranch
  if (selected?.targetId === edge.to && (edge.kind === 'route' ? selected.outcome === edge.outcome : selected.case === edge.case))
    return 'branchChosen'
  return selected || source.status === 'SKIPPED' ? 'branchExcluded' : 'edgeWaiting'
}

// Rank by explicit dependencies. Containers stay in the tree unless they
// participate in a dependency. A leaf still shows which container it belongs to.
export function branchLayout(graph, scopeId = graph.hierarchy?.focusScopeId, options = {}) {
  if (graph.hierarchy && options.expandedGroups) return groupedLayout(graph, new Set(options.collapsedIds ?? []))
  if (graph.hierarchy && scopeId) {
    const nodes = graph.nodes.filter(node => node.parent === scopeId)
    if (!nodes.length && graph.hierarchy.version === 2) {
      const scope = graph.nodes.find(node => node.id === scopeId)
      if (scope) nodes.push(scope)
    }
    const ids = new Set(nodes.map(node => node.id))
    graph = { ...graph, nodes, edges: graph.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)) }
  }
  const nodesById = new Map(graph.nodes.map(node => [node.id, node]))
  const edges = chainEdges(graph).filter(edge => nodesById.has(edge.from) && nodesById.has(edge.to))
  const connected = new Set(edges.flatMap(edge => [edge.from, edge.to]))
  const nodes = graph.nodes.filter(node => graph.hierarchy || directUnit(node) || connected.has(node.id))
  const outgoing = new Map(nodes.map(node => [node.id, []]))
  const incoming = new Map(nodes.map(node => [node.id, []]))
  for (const edge of edges) {
    outgoing.get(edge.from).push(edge)
    incoming.get(edge.to).push(edge)
  }
  const incomingCount = new Map(nodes.map(node => [node.id, incoming.get(node.id).length]))
  const rank = new Map(nodes.map(node => [node.id, 0]))
  const queue = nodes.filter(node => incomingCount.get(node.id) === 0).map(node => node.id)
  for (const id of queue) {
    for (const { to: target } of outgoing.get(id)) {
      rank.set(target, Math.max(rank.get(target), rank.get(id) + 1))
      const remaining = incomingCount.get(target) - 1
      incomingCount.set(target, remaining)
      if (remaining === 0) queue.push(target)
    }
  }
  const columnSizes = Array(1 + Math.max(0, ...rank.values())).fill(0)
  for (const column of rank.values()) columnSizes[column]++

  const padding = 30, cardWidth = 232, cardHeight = 112, columnGap = 120, rowGap = 32
  const rows = Math.max(1, ...columnSizes)
  const bodyHeight = rows * (cardHeight + rowGap) - rowGap
  // Keep the selector, card numbers and keyboard order in host order. Columns
  // determine positions on the canvas and may contain otherwise unrelated units.
  const nextRow = columnSizes.map(() => 0)
  const cards = nodes.map((node, index) => {
    const column = rank.get(node.id)
    const row = nextRow[column]++
    return {
      node,
      group: nodesById.get(node.parent)?.parent ? nodesById.get(node.parent).label : null,
      ordinal: index + 1,
      column,
      additionalPrerequisites: 0,
      x: padding + column * (cardWidth + columnGap),
      y: padding + (rows - columnSizes[column]) * (cardHeight + rowGap) / 2 + row * (cardHeight + rowGap),
    }
  })
  const cardById = new Map(cards.map(card => [card.node.id, card]))
  // A long prerequisite can be an independent condition at a branch join.
  // Only chainEdges may reduce a proven redundant prerequisite; distance in
  // the layout does not imply redundancy. Keep every remaining edge and use
  // the existing below-card lanes for links that span multiple columns.
  const drawnEdges = new Set(edges)
  for (const [id, group] of outgoing)
    outgoing.set(id, group.filter(edge => drawnEdges.has(edge)).sort((a, b) => cardById.get(a.to).y - cardById.get(b.to).y))
  for (const [id, group] of incoming)
    incoming.set(id, group.filter(edge => drawnEdges.has(edge)).sort((a, b) => cardById.get(a.from).y - cardById.get(b.from).y))
  const portOffset = (group, edge) => (group.indexOf(edge) - (group.length - 1) / 2) * Math.min(13, 52 / group.length)
  const bendOffset = (group, edge) => 12 + 28 * (group.indexOf(edge) + 1) / (group.length + 1)
  const pairKey = edge => JSON.stringify([edge.from, edge.to])
  const parallel = new Map()
  for (const edge of drawnEdges) {
    const pair = pairKey(edge)
    parallel.set(pair, (parallel.get(pair) ?? 0) + 1)
  }
  let laneCount = 0
  const wires = [...drawnEdges].map(edge => {
    const from = cardById.get(edge.from), to = cardById.get(edge.to)
    const exits = outgoing.get(edge.from), entries = incoming.get(edge.to)
    const startX = from.x + cardWidth, endX = to.x - 2
    const startY = from.y + cardHeight / 2 + portOffset(exits, edge)
    const endY = to.y + cardHeight / 2 + portOffset(entries, edge)
    const state = branchEdgeState(edge, from.node, to.node)
    const wire = { edge, from: from.node, to: to.node, state,
      key: JSON.stringify([edge.from, edge.to, edge.kind, edge.outcome ?? edge.case]),
      labelWidth: columnGap - 18,
      showLabel: state === 'dispositionReady' || edge.kind !== 'prerequisite' && (parallel.get(pairKey(edge)) === 1 || state === 'branchChosen') }
    if (to.column - from.column > 1) {
      // Route rank-skipping edges below the cards so they do not cross a task.
      const laneY = padding + bodyHeight + 22 + laneCount++ * 16
      const exitX = startX + bendOffset(exits, edge), entryX = endX - bendOffset(entries, edge)
      return { ...wire, path: `M ${startX} ${startY} H ${exitX} V ${laneY} H ${entryX} V ${endY} H ${endX}`,
        labelX: (startX + endX) / 2, labelY: laneY - 5 }
    }
    return { ...wire, path: `M ${startX} ${startY} C ${startX + 40} ${startY}, ${endX - 40} ${endY}, ${endX} ${endY}`,
      labelX: (startX + endX) / 2, labelY: (startY + endY) / 2 - 7 }
  })
  return {
    cards, wires, cardWidth, cardHeight,
    width: columnSizes.length * (cardWidth + columnGap) - columnGap + 2 * padding,
    height: bodyHeight + 2 * padding + laneCount * 16 + (laneCount ? 12 : 0),
  }
}

// An expanded group is a visual boundary, not a synthetic task/dependency.
// Reuse the ordinary per-scope reduction and states, then place whole groups
// vertically and their leaf workflows horizontally. All coordinates are local
// until the final flattening pass; execution/RPC data is never changed.
function groupedLayout(graph, collapsed) {
  const root = graph.nodes.find(node => node.parent === null)
  const children = new Map()
  for (const node of graph.nodes) {
    const rows = children.get(node.parent) ?? []
    rows.push(node); children.set(node.parent, rows)
  }
  const pad = 24, header = 58, gap = 76
  function scopeLayout(scope, ancestors = new Set()) {
    if (ancestors.has(scope.id)) return { cards: [], groups: [], wires: [], width: 280, height: 80 }
    const seen = new Set(ancestors).add(scope.id)
    const local = branchLayout(graph, scope.id)
    const members = children.get(scope.id) ?? []
    if (!members.some(node => expandedUnit(node))) return {
      ...local, groups: [], cards: local.cards.map(card => ({ ...card,
        group: scope.parent ? scope.label : null, width: local.cardWidth, height: local.cardHeight })),
      wires: local.wires.map(wire => ({ ...wire, scopeId: scope.id, offsetX: 0, offsetY: 0 })),
    }
    const items = local.cards.map(card => {
      const open = expandedUnit(card.node) && !collapsed.has(card.node.id)
      const body = open ? scopeLayout(card.node, seen) : null
      return { ...card, body, width: body ? Math.max(480, body.width) : local.cardWidth,
        height: body ? header + body.height : local.cardHeight }
    })
    const ranks = []
    for (const item of items) (ranks[item.column] ??= []).push(item)
    const rankWidth = rows => rows.reduce((sum, item) => sum + item.width, 0) + Math.max(0, rows.length - 1) * gap
    const width = Math.max(360, ...ranks.map(rankWidth)) + pad * 2
    let cursor = pad
    for (const rows of ranks) {
      let x = (width - rankWidth(rows)) / 2
      for (const item of rows) { item.x = x; item.y = cursor; x += item.width + gap }
      cursor += Math.max(...rows.map(item => item.height)) + gap
    }
    const height = cursor - gap + pad
    const byId = new Map(items.map(item => [item.node.id, item]))
    let lanes = 0
    const wires = local.wires.map(wire => {
      const from = byId.get(wire.edge.from), to = byId.get(wire.edge.to)
      const exits = local.wires.filter(row => row.edge.from === from.node.id)
      const entries = local.wires.filter(row => row.edge.to === to.node.id)
      const offset = rows => (rows.indexOf(wire) - (rows.length - 1) / 2) * Math.min(14, 60 / rows.length)
      const sx = from.x + from.width / 2 + offset(exits), sy = from.y + from.height
      const ex = to.x + to.width / 2 + offset(entries), ey = to.y - 2
      const rowBottom = Math.max(...ranks[from.column].map(item => item.y + item.height))
      const mid = (rowBottom + ey) / 2
      let route = `M ${sx} ${sy} V ${mid} H ${ex} V ${ey}`
      let labelX = (sx + ex) / 2, labelY = mid
      if (to.column - from.column > 1) {
        const lane = width + 16 + lanes++ * 18
        const exitY = rowBottom + 16 + exits.indexOf(wire) / exits.length * 16
        const entryY = ey - 16 - entries.indexOf(wire) / entries.length * 16
        route = `M ${sx} ${sy} V ${exitY} H ${lane} V ${entryY} H ${ex} V ${ey}`
        labelX = lane; labelY = (exitY + entryY) / 2
      }
      return { ...wire, path: route, labelX, labelY, labelWidth: 100, scopeId: scope.id, offsetX: 0, offsetY: 0 }
    })
    const cards = [], groups = []
    for (const { body, ...item } of items) {
      if (!body) { cards.push(item); continue }
      const dx = item.x + (item.width - body.width) / 2, dy = item.y + header
      groups.push({ ...item, taskCount: descendants(item.node.id).filter(node => directUnit(node)).length })
      cards.push(...body.cards.map(card => ({ ...card, x: card.x + dx, y: card.y + dy })))
      groups.push(...body.groups.map(group => ({ ...group, x: group.x + dx, y: group.y + dy })))
      wires.push(...body.wires.map(wire => ({ ...wire, offsetX: wire.offsetX + dx, offsetY: wire.offsetY + dy })))
    }
    return { cards, groups, wires, width: width + (lanes ? lanes * 18 + 62 : 0), height,
      cardWidth: local.cardWidth, cardHeight: local.cardHeight }
  }
  function descendants(id, seen = new Set()) {
    if (seen.has(id)) return []
    seen.add(id)
    return (children.get(id) ?? []).flatMap(node => [node, ...(expandedUnit(node) ? descendants(node.id, seen) : [])])
  }
  return root ? scopeLayout(root) : branchLayout({ ...graph, hierarchy: undefined })
}
