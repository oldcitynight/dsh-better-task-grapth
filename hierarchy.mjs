// SPDX-License-Identifier: GPL-3.0-only
// Generic, opt-in scope gates. Model roles and context assembly live in the
// linked plugin; old graphs never acquire this policy through a read or upgrade.
import { canonical, copy, digest, GraphError } from './core.mjs'

import { runtimeRules } from './rules.mjs'
const fail = (code, path, reason, extra = {}) => { throw new GraphError(code, { path, reason, ...extra }) }
export const isHierarchical = plan => [1, 2].includes(plan?.hierarchy?.version)
export const childrenOf = (plan, id) => plan.nodes.filter(node => node.parent === id)
export function descendantsOf(plan, id) {
  return childrenOf(plan, id).flatMap(node => [node, ...descendantsOf(plan, node.id)])
}
export function ancestorsOf(plan, id) {
  const nodes = new Map(plan.nodes.map(node => [node.id, node])), result = []
  for (let node = nodes.get(id); node?.parent; node = nodes.get(node.parent)) result.push(nodes.get(node.parent))
  return result
}
function terminalIssue(scope, terminal, target, path) {
  return { code: 'TERMINAL_AS_PREDECESSOR', path, scope, terminal, target,
    reason: `Terminal "${terminal}" in scope "${scope}" cannot be a predecessor of sibling "${target}".`,
    correction: 'Remove this dependency or choose a terminal with no same-scope successors.' }
}

function referencePath(expr, key, path) {
  if (!expr || typeof expr !== 'object') return
  if (expr.node === key) return path + '/node'
  if (expr.not) return referencePath(expr.not, key, path + '/not')
  const op = expr.all ? 'all' : 'any'
  if (!Array.isArray(expr[op])) return
  for (const [index, child] of expr[op].entries()) {
    const found = referencePath(child, key, path + '/' + op + '/' + index)
    if (found) return found
  }
}

// Authoring drafts may still contain holes. Any already written reference is binding.
export function terminalRuleIssue(scope, terminal, target, rows, path = '/rules') {
  if (!terminal || !Array.isArray(rows)) return null
  for (const [index, row] of rows.entries()) {
    const found = referencePath(row?.when, terminal, path + '/' + index + '/when')
    if (found) return { ...terminalIssue(scope, terminal, target, found), ruleId: row.id }
  }
  return null
}

export function terminalDependencyIssue(plan) {
  if (!isHierarchical(plan) || !plan.edges.length) return null
  const nodes = new Map(plan.nodes.map(node => [node.id, node]))
  for (const [index, edge] of plan.edges.entries()) {
    const source = nodes.get(edge.from), target = nodes.get(edge.to), scope = nodes.get(source.parent)
    if (scope?.terminal !== source.id || target.parent !== scope.id) continue
    if (edge.kind === 'rule') {
      const issue = terminalRuleIssue(scope.key, source.key, target.key, target.rules, '/nodes/' + plan.nodes.indexOf(target) + '/rules')
      if (issue) return issue
    }
    return terminalIssue(scope.key, source.key, target.key, '/edges/' + index + '/from')
  }
  return null
}

