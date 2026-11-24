// SPDX-License-Identifier: GPL-3.0-only

// Emit missing predecessors immediately before the first successor that needs
// them. An insertion before C need not move an unrelated old sibling past C.
function predecessorOrder(preferred, edges) {
  if (!edges?.length) return preferred
  const ranks = new Map(preferred.map((id, index) => [id, index]))
  const incoming = new Map(preferred.map(id => [id, []]))
  for (const { from, to } of edges) incoming.get(to).push(from)
  for (const sources of incoming.values()) sources.sort((left, right) => ranks.get(left) - ranks.get(right))
  const ordered = [], placed = new Set(), visiting = new Set()
  function emit(id) {
    if (placed.has(id)) return true
    if (visiting.has(id)) return false
    visiting.add(id)
    for (const source of incoming.get(id)) if (!emit(source)) return false
    visiting.delete(id)
    placed.add(id)
    ordered.push(id)
    return true
  }
  if (preferred.every(emit)) return ordered
  // Legacy groups can contain interleaved work. Keep their mutual order
  // stable, but still place their unambiguous predecessors and successors.
  const ancestors = new Map()
  for (const id of preferred) {
    const seen = new Set(), pending = [...incoming.get(id)]
    while (pending.length) {
      const source = pending.pop()
      if (seen.has(source)) continue
      seen.add(source)
      pending.push(...incoming.get(source))
    }
    ancestors.set(id, seen)
  }
  const oneWay = []
  for (const [to, sources] of ancestors) for (const from of sources) {
    if (!ancestors.get(from).has(to)) oneWay.push({ from, to })
  }
  return predecessorOrder(preferred, oneWay)
}

function ancestry(nodes, id) {
  const path = []
  for (let node = nodes.get(id); node; node = nodes.get(node.parent)) path.push(node.id)
  return path.reverse()
}

// Use the preceding table to resolve ties without rewriting the audited plan.
export function updateUnitOrder(previous, plan, recordedAt) {
  const nodes = new Map(plan.nodes.map(node => [node.id, node]))
  const retained = (previous?.outline ?? previous?.ids ?? []).filter(id => nodes.has(id))
  const known = new Set(retained)
  const added = plan.nodes.filter(node => !known.has(node.id)).map(node => node.id)
  const children = new Map(plan.nodes.map(node => [node.id, []]))
  for (const id of [...retained, ...added]) {
    const { parent } = nodes.get(id)
    if (parent !== null) children.get(parent).push(id)
  }
  const byScope = new Map()
  let crossScope = false
  for (let { from, to } of plan.edges) {
    if (nodes.get(from).parent !== nodes.get(to).parent) {
      crossScope = true
      const source = ancestry(nodes, from), target = ancestry(nodes, to)
      const fork = source.findIndex((id, index) => id !== target[index])
      if (fork === -1 || !target[fork]) continue
      from = source[fork]
      to = target[fork]
    }
    const scope = nodes.get(to).parent
    if (!byScope.has(scope)) byScope.set(scope, [])
    byScope.get(scope).push({ from, to })
  }

  const outline = []
  function appendSubtree(id) {
    outline.push(id)
    const peers = children.get(id), { terminal } = nodes.get(id)
    if (terminal) peers.sort((a, b) => Number(a === terminal) - Number(b === terminal))
    for (const child of predecessorOrder(peers, byScope.get(id))) appendSubtree(child)
  }
  appendSubtree(plan.nodes.find(node => node.parent === null).id)
  const ids = crossScope ? predecessorOrder(outline, plan.edges) : outline
  const createdAt = Object.fromEntries(ids.map(id => [id, known.has(id) ? previous.createdAt[id] : recordedAt ?? null]))
  // If old cross-group dependencies interleave the tree, keep its sibling
  // order as well. Feeding the interleaved leaves back as sibling preferences
  // could move them again at the next otherwise identical revision.
  return ids.some((id, index) => id !== outline[index]) ? { ids, createdAt, outline } : { ids, createdAt }
}
