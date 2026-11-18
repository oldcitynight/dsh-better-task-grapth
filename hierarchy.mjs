// SPDX-License-Identifier: GPL-3.0-only
// Generic, opt-in scope gates. Model roles and context assembly live in the
// linked plugin; old graphs never acquire this policy through a read or upgrade.
import { canonical, copy, digest, GraphError } from './core.mjs'

const fail = (code, path, reason, extra = {}) => { throw new GraphError(code, { path, reason, ...extra }) }
export const isHierarchical = plan => plan?.hierarchy?.version === 1
export const childrenOf = (plan, id) => plan.nodes.filter(node => node.parent === id)
export function descendantsOf(plan, id) {
  return childrenOf(plan, id).flatMap(node => [node, ...descendantsOf(plan, node.id)])
}
export function ancestorsOf(plan, id) {
  const nodes = new Map(plan.nodes.map(node => [node.id, node])), result = []
  for (let node = nodes.get(id); node?.parent; node = nodes.get(node.parent)) result.push(nodes.get(node.parent))
  return result
}
export function validateHierarchy(plan) {
  if (plan.hierarchy === undefined) {
    if (plan.nodes.some(node => node.terminal !== undefined || node.acceptance !== undefined))
      fail('HIERARCHY_POLICY_REQUIRED', '/hierarchy', 'Terminal gates require an explicit hierarchy policy.')
    return
  }
  const policy = plan.hierarchy
  if (!isHierarchical(plan) || Object.keys(policy).some(key => !['version', 'maxGroupDepth'].includes(key))
      || !Number.isSafeInteger(policy.maxGroupDepth) || policy.maxGroupDepth < 1 || policy.maxGroupDepth > 16)
    fail('HIERARCHY_POLICY_INVALID', '/hierarchy', 'Use {version:1,maxGroupDepth:3}; group depth is 1..16 and excludes leaves.')
  if (plan.enableSwitch || plan.edges.some(edge => edge.kind !== 'prerequisite'))
    fail('HIERARCHY_PREREQUISITES_REQUIRED', '/edges', 'Version 1 scope gates use prerequisite edges; conditional route graphs retain the original protocol.')
  for (const [index, node] of plan.nodes.entries()) {
    const at = '/nodes/' + index
    if (node.kind === 'leaf') {
      if (node.terminal !== undefined || node.acceptance !== undefined)
        fail('HIERARCHY_GROUP_FIELDS_ON_LEAF', at, 'terminal and acceptance belong to containers.')
      continue
    }
    const depth = ancestorsOf(plan, node.id).length + 1
    if (depth > policy.maxGroupDepth) fail('GROUP_DEPTH_LIMIT', at + '/parent', 'Only containers count toward the frozen group depth.', { observed: depth, maximum: policy.maxGroupDepth })
    const children = childrenOf(plan, node.id), ids = new Set(children.map(child => child.id))
    if (!ids.has(node.terminal)) fail('GROUP_TERMINAL_MUST_BE_DIRECT_CHILD', at + '/terminal', 'Select exactly one direct child as the terminal.', { allowed: children.map(child => child.key) })
    if (typeof node.acceptance !== 'string' || !node.acceptance.trim() || node.acceptance.length > 8000)
      fail('GROUP_ACCEPTANCE_REQUIRED', at + '/acceptance', 'Provide the group objective and acceptance criteria (1..8000 characters).')
    const reaches = new Set([node.terminal])
    let changed = true
    while (changed) {
      changed = false
      for (const edge of plan.edges) if (ids.has(edge.from) && reaches.has(edge.to) && !reaches.has(edge.from)) { reaches.add(edge.from); changed = true }
    }
    if (reaches.size !== children.length) fail('GROUP_TERMINAL_COVERAGE_GAP', at + '/terminal', 'Every direct child must have a prerequisite path to the terminal.', { missing: children.filter(child => !reaches.has(child.id)).map(child => child.key) })
  }
  for (const [index, edge] of plan.edges.entries()) {
    const from = plan.nodes.find(node => node.id === edge.from), to = plan.nodes.find(node => node.id === edge.to)
    if (!from.parent || from.parent !== to.parent) fail('CROSS_SCOPE_EDGE', '/edges/' + index, 'Edges connect siblings. Use the enclosing group contract and report for cross-group dependencies.', { from: from.key, to: to.key })
  }
}