export function validateHierarchy(plan, { historicalTerminalSources = false } = {}) {
  if (plan.hierarchy === undefined) {
    if (plan.nodes.some(node => node.terminal !== undefined || node.acceptance !== undefined))
      fail('HIERARCHY_POLICY_REQUIRED', '/hierarchy', 'Terminal gates require an explicit hierarchy policy.')
    return
  }
  const policy = plan.hierarchy
  if (policy.version === 2 && plan.ruleVersion !== 1) fail('UNIT_RULES_REQUIRED', '/ruleVersion', 'Unit workflows require the audited rule protocol.')
  if (!isHierarchical(plan) || Object.keys(policy).some(key => !['version', 'maxGroupDepth'].includes(key))
      || !Number.isSafeInteger(policy.maxGroupDepth) || policy.maxGroupDepth < (policy.version === 2 ? 0 : 1))
    fail('HIERARCHY_POLICY_INVALID', '/hierarchy', 'Use a valid configured expansion depth.')
  if (plan.enableSwitch || plan.edges.some(edge => edge.kind !== 'prerequisite' && !(plan.ruleVersion === 1 && edge.kind === 'rule') && !(edge.kind === 'route'
      && plan.nodes.some(node => node.id === edge.from && node.kind === 'container') && ['complete','blocked'].includes(edge.outcome))))
    fail('HIERARCHY_PREREQUISITES_REQUIRED', '/edges', 'A hierarchical route must use an audited sibling group and a complete or blocked outcome.')
  if (!historicalTerminalSources) {
    const issue = terminalDependencyIssue(plan)
    if (issue) throw new GraphError(issue.code, issue)
  }
  for (const [index, node] of plan.nodes.entries()) {
    const at = '/nodes/' + index
    if (node.kind === 'leaf') {
      if (node.terminal !== undefined || node.acceptance !== undefined)
        fail(policy.version === 2 ? 'PLANNED_UNIT_FIELDS_REQUIRED' : 'HIERARCHY_GROUP_FIELDS_ON_LEAF', at, 'Only an expanded unit may declare its terminal and acceptance.')
      continue
    }
    const depth = ancestorsOf(plan, node.id).length + 1
    if (depth > policy.maxGroupDepth) fail(policy.version === 2 ? 'UNIT_DEPTH_LIMIT' : 'GROUP_DEPTH_LIMIT', at + '/parent', 'Each expanded unit, including an expanded root, counts as one layer.', { observed: depth, maximum: policy.maxGroupDepth })
    const children = childrenOf(plan, node.id), ids = new Set(children.map(child => child.id))
    if (!ids.has(node.terminal)) fail(policy.version === 2 ? 'UNIT_TERMINAL_MUST_BE_DIRECT_CHILD' : 'GROUP_TERMINAL_MUST_BE_DIRECT_CHILD', at + '/terminal', 'Select exactly one direct child as the terminal.', { allowed: children.map(child => child.key) })
    if (typeof node.acceptance !== 'string' || !node.acceptance.trim())
      fail(policy.version === 2 ? 'UNIT_ACCEPTANCE_REQUIRED' : 'GROUP_ACCEPTANCE_REQUIRED', at + '/acceptance', 'Provide the unit objective and acceptance criteria.')
    if (plan.ruleVersion) continue // Rule graphs settle independent siblings at the group review boundary.
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
  return state.leaves[id] ? state.leaves[id].status === 'COMPLETE' : ['COMPLETE','PASS'].includes(state.hierarchy.groups[id]?.outcome)
}
export const hasGroupRoutes = plan => isHierarchical(plan) && plan.edges.some(edge => edge.kind === 'route')
export const permitsBlockedOutcome = (plan, id) => plan.edges.some(edge => edge.kind === 'route' && edge.from === id)

// Ordinary prerequisites must all hold. Incoming group outcomes are alternatives.
// Participation is derived from audit receipts without manufacturing leaf outcomes.
export function groupRouting(state) {
  if (state.plan.ruleVersion) return runtimeRules(state)
  if (!hasGroupRoutes(state.plan)) return null
  const nodes = new Map(state.plan.nodes.map(node => [node.id, node]))
  const inbound = new Map(state.plan.nodes.map(node => [node.id, []]))
  for (const edge of state.plan.edges) inbound.get(edge.to).push(edge)
  const cache = new Map()
  function match(edge) {
    const upstream = branch(edge.from)
    if (upstream === 'NOT_SELECTED') return false
    if (upstream === 'WAITING') return null
    const outcome = state.hierarchy.groups[edge.from]?.outcome
    return outcome ? outcome.toLowerCase() === edge.outcome : null
  }
  function branch(id) {
    if (cache.has(id)) return cache.get(id)
    const node = nodes.get(id), edges = inbound.get(id)
    const markers = edges.filter(edge => edge.kind === 'prerequisite').map(edge => branch(edge.from))
    if (node.parent) markers.push(branch(node.parent))
    const routes = edges.filter(edge => edge.kind === 'route')
    if (routes.length) {
      const outcomes = routes.map(match)
      markers.push(outcomes.includes(true) ? 'SELECTED' : outcomes.includes(null) ? 'WAITING' : 'NOT_SELECTED')
    }
    const result = markers.includes('NOT_SELECTED') ? 'NOT_SELECTED' : markers.includes('WAITING') ? 'WAITING' : markers.includes('SELECTED') ? 'SELECTED' : null
    cache.set(id, result)
    return result
  }
  function unmet(id) {
    const node = nodes.get(id), edges = inbound.get(id)
    const missing = edges.filter(edge => edge.kind === 'prerequisite' && !hierarchyPrerequisiteSatisfied(state, nodes.get(node.parent), node, nodes.get(edge.from))).map(edge => edge.from)
    const routes = edges.filter(edge => edge.kind === 'route')
    if (routes.length && !routes.some(edge => match(edge) === true)) missing.push(...routes.map(edge => edge.from))
    return [...new Set(missing)]
  }
  return { branch, unmet }
}
export function childUnitResult(state, node, routing = groupRouting(state)) {
  if (state.plan.ruleVersion && routing.outcome(node.id) === 'BLOCK') {
    return { outcome: 'BLOCK', nodeId: node.id, rules: node.rules ?? [],
      predecessors: state.plan.edges.filter(edge => edge.to === node.id).map(edge => ({
        nodeId: edge.from, outcome: routing.outcome(edge.from)
      })) }
  }
  if (routing?.branch(node.id) === 'NOT_SELECTED') return { outcome: 'NOT_SELECTED', nodeId: node.id,
    routes: state.plan.edges.filter(edge => edge.to === node.id).map(edge => ({ ...edge, sourceOutcome: state.hierarchy.groups[edge.from]?.outcome ?? null })) }
  return node.kind === 'leaf' ? state.leaves[node.id] : state.hierarchy.groups[node.id]
}
const settled = (state, node) => node.kind === 'container' ? Boolean(state.hierarchy.groups[node.id])
  : ['COMPLETE', 'INCOMPLETE', 'SKIPPED'].includes(state.leaves[node.id]?.status)
export function scopeSignature(state, scopeId) {
  const scope = state.plan.nodes.find(node => node.id === scopeId), children = childrenOf(state.plan, scopeId)
  const ids = new Set(children.map(child => child.id))
  return digest({ policy: state.plan.hierarchy, scope, aliasContracts: aliasScopes(state.plan, scopeId), children,
    edges: state.plan.edges.filter(edge => ids.has(edge.from) || ids.has(edge.to)),
    results: children.map(child => child.kind === 'leaf' ? state.leaves[child.id] : state.hierarchy.groups[child.id] ?? null) })
}
export function aliasScopes(plan, scopeId) {
  if (plan.ruleVersion) return []
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
  if (state.plan.hierarchy.version === 2) {
    state.hierarchy.pending = { kind: scope.terminal === nodeId ? 'GROUP_REVIEW' : 'PLAN_REVIEW', scopeId: scope.id, subjectId: nodeId }
    return
  }
  if (state.plan.ruleVersion) {
    const routing = runtimeRules(state)
    if (routing.outcome(scope.id) === 'BLOCK') { afterUnit(state,scope.id); return }
    const done = childrenOf(state.plan,scope.id).every(n=>routing.outcome(n.id)!==null)
    state.hierarchy.pending = {kind:done?'GROUP_REVIEW':'PLAN_REVIEW',scopeId:scope.id,subjectId:done?scope.terminal:nodeId}
    return
  }
  state.hierarchy.pending = { kind: scope.terminal === nodeId ? 'GROUP_REVIEW' : 'PLAN_REVIEW', scopeId: scope.id, subjectId: nodeId }
}
export function hierarchyAfterUnitExecution(state, nodeId) { if (isHierarchical(state.plan)) afterUnit(state, nodeId) }
/** A terminal leaf may consume a settled disposition. Ordinary successors require success. */
export function hierarchyPrerequisiteSatisfied(state, scope, target, source) {
  return scope.terminal === target.id && target.kind === 'leaf' && source.kind === 'leaf' ? settled(state, source) : hierarchyComplete(state, source.id)
}
export function hierarchyReady(state, { terminalLast = true, deferredTerminals, planIssue = terminalDependencyIssue(state.plan) } = {}) {
  if (state.active || state.hierarchy.pending || planIssue || stalledUnitScope(state)) return []
  const { plan } = state
  const started = node => node.kind === 'leaf' ? Boolean(state.leaves[node.id]?.attemptId || state.leaves[node.id]?.reopenedFrom)
    : descendantsOf(plan, node.id).some(child => child.kind === 'leaf' && (state.leaves[child.id]?.attemptId || state.leaves[child.id]?.reopenedFrom))
  const routing = groupRouting(state)
  const ready = (node, scope) => routing ? !['NOT_SELECTED','WAITING'].includes(routing.branch(node.id)) && !routing.unmet(node.id).length : plan.edges.filter(edge => edge.to === node.id).every(edge => {
    const source = plan.nodes.find(child => child.id === edge.from)
    return hierarchyPrerequisiteSatisfied(state, scope, node, source)
  })
  const descend = scope => {
    if (state.hierarchy.groups[scope.id]) return []
    const continuing = [], ordinary = []
    let terminal
    for (const node of childrenOf(plan, scope.id)) {
      const pending = node.kind === 'container' ? !state.hierarchy.groups[node.id] : state.leaves[node.id]?.status === 'PENDING'
      if (!pending || !ready(node, scope)) continue
      if (terminalLast && node.id === scope.terminal) terminal = node
      else if (node.kind === 'container' && started(node)) continuing.push(node)
      else ordinary.push(node)
    }
    let choices = []
    for (const node of [...continuing, ...ordinary]) {
      if (node.kind === 'leaf') {
        choices = ordinary.filter(child => child.kind === 'leaf')
        break
      }
      choices = descend(node)
      // Older dispatch receipts stopped at the first selected group, even when it had no runnable leaf.
      if (choices.length || !terminalLast) break
    }
    if (!terminal || (choices.length && !deferredTerminals)) return choices
    const terminalChoices = terminal.kind === 'leaf' ? [terminal] : descend(terminal)
    if (!choices.length) return terminalChoices
    for (const node of terminalChoices) deferredTerminals.add(node.id)
    return choices
  }
  const root = plan.nodes.find(node => node.parent === null)
  if (root.kind === 'leaf') return state.leaves[root.id]?.status === 'PENDING' ? [root] : []
  return descend(root)
}
// A planned unit owns its local admission failure even when a different layer has work.
export function stalledUnitScope(state) {
  if (state.plan.hierarchy?.version !== 2 || state.active || state.suspended || state.hierarchy.pending) return null
  const routing = runtimeRules(state)
  function inspect(unit) {
    if (unit.kind !== 'container' || routing.entry(unit.id) !== true || routing.outcome(unit.id) !== null) return null
    const children = childrenOf(state.plan, unit.id)
    for (const child of children) {
      const stalled = inspect(child)
      if (stalled) return stalled
    }
    return children.some(child => routing.entry(child.id) === true && routing.outcome(child.id) === null) ? null : unit.id
  }
  return inspect(state.plan.nodes.find(node => !node.parent))
}
export function hierarchyFocus(state) {
  if (state.hierarchy.pending) return state.hierarchy.pending.scopeId
  if (state.active) return state.plan.nodes.find(node => node.id === state.active.nodeId).parent ?? state.active.nodeId
  const stalled = stalledUnitScope(state)
  if (stalled) return stalled
  const issue = terminalDependencyIssue(state.plan)
  if (issue) return state.plan.nodes.find(node => node.key === issue.scope).id
  const next = hierarchyReady(state, { planIssue: null })[0]
  if (next) return next.parent ?? next.id
  const routing = groupRouting(state)
  let scope = state.plan.nodes.find(node => node.parent === null)
  while (true) {
    const child = childrenOf(state.plan, scope.id).find(node => node.kind === 'container' && !state.hierarchy.groups[node.id]
      && !['NOT_SELECTED','WAITING'].includes(routing?.branch(node.id))
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
    const routing = groupRouting(state)
    if (['NOT_SELECTED','WAITING'].includes(routing?.branch(pending.subjectId))
        || (state.plan.hierarchy.version === 2 ? !['PASS', 'FAILED'].includes(routing.outcome(pending.subjectId)) : !children.every(node => settled(state, node) || routing?.branch(node.id) === 'NOT_SELECTED'))) fail('GROUP_CHILD_REPORTS_PENDING', '/scopeId', 'Every direct child must have a terminal disposition or accepted group report.')
    if (!data.report || typeof data.report.summary !== 'string' || !data.report.summary.trim()
        || !((state.plan.ruleVersion ? data.report.outcome === 'PASS' || data.report.outcome === 'FAILED' && data.report.audit?.action === 'FAILED' && typeof data.report.audit.unmetCriterion === 'string' && data.report.audit.unmetCriterion.trim() && Array.isArray(data.report.audit.evidence) && data.report.audit.evidence.length > 0 : data.report.outcome === 'COMPLETE') || !state.plan.ruleVersion && data.report.outcome === 'BLOCKED' && permitsBlockedOutcome(state.plan, data.scopeId)
          && data.report.audit?.action === 'BLOCKED' && typeof data.report.audit.unmetCriterion === 'string' && data.report.audit.unmetCriterion.trim()
          && typeof data.report.audit.scopeBoundary === 'string' && data.report.audit.scopeBoundary.trim() && Array.isArray(data.report.audit.evidence) && data.report.audit.evidence.length)
        || !Array.isArray(data.report.children)
        || canonical(data.report.children) !== canonical(children.map(node => ({ id: node.id,
          sha256: digest(childUnitResult(state, node, routing)) }))))
      fail('GROUP_REPORT_INPUT_MISMATCH', '/report', 'Seal every direct-child result. A blocked audit requires a declared group outcome route and an evidenced unmet criterion.')
    const aliases = state.plan.ruleVersion ? [] : aliasScopes(state.plan, data.scopeId)
    const report = { ...copy(data.report), scopeId: data.scopeId, inputHash: data.inputHash, runId: data.runId }
    state.hierarchy.groups[data.scopeId] = report
    for (const alias of aliases) state.hierarchy.groups[alias.id] = { outcome: report.outcome, aliasOf: data.scopeId, reportHash: digest(report) }
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
  const conditional = state.plan.ruleVersion || hasGroupRoutes(state.plan) || hasGroupRoutes(previousPlan)
  for (const edge of [...state.plan.edges, ...previousPlan.edges]) if (!state.plan.edges.some(row => canonical(row) === canonical(edge))
      || !previousPlan.edges.some(row => canonical(row) === canonical(edge))) {
    // A new consumer does not revoke a producer's own final audit.
    if (!conditional) changed.push(edge.from)
    changed.push(edge.to)
  }
  invalidateHierarchy(state, changed)
  for (const id of Object.keys(state.hierarchy.groups)) if (!state.plan.nodes.some(node => node.id === id)) delete state.hierarchy.groups[id]
  // A context-only repair of a pending group audit must be audited again. Do
  // not fabricate completion or silently skip the previously submitted terminal.
  const routing = groupRouting(state)
  const candidates = state.plan.nodes.filter(node => node.kind === 'container' && !state.hierarchy.groups[node.id]
    && !['WAITING','NOT_SELECTED'].includes(routing?.branch(node.id)) && !['WAITING','NOT_SELECTED'].includes(routing?.branch(node.terminal))
    && (state.plan.hierarchy.version === 2 ? ['PASS', 'FAILED'].includes(routing.outcome(node.terminal)) : childrenOf(state.plan, node.id).every(child => settled(state, child) || routing?.branch(child.id) === 'NOT_SELECTED')))
    .sort((a, b) => ancestorsOf(state.plan, b.id).length - ancestorsOf(state.plan, a.id).length)
  if (candidates[0]) state.hierarchy.pending = { kind: 'GROUP_REVIEW', scopeId: candidates[0].id, subjectId: candidates[0].terminal }
}