export function initialHierarchy() { return { groups: {}, pending: null } }
export function hierarchyComplete(state, id) {
  return state.leaves[id] ? state.leaves[id].status === 'COMPLETE' : state.hierarchy.groups[id]?.outcome === 'COMPLETE'
}
const settled = (state, node) => node.kind === 'container' ? hierarchyComplete(state, node.id)
  : ['COMPLETE', 'INCOMPLETE', 'SKIPPED'].includes(state.leaves[node.id]?.status)
export function scopeSignature(state, scopeId) {
  const scope = state.plan.nodes.find(node => node.id === scopeId), children = childrenOf(state.plan, scopeId)
  const ids = new Set(children.map(child => child.id))
  return digest({ policy: state.plan.hierarchy, scope, aliasContracts: aliasScopes(state.plan, scopeId), children,
    edges: state.plan.edges.filter(edge => ids.has(edge.from) || ids.has(edge.to)),
    results: children.map(child => child.kind === 'leaf' ? state.leaves[child.id] : state.hierarchy.groups[child.id] ?? null) })
}
export function aliasScopes(plan, scopeId) {
  const result = [], nodes = new Map(plan.nodes.map(node => [node.id, node]))
  for (let node = nodes.get(scopeId); node?.parent; node = nodes.get(node.parent)) {
    const parent = nodes.get(node.parent), children = childrenOf(plan, parent.id)
    if (children.length !== 1 || children[0].id !== node.id || node.kind !== 'container') break
    result.push(parent)
  }
  return result
}
function afterUnit(state, nodeId) {
  const node = state.plan.nodes.find(node => node.id === nodeId)
  if (!node.parent) { state.hierarchy.pending = null; return }
  const scope = state.plan.nodes.find(row => row.id === node.parent)
  state.hierarchy.pending = { kind: scope.terminal === nodeId ? 'GROUP_REVIEW' : 'PLAN_REVIEW', scopeId: scope.id, subjectId: nodeId }
}
export function hierarchyAfterLeaf(state, nodeId) { if (isHierarchical(state.plan)) afterUnit(state, nodeId) }
export function hierarchyReady(state) {
  if (state.active || state.hierarchy.pending) return []
  const { plan } = state
  const started = node => node.kind === 'leaf' ? Boolean(state.leaves[node.id]?.attemptId || state.leaves[node.id]?.reopenedFrom)
    : descendantsOf(plan, node.id).some(child => child.kind === 'leaf' && (state.leaves[child.id]?.attemptId || state.leaves[child.id]?.reopenedFrom))
  const ready = (node, scope) => plan.edges.filter(edge => edge.to === node.id).every(edge => {
    const source = plan.nodes.find(child => child.id === edge.from)
    // A terminal leaf consumes accepted dispositions, including BLOCKED/FAILED.
    // Other work still requires a successful prerequisite.
    return scope.terminal === node.id && node.kind === 'leaf' ? settled(state, source) : hierarchyComplete(state, source.id)
  })
  const descend = scope => {
    if (hierarchyComplete(state, scope.id)) return []
    const children = childrenOf(plan, scope.id)
    const inProgressGroup = children.find(node => node.kind === 'container' && started(node) && !hierarchyComplete(state, node.id) && ready(node, scope))
    if (inProgressGroup) return descend(inProgressGroup)
    const candidates = children.filter(node => node.kind === 'container' ? !hierarchyComplete(state, node.id) : state.leaves[node.id]?.status === 'PENDING')
      .filter(node => ready(node, scope))
    const first = candidates[0]
    return !first ? [] : first.kind === 'container' ? descend(first) : candidates.filter(node => node.kind === 'leaf')
  }
  return descend(plan.nodes.find(node => node.parent === null))
}
export function hierarchyFocus(state) {
  if (state.hierarchy.pending) return state.hierarchy.pending.scopeId
  if (state.active) return state.plan.nodes.find(node => node.id === state.active.nodeId).parent
  const next = hierarchyReady(state)[0]
  if (next) return next.parent
  let scope = state.plan.nodes.find(node => node.parent === null)
  while (true) {
    const child = childrenOf(state.plan, scope.id).find(node => node.kind === 'container' && !hierarchyComplete(state, node.id)
      && descendantsOf(state.plan, node.id).some(leaf => state.leaves[leaf.id]?.attemptId))
    if (!child) return scope.id
    scope = child
  }
}
export function applyScopeGate(state, data) {
  if (!isHierarchical(state.plan) || state.active || !state.hierarchy.pending) fail('SCOPE_GATE_NOT_PENDING', '/scopeId', 'A scope gate can be committed only at its pending serial boundary.')
  const pending = state.hierarchy.pending
  if (Object.keys(data).some(key => !['scopeId', 'inputHash', 'runId', 'kind', 'report'].includes(key))
      || data.scopeId !== pending.scopeId || data.kind !== pending.kind || data.inputHash !== scopeSignature(state, data.scopeId)
      || typeof data.runId !== 'string' || !data.runId.trim()) fail('SCOPE_GATE_STALE', '/inputHash', 'The gate must bind the current scope, role and child result identities.')
  if (data.kind === 'PLAN_REVIEW') {
    if (data.report !== undefined) fail('SCOPE_GATE_UNEXPECTED_REPORT', '/report', 'Plan review does not create a group execution report.')
    state.hierarchy.pending = null
  } else {
    const children = childrenOf(state.plan, data.scopeId)
    if (!children.every(node => settled(state, node))) fail('GROUP_CHILD_REPORTS_PENDING', '/scopeId', 'Every direct child must have a terminal disposition or accepted group report.')
    if (!data.report || typeof data.report.summary !== 'string' || !data.report.summary.trim()
        || data.report.outcome !== 'COMPLETE' || !Array.isArray(data.report.children)
        || canonical(data.report.children) !== canonical(children.map(node => ({ id: node.id,
          sha256: digest(node.kind === 'leaf' ? state.leaves[node.id] : state.hierarchy.groups[node.id]) }))))
      fail('GROUP_REPORT_INPUT_MISMATCH', '/report', 'A group report seals the exact direct-child results with a COMPLETE audit conclusion.')
    const aliases = aliasScopes(state.plan, data.scopeId)
    const report = { ...copy(data.report), scopeId: data.scopeId, inputHash: data.inputHash, runId: data.runId }
    state.hierarchy.groups[data.scopeId] = report
    for (const alias of aliases) state.hierarchy.groups[alias.id] = { outcome: 'COMPLETE', aliasOf: data.scopeId, reportHash: digest(report) }
    afterUnit(state, aliases.at(-1)?.id ?? data.scopeId)
  }
}
export function invalidateHierarchy(state, nodeIds) {
  if (!isHierarchical(state.plan)) return
  const ids = new Set(nodeIds.flatMap(id => [id, ...ancestorsOf(state.plan, id).map(node => node.id)]))
  for (const id of ids) delete state.hierarchy.groups[id]
  state.hierarchy.pending = null
}
export function hierarchyAfterRevision(state, previousPlan) {
  if (!isHierarchical(state.plan)) return
  const changed = state.plan.nodes.filter(node => canonical(node) !== canonical(previousPlan.nodes.find(old => old.id === node.id))).map(node => node.id)
  for (const edge of [...state.plan.edges, ...previousPlan.edges]) if (!state.plan.edges.some(row => canonical(row) === canonical(edge))
      || !previousPlan.edges.some(row => canonical(row) === canonical(edge))) changed.push(edge.from, edge.to)
  invalidateHierarchy(state, changed)
  for (const id of Object.keys(state.hierarchy.groups)) if (!state.plan.nodes.some(node => node.id === id)) delete state.hierarchy.groups[id]
  // A context-only repair of a pending group audit must be audited again. Do
  // not fabricate completion or silently skip the previously submitted terminal.
  const candidates = state.plan.nodes.filter(node => node.kind === 'container' && !hierarchyComplete(state, node.id)
    && childrenOf(state.plan, node.id).every(child => settled(state, child)))
    .sort((a, b) => ancestorsOf(state.plan, b.id).length - ancestorsOf(state.plan, a.id).length)
  if (candidates[0]) state.hierarchy.pending = { kind: 'GROUP_REVIEW', scopeId: candidates[0].id, subjectId: candidates[0].terminal }
}
