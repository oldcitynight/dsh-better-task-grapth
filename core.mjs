// SPDX-License-Identifier: GPL-3.0-only
import { createHash, randomUUID } from 'node:crypto'
import { isHierarchical, hasGroupRoutes, groupRouting, validateHierarchy, terminalDependencyIssue, initialHierarchy, hierarchyReady, hierarchyPrerequisiteSatisfied, hierarchyComplete, hierarchyAfterUnitExecution, applyScopeGate, invalidateHierarchy, hierarchyAfterRevision, ancestorsOf, descendantsOf } from './hierarchy.mjs'
import { attachDiagnostic, feedbackText, withValidation } from './validation.mjs'
import { updateUnitOrder } from './unit-order.mjs'

import { atoms, validateRows, graphWitnesses, runtimeRules, inspectRules } from './rules.mjs'
import { resolveWorkflowLimits } from './workflow-limits.mjs'
export class GraphError extends Error {
  constructor(code, message = code) { super(typeof message === 'string' ? message : code); this.name = 'GraphError'; this.code = code; attachDiagnostic(this, typeof message === 'object' ? message : undefined); this.message = feedbackText(this) }
}
const fail = (code, message) => { throw new GraphError(code, message) }
const own = (object, key) => Object.hasOwn(object, key)
export const copy = value => structuredClone(value)
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex')
const identifier = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,79}$/.test(value)
const TERMINAL_LAST = 'terminal-last'
const TERMINAL_SINK = 'sink'
function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) fail('INVALID_TEXT', { path: (name ? '/' + name.replaceAll('.', '/') : ''), reason: 'Expected non-empty text.', actualType: typeof value, actualLength: typeof value === 'string' ? value.length : null })
  return value.trim()
}
function object(value, allowed, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_OBJECT', { path: (name ? '/' + name.replaceAll('.', '/') : ''), reason: 'Expected a plain object.' })
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('UNKNOWN_FIELD', { path: (name ? '/' + name.replaceAll('.', '/') : ''), reason: 'Unexpected object fields are not accepted.', fields: Object.keys(value).filter(key => !allowed.includes(key)), allowed })
}
function integer(value, minimum, name) {
  if (!Number.isSafeInteger(value) || value < minimum) fail('INVALID_INTEGER', { path: '/' + name, reason: 'Expected a safe integer at least the stated minimum.', minimum, observed: value })
  return value
}
function noCycles(ids, pairs, code) {
  const outgoing = new Map(ids.map(id => [id, []])), degree = new Map(ids.map(id => [id, 0]))
  for (const [a, b] of pairs) { outgoing.get(a).push(b); degree.set(b, degree.get(b) + 1) }
  const ready = ids.filter(id => degree.get(id) === 0)
  let count = 0
  for (let i = 0; i < ready.length; i++) {
    const id = ready[i]; count++
    for (const target of outgoing.get(id)) { degree.set(target, degree.get(target) - 1); if (degree.get(target) === 0) ready.push(target) }
  }
  if (count !== ids.length) fail(code, { path: '/edges', reason: 'Containment, prerequisite and route relations must be acyclic. These nodes could not be topologically ordered.', unresolvedNodeIds: ids.filter(id => degree.get(id) > 0), unresolvedEdges: pairs.filter(([a, b]) => degree.get(a) > 0 && degree.get(b) > 0) })
}
export function evidenceRefs(value = []) {
  if (!Array.isArray(value)) fail('INVALID_EVIDENCE_LIST')
  const used = new Set()
  return value.map(ref => {
    object(ref, ['kind', 'ref', 'sha256'], 'evidence reference')
    if (!['session_event', 'tool_result', 'artifact'].includes(ref.kind)) fail('INVALID_EVIDENCE_KIND')
    const result = { kind: ref.kind, ref: text(ref.ref, 'ref') }
    if (ref.sha256 !== undefined) {
      if (typeof ref.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(ref.sha256)) fail('INVALID_EVIDENCE_SHA')
      result.sha256 = ref.sha256
    }
    const key = canonical(result)
    if (used.has(key)) fail('DUPLICATE_EVIDENCE')
    used.add(key)
    return result
  })
}

// Count expanded layers in a validated plan. An unexpanded root has depth zero.
export function expansionDepth(plan) {
  const children = new Map()
  for (const node of plan.nodes) {
    if (!children.has(node.parent)) children.set(node.parent, [])
    children.get(node.parent).push(node)
  }
  const queue = (children.get(null) ?? []).map(node => [node, 0])
  let result = 0
  for (let i = 0; i < queue.length; i++) {
    const [node, depth] = queue[i]
    if (node.kind !== 'container') continue
    result = Math.max(result, depth + 1)
    for (const child of children.get(node.id) ?? []) queue.push([child, depth + 1])
  }
  return result
}

export function unitDefinition(node) {
  if (node?.kind !== 'unit') {
    if (node?.mode !== undefined) fail('INVALID_UNIT_MODE')
    return node
  }
  const { mode = node.terminal === undefined ? 'direct' : 'planned', ...fields } = node
  if (!['direct', 'planned'].includes(mode)) fail('INVALID_UNIT_MODE')
  return { ...fields, kind: mode === 'direct' ? 'leaf' : 'container' }
}

// A newly issued blueprint uses the same unit vocabulary as the persisted snapshot.
export function storedUnitPlan(plan) {
  if (plan.hierarchy?.version !== 2) return plan
  const { maxGroupDepth, ...policy } = plan.hierarchy
  const nodes = plan.nodes.map(node => ({ ...node, kind: 'unit', mode: node.kind === 'container' ? 'planned' : 'direct' }))
  return { ...plan, nodes, hierarchy: { ...policy, maxDepth: maxGroupDepth } }
}

export function replayUnitPlan(plan) {
  if (plan?.hierarchy?.version !== 2 || !own(plan.hierarchy, 'maxDepth')) return plan
  const { maxDepth, ...policy } = plan.hierarchy
  if (own(policy, 'maxGroupDepth') || !Array.isArray(plan.nodes)) fail('INVALID_UNIT_STORAGE')
  const nodes = plan.nodes.map(node => {
    if (node?.kind !== 'unit' || !['direct', 'planned'].includes(node.mode)) fail('INVALID_UNIT_STORAGE')
    return unitDefinition(node)
  })
  return { ...plan, nodes, hierarchy: { ...policy, maxGroupDepth: maxDepth } }
}

// Durable IDs are generated by this program. Input keys are local plan labels.
export function normalizePlan(definition, { workflowLimits, enableSwitch = false, id = prefix => `${prefix}_${randomUUID()}` } = {}) {
  object(definition, ['title', 'nodes', 'edges', 'hierarchy', 'ruleVersion'], '')
  const limits = resolveWorkflowLimits(workflowLimits)
  if (!Array.isArray(definition.nodes) || definition.nodes.length < (definition.hierarchy?.version === 2 ? 1 : 2) || definition.nodes.length > limits.maxUnits) fail('UNIT_LIMIT', { path: '/nodes', reason: 'Count every unit including the root.', minimum: definition.hierarchy?.version === 2 ? 1 : 2, maximum: limits.maxUnits, observed: definition.nodes?.length })
  if (definition.hierarchy?.version === 1 && definition.hierarchy.maxGroupDepth > limits.maxDepth) fail('GROUP_DEPTH_CONFIGURATION')
  if (!Array.isArray(definition.edges)) fail('INVALID_EDGES')
  const keys = new Map(), usedIds = new Set()
  const generated = prefix => {
    const value = id(prefix)
    if (!identifier(value) || usedIds.has(value)) fail('INVALID_GENERATED_ID')
    usedIds.add(value); return value
  }
  const nodes = definition.nodes.map((input, index) => {
    const raw = definition.hierarchy?.version === 2 ? unitDefinition(input) : input
    object(raw, ['key', 'kind', 'label', 'parent', 'switchCases', 'terminal', 'acceptance', 'rules'], 'nodes.' + index)
    if (!identifier(raw.key) || keys.has(raw.key)) fail('DUPLICATE_OR_INVALID_KEY', { path: '/nodes/' + index + '/key', item: raw.key, reason: 'Node keys must be unique and match ^[a-z][a-z0-9_-]{0,79}$.' })
    if (!['container', 'leaf'].includes(raw.kind)) fail('INVALID_NODE_KIND', { path: '/nodes/' + index + '/kind', reason: definition.hierarchy?.version === 2 ? 'Use kind unit and mode direct or planned.' : 'Node kind must be container or leaf.', observed: raw.kind })
    const cases = raw.switchCases ?? []
    if (!Array.isArray(cases) || (cases.length && (!enableSwitch || raw.kind !== 'leaf'))) fail('INVALID_SWITCH_CASES', { path: '/nodes/' + index + '/switchCases', reason: 'Switch cases require an enabled switch policy, a leaf node and an array.', enableSwitch, kind: raw.kind })
    const switchCases = cases.map((value, index) => text(value, 'nodes.' + index + '.switchCases.' + index))
    if (new Set(switchCases).size !== switchCases.length) fail('DUPLICATE_CASE', { path: '/nodes/' + index + '/switchCases', reason: 'Switch case names must be unique.', observed: switchCases })
    const node = { id: generated('node'), key: raw.key, kind: raw.kind, label: text(raw.label, 'nodes.' + index + '.label'),
      parent: raw.parent ?? null, switchCases, ...(raw.rules === undefined ? {} : { rules:validateRows(raw.rules) }), ...(raw.terminal === undefined ? {} : { terminal: raw.terminal }), ...(raw.acceptance === undefined ? {} : { acceptance: raw.acceptance }) }
    keys.set(raw.key, node); return node
  })
  for (const node of nodes) {
    if (node.parent !== null) {
      if (!keys.has(node.parent)) fail('UNKNOWN_PARENT', { path: '/nodes/' + nodes.indexOf(node) + '/parent', item: node.key, reason: 'Parent key must name a declared container.', observed: node.parent, allowed: [...keys.keys()] })
      node.parent = keys.get(node.parent).id
    }
  }
  for (const node of nodes) if (node.terminal !== undefined) {
    if (!keys.has(node.terminal)) fail(definition.hierarchy?.version === 2 ? 'UNKNOWN_UNIT_TERMINAL' : 'UNKNOWN_GROUP_TERMINAL', { path: '/nodes/' + nodes.indexOf(node) + '/terminal', reason: 'Terminal must name a declared direct child key.' })
    node.terminal = keys.get(node.terminal).id
  }
  const edges = definition.edges.map(raw => {
    object(raw, ['kind', 'from', 'to', 'outcome', 'case'], 'edges.' + definition.edges.indexOf(raw))
    if (!keys.has(raw.from) || !keys.has(raw.to)) fail('UNKNOWN_EDGE_ENDPOINT', { path: '/edges/' + definition.edges.indexOf(raw), reason: 'Both endpoints must name declared node keys.', observed: { from: raw.from, to: raw.to }, allowed: [...keys.keys()] })
    const edge = { id: generated('edge'), kind: raw.kind, from: keys.get(raw.from).id, to: keys.get(raw.to).id }
    if (raw.outcome !== undefined) edge.outcome = raw.outcome
    if (raw.case !== undefined) edge.case = raw.case
    return edge
  })
  if (definition.ruleVersion !== undefined) {
    if (definition.ruleVersion !== 1 || !definition.hierarchy || edges.length) fail('RULE_GRAPH_REQUIRES_HIERARCHY_AND_RULE_EDGES')
    for (const target of nodes) for (const key of new Set((target.rules ?? []).flatMap(row => atoms(row.when)))) {
      if (!keys.has(key)) fail('RULE_UNKNOWN_PREDECESSOR', {path:'/nodes/'+target.key+'/rules',reason:'Unknown predecessor '+key})
      edges.push({id:generated('edge'),kind:'rule',from:keys.get(key).id,to:target.id})
    }
  }
  const plan = { ...(definition.ruleVersion === undefined ? {} : {ruleVersion:definition.ruleVersion}), schema: 1, id: generated('graph'), title: text(definition.title, 'title'), enableSwitch, nodes, edges, ...(definition.hierarchy === undefined ? {} : { hierarchy: { ...copy(definition.hierarchy), maxGroupDepth: definition.hierarchy.version === 2 ? limits.maxDepth : definition.hierarchy.maxGroupDepth ?? limits.maxDepth } }) }
  validatePlan(plan, { maxDepth: limits.maxDepth })
  return plan
}

export function validatePlan(plan, options) {
  object(plan, ['schema', 'id', 'title', 'enableSwitch', 'nodes', 'edges', 'hierarchy', 'ruleVersion'], '')
  if (plan.schema !== 1 || !identifier(plan.id) || typeof plan.enableSwitch !== 'boolean') fail('INVALID_PLAN')
  text(plan.title, 'title')
  if (!Array.isArray(plan.nodes) || plan.nodes.length < (plan.hierarchy?.version === 2 ? 1 : 2)
      || !Array.isArray(plan.edges)) fail('INVALID_GRAPH_STRUCTURE')
  const nodes = new Map(), ids = new Set([plan.id]), keys = new Set()
  for (const node of plan.nodes) {
    object(node, ['id', 'key', 'kind', 'label', 'parent', 'switchCases', 'terminal', 'acceptance', 'rules'], 'nodes.' + plan.nodes.indexOf(node))
    if (!identifier(node.id) || ids.has(node.id) || !identifier(node.key) || keys.has(node.key)
        || !['container', 'leaf'].includes(node.kind)) fail('INVALID_NODE')
    text(node.label, 'nodes.' + plan.nodes.indexOf(node) + '.label'); ids.add(node.id); keys.add(node.key); nodes.set(node.id, node)
    if (!Array.isArray(node.switchCases)
        || (node.switchCases.length && (!plan.enableSwitch || node.kind !== 'leaf'))
        || new Set(node.switchCases).size !== node.switchCases.length) fail('INVALID_SWITCH')
    for (const [index, label] of node.switchCases.entries()) text(label, 'nodes.' + plan.nodes.indexOf(node) + '.switchCases.' + index)
  }
  const roots = plan.nodes.filter(node => node.parent === null)
  if (roots.length !== 1 || (plan.hierarchy?.version !== 2 && roots[0].kind !== 'container')) fail(plan.hierarchy?.version === 2 ? 'ONE_ROOT_UNIT_REQUIRED' : 'ONE_ROOT_CONTAINER_REQUIRED', { path: '/nodes', reason: plan.hierarchy?.version === 2 ? 'Exactly one unit must have no parent.' : 'Exactly one node must have no parent, and that root must be a container.', roots: roots.map(node => ({ key: node.key, kind: node.kind })) })
  const containment = [], semantic = []
  for (const node of plan.nodes) {
    if (node.parent === null) continue
    if (!nodes.has(node.parent) || nodes.get(node.parent).kind !== 'container' || node.parent === node.id) fail('INVALID_CONTAINMENT', { path: '/nodes/' + plan.nodes.indexOf(node) + '/parent', item: node.key, reason: 'A child must name a different existing, expanded parent.', parentId: node.parent })
    containment.push([node.parent, node.id]); semantic.push([node.id, node.parent])
  }
  noCycles([...nodes.keys()], containment, 'CONTAINMENT_CYCLE')
  for (const node of plan.nodes) {
    let cursor = node, depth = 0
    while (options?.maxDepth !== undefined && !isHierarchical(plan) && cursor.parent !== null) { cursor = nodes.get(cursor.parent); if (++depth > options.maxDepth) fail('DEPTH_LIMIT', { path: '/nodes/' + plan.nodes.indexOf(node) + '/parent', item: node.key, reason: 'Containment depth exceeds the allowed maximum.', maximum: options.maxDepth, observed: depth }) }
    if (node.kind === 'container' && !plan.nodes.some(child => child.parent === node.id)) fail('EMPTY_CONTAINER', { path: '/nodes/' + plan.nodes.indexOf(node), item: node.key, reason: 'Every container must contain at least one child.' })
  }
  const duplicate = new Set(), routes = new Set()
  for (const edge of plan.edges) {
    object(edge, ['id', 'kind', 'from', 'to', 'outcome', 'case'], 'edges.' + plan.edges.indexOf(edge))
    if (!identifier(edge.id) || ids.has(edge.id) || !nodes.has(edge.from) || !nodes.has(edge.to) || edge.from === edge.to) fail('INVALID_EDGE', { path: '/edges/' + plan.edges.indexOf(edge), reason: 'Edge identity must be unique; endpoints must exist and differ.', edge: { kind: edge.kind, from: nodes.get(edge.from)?.key ?? edge.from, to: nodes.get(edge.to)?.key ?? edge.to, outcome: edge.outcome, case: edge.case } })
    ids.add(edge.id)
    const from = nodes.get(edge.from), to = nodes.get(edge.to)
    if (!(plan.ruleVersion === 1 ? ['rule'] : ['prerequisite', 'route', 'case']).includes(edge.kind) || to.kind !== 'leaf' && !isHierarchical(plan)) fail('ILLEGAL_EDGE_KIND_OR_TARGET', { path: '/edges/' + plan.edges.indexOf(edge), reason: 'Use prerequisite, route or case; the target must be a leaf.', edge: { kind: edge.kind, from: nodes.get(edge.from)?.key ?? edge.from, to: nodes.get(edge.to)?.key ?? edge.to, outcome: edge.outcome, case: edge.case } })
    if (edge.kind === 'prerequisite' || edge.kind === 'rule') {
      if (edge.outcome !== undefined || edge.case !== undefined) fail('PREREQUISITE_HAS_CONDITION', { path: '/edges/' + plan.edges.indexOf(edge), reason: 'A prerequisite cannot contain outcome or case conditions.', edge: { kind: edge.kind, from: nodes.get(edge.from)?.key ?? edge.from, to: nodes.get(edge.to)?.key ?? edge.to, outcome: edge.outcome, case: edge.case } })
    } else {
      const groupRoute = isHierarchical(plan) && from.kind === 'container' && edge.kind === 'route'
      if (!groupRoute && from.kind !== 'leaf') fail('ROUTE_SOURCE_MUST_BE_LEAF', { path: '/edges/' + plan.edges.indexOf(edge), reason: 'Conditional routes must originate at a leaf.', edge: { kind: edge.kind, from: nodes.get(edge.from)?.key ?? edge.from, to: nodes.get(edge.to)?.key ?? edge.to, outcome: edge.outcome, case: edge.case } })
      if (edge.kind === 'route') {
        if (!(groupRoute ? ['complete','blocked'] : ['complete','incomplete']).includes(edge.outcome) || edge.case !== undefined
            || (edge.outcome === 'complete' && from.switchCases.length)) fail('INVALID_ROUTE', { path: '/edges/' + plan.edges.indexOf(edge), reason: 'A route needs complete or incomplete, no case, and cannot use complete from a switch leaf.', edge: { kind: edge.kind, from: nodes.get(edge.from)?.key ?? edge.from, to: nodes.get(edge.to)?.key ?? edge.to, outcome: edge.outcome, case: edge.case } })
      } else if (!plan.enableSwitch || !from.switchCases.includes(edge.case) || edge.outcome !== undefined) fail('INVALID_CASE_ROUTE', { path: '/edges/' + plan.edges.indexOf(edge), reason: 'A case route requires enabled switches, a declared source case and no outcome field.', edge: { kind: edge.kind, from: nodes.get(edge.from)?.key ?? edge.from, to: nodes.get(edge.to)?.key ?? edge.to, outcome: edge.outcome, case: edge.case } })
      const routeKey = `${edge.from}:${edge.kind}:${edge.outcome ?? edge.case}`
      if (routes.has(routeKey)) fail('MULTIPLE_TARGETS_FOR_ONE_ROUTE', { path: '/edges/' + plan.edges.indexOf(edge), reason: 'Each source and route condition may have only one target.', edge: { kind: edge.kind, from: nodes.get(edge.from)?.key ?? edge.from, to: nodes.get(edge.to)?.key ?? edge.to, outcome: edge.outcome, case: edge.case } })
      routes.add(routeKey)
    }
    const signature = canonical({ kind: edge.kind, from: edge.from, to: edge.to, outcome: edge.outcome ?? null, case: edge.case ?? null })
    if (duplicate.has(signature)) fail('DUPLICATE_EDGE', { path: '/edges/' + plan.edges.indexOf(edge), reason: 'The same edge relation is declared more than once.', edge: { kind: edge.kind, from: nodes.get(edge.from)?.key ?? edge.from, to: nodes.get(edge.to)?.key ?? edge.to, outcome: edge.outcome, case: edge.case } })
    duplicate.add(signature); semantic.push([edge.from, edge.to])
  }
  validateHierarchy(plan, options)
  noCycles([...nodes.keys()], semantic, 'PREREQUISITE_ROUTE_OR_COMPLETION_CYCLE')
  for (const route of plan.edges.filter(edge => edge.kind === 'route' && edge.outcome === 'incomplete')) {
    if (plan.edges.some(edge => edge.kind === 'prerequisite' && edge.from === route.from && edge.to === route.to)) fail('INCOMPLETE_ROUTE_REQUIRES_SAME_COMPLETE_SOURCE')
  }
  if (plan.ruleVersion !== undefined) {
    if (plan.ruleVersion !== 1 || !isHierarchical(plan)) fail('RULE_PROTOCOL_INVALID')
    for (const n of plan.nodes) {
      const rules = validateRows(n.rules ?? [])
      inspectRules(rules)
      const sources = [...new Set(rules.flatMap(row => atoms(row.when)))].sort()
      const edges = plan.edges.filter(e=>e.to===n.id).map(e=>nodes.get(e.from).key).sort()
      if (canonical(sources)!==canonical(edges)) fail('RULE_EDGE_MISMATCH')
    }
    graphWitnesses(plan)
  } else if (plan.nodes.some(n=>n.rules!==undefined)) fail('RULE_VERSION_REQUIRED')
  return true
}

function graphProgress(state) {
  const { plan, leaves } = state
  const nodes = new Map(plan.nodes.map(node => [node.id, node]))
  const children = new Map(plan.nodes.map(node => [node.id, []]))
  const prerequisites = new Map(plan.nodes.map(node => [node.id, []]))
  const routeSources = new Map(plan.nodes.map(node => [node.id, []]))
  const incompleteTargets = new Map()
  for (const node of plan.nodes) {
    if (node.parent !== null) children.get(node.parent).push(node)
  }
  for (const edge of plan.edges) {
    if (edge.kind === 'prerequisite') {
      prerequisites.get(edge.to).push(edge.from)
    } else {
      routeSources.get(edge.to).push(edge.from)
      if (edge.outcome === 'incomplete') incompleteTargets.set(edge.from, edge.to)
    }
  }

  const routing = groupRouting(state)
  const branches = new Map()
  const terminal = new Set(['COMPLETE', 'INCOMPLETE', 'SKIPPED'])
  const priority = ['SELECTED', 'WAITING', 'NOT_SELECTED']
  const mergeBranches = markers => priority.find(marker => markers.includes(marker)) ?? null

  // Containment, prerequisites and routes were validated together as a DAG.
  // Keep these markers derived so recorded outcomes and checksums stay intact.
  function branchState(id) {
    if (routing) return routing.branch(id)
    if (branches.has(id)) return branches.get(id)
    const node = nodes.get(id)
    let marker
    if (node.kind === 'container') {
      const markers = children.get(id).map(child => branchState(child.id))
      marker = markers.every(Boolean) ? mergeBranches(markers) : null
    } else if (routeSources.get(id).length) {
      if (leaves[id].status !== 'INACTIVE') {
        marker = 'SELECTED'
      } else {
        const stillOpen = routeSources.get(id).some(source =>
          !terminal.has(leaves[source].status) && branchState(source) !== 'NOT_SELECTED')
        marker = stillOpen ? 'WAITING' : 'NOT_SELECTED'
      }
    } else {
      // A continuation with both selected and excluded prerequisites remains
      // required. Its original prerequisite checks still decide eligibility.
      marker = mergeBranches(prerequisites.get(id).map(branchState))
    }
    branches.set(id, marker)
    return marker
  }

  function descendantLeaves(node) {
    return node.kind === 'leaf' ? [node] : children.get(node.id).flatMap(descendantLeaves)
  }
  function complete(id) {
    const node = nodes.get(id)
    if (isHierarchical(plan)) return hierarchyComplete(state, id)
    if (node.kind === 'leaf') return leaves[id].status === 'COMPLETE'
    const required = new Set(descendantLeaves(node).filter(leaf => branchState(leaf.id) !== 'NOT_SELECTED').map(leaf => leaf.id))
    // A failed decision can be handled by its chosen continuation in this
    // container. That continuation must itself complete or handle its outcome.
    return required.size > 0 && [...required].every(leaf =>
      leaves[leaf].status === 'COMPLETE' ||
      (leaves[leaf].status === 'INCOMPLETE' && required.has(incompleteTargets.get(leaf))))
  }
  return {
    branchState, complete, children,
    unmetPrerequisites: id => routing ? routing.unmet(id) : prerequisites.get(id).filter(source => !complete(source)),
    pending: plan.nodes.filter(node =>
      leaves[node.id]?.status === 'PENDING' && branchState(node.id) !== 'NOT_SELECTED'),
  }
}

export function legalNext(state, progress, options) {
  if (!state || state.active || state.suspended) return []
  if (isHierarchical(state.plan)) return hierarchyReady(state, options)
  const { pending, unmetPrerequisites } = progress ?? graphProgress(state)
  return pending.filter(node => unmetPrerequisites(node.id).length === 0)
}
function matchesRoute(edge, outcome, selectedCase) {
  return (edge.kind === 'route' && edge.outcome === outcome)
    || (edge.kind === 'case' && outcome === 'complete' && edge.case === selectedCase)
}
function activate(state, source, outcome, selectedCase) {
  for (const edge of state.plan.edges) {
    if (edge.from !== source) continue
    if (matchesRoute(edge, outcome, selectedCase) && state.leaves[edge.to].status === 'INACTIVE')
      state.leaves[edge.to].status = 'PENDING'
  }
}
function finishLeaf(state, data) {
  const active = state.active
  if (!active || data.nodeId !== active.nodeId || data.attemptId !== active.attemptId || data.owner !== active.owner) fail('ACTIVE_ATTEMPT_MISMATCH')
  if (!['complete', 'incomplete'].includes(data.outcome)) fail('INVALID_OUTCOME')
  const node = state.plan.nodes.find(node => node.id === active.nodeId)
  if (data.outcome === 'complete' && node.switchCases.length) {
    if (!node.switchCases.includes(data.selectedCase)) fail('EXPLICIT_SWITCH_CASE_REQUIRED')
  } else if (data.selectedCase !== null) fail('UNEXPECTED_SWITCH_CASE')
  if (state.plan.ruleVersion && data.outcome === 'incomplete' && data.disposition !== 'FAILED') fail('RULE_AGENT_BINARY_OUTCOME_REQUIRED')
  const refs = evidenceRefs(data.evidence)
  if (state.plan.ruleVersion && data.disposition === 'FAILED' && !refs.length) fail('RULE_FAILED_EVIDENCE_REQUIRED')
  if (data.outcome === 'complete' && !refs.length) fail('COMPLETE_REQUIRES_TRACEABLE_REFERENCE')
  const disposition = data.disposition ?? (data.outcome === 'complete' ? 'COMPLETED' : 'UNSATISFIED')
  if (data.outcome === 'complete' ? disposition !== 'COMPLETED' : !['SKIPPED_NOT_RUN', 'UNSATISFIED', 'FAILED'].includes(disposition)) fail('INVALID_FINISH_DISPOSITION')
  text(data.note, 'finish note')
  state.leaves[active.nodeId] = { status: data.outcome === 'complete' ? 'COMPLETE' : 'INCOMPLETE',
    attemptId: active.attemptId, evidence: refs, note: data.note, disposition, acceptance: 'UNVERIFIED_REFERENCE' }
  state.active = null
  activate(state, active.nodeId, data.outcome, data.selectedCase)
  hierarchyAfterUnitExecution(state, active.nodeId)
}

/** Normalize a new plan while retaining durable identities and all started work. */
export function revisedPlan(document, definition, { id, rootGoalAuthority, workflowLimits } = {}) {
  validateDocument(document)
  const previous = document.state.plan, plan = normalizePlan(definition, { workflowLimits, enableSwitch: previous.enableSwitch, ...(id ? { id } : {}) })
  const old = new Map(previous.nodes.map(node => [node.key, node]))
  const historical = new Set(document.events.flatMap(event => event.data.plan?.nodes.map(node => node.key) ?? []))
  for (const node of plan.nodes) if (!old.has(node.key) && historical.has(node.key)) fail('RETIRED_TASK_KEY_REUSE')
  const ids = new Map(plan.nodes.map(node => [node.id, old.get(node.key)?.id ?? node.id]))
  plan.id = previous.id
  plan.nodes = plan.nodes.map(node => ({ ...node, id: ids.get(node.id), parent: ids.get(node.parent) ?? null, ...(node.terminal ? { terminal: ids.get(node.terminal) } : {}) }))
  plan.edges = plan.edges.map(edge => {
    const result = { ...edge, from: ids.get(edge.from), to: ids.get(edge.to) }
    const match = previous.edges.find(row => canonical({ ...row, id: null }) === canonical({ ...result, id: null }))
    return match ? copy(match) : result
  })
  validateRevisionTransition(document.state, plan, rootGoalAuthority)
  return plan
}
export function validateRevisionTransition(state, plan, rootGoalAuthority, options) {
  if (state.active) fail('REVISION_REQUIRES_NO_ACTIVE_ATTEMPT')
  validatePlan(plan, options)
  if (state.plan.ruleVersion !== plan.ruleVersion) fail('RULE_PROTOCOL_IMMUTABLE')
  if (!(state.plan.hierarchy?.version === 2 && plan.hierarchy?.version === 2) && canonical(state.plan.hierarchy) !== canonical(plan.hierarchy)) fail('HIERARCHY_POLICY_IMMUTABLE')
  if (state.plan.id !== plan.id || state.plan.enableSwitch !== plan.enableSwitch) fail('REVISION_GRAPH_IDENTITY_CHANGED')
  if (!isHierarchical(plan) && canonical(state.plan.edges.filter(edge => edge.kind !== 'prerequisite')) !== canonical(plan.edges.filter(edge => edge.kind !== 'prerequisite')))
    fail('REVISION_BRANCH_POLICY_IMMUTABLE')
  const next = new Map(plan.nodes.map(node => [node.id, node]))
  for (const node of state.plan.nodes) {
    const leaf = state.leaves[node.id]
    const replacement = next.get(node.id)
    const expanding = plan.hierarchy?.version === 2 && node.kind === 'leaf' && replacement?.kind === 'container'
      && leaf?.status === 'PENDING' && !leaf.attemptId && !leaf.reopenedFrom && node.parent === replacement.parent
      && canonical(node.rules ?? []) === canonical(replacement.rules ?? [])
    const newRoot = node.parent === null && replacement
    const changedGoal = newRoot && !expanding && newRoot.acceptance !== node.acceptance
    if (changedGoal && (!isHierarchical(plan) || rootGoalAuthority?.scopeId !== node.id
        || rootGoalAuthority.before !== digest(node.acceptance) || rootGoalAuthority.after !== digest(newRoot.acceptance)
        || !rootGoalAuthority.messageId || !/^[a-f0-9]{64}$/.test(rootGoalAuthority.messageSha256 ?? '')))
      fail('REVISION_ROOT_IMMUTABLE')
    if (node.parent === null && (!next.has(node.id)
        || canonical(Object.fromEntries(Object.entries({ ...newRoot, label: node.label, ...(isHierarchical(plan) ? { terminal: node.terminal } : {}),
          ...(expanding ? { kind: node.kind, acceptance: node.acceptance } : {}), ...(changedGoal ? { acceptance: node.acceptance } : {}) }).filter(([, value]) => value !== undefined))) !== canonical(node))) fail('REVISION_ROOT_IMMUTABLE')
    if (plan.ruleVersion && node.kind === 'container' && next.has(node.id)
        && canonical(node.rules ?? []) !== canonical(next.get(node.id).rules ?? [])) {
      const started = state.hierarchy.groups[node.id] || descendantsOf(state.plan, node.id)
        .some(child => state.leaves[child.id]?.attemptId || state.leaves[child.id]?.reopenedFrom)
      if (started) fail('STARTED_GROUP_RULES_IMMUTABLE')
    }
    if (leaf && (!['PENDING', 'INACTIVE'].includes(leaf.status) || leaf.reopenedFrom)) {
      if (canonical(next.get(node.id)) !== canonical(node)) fail('STARTED_TASK_IMMUTABLE')
      const incoming = p => p.edges.filter(edge => edge.to === node.id)
      if (canonical(incoming(state.plan)) !== canonical(incoming(plan))) fail('STARTED_TASK_PREREQUISITES_IMMUTABLE')
    }
    if (next.has(node.id) && (next.get(node.id).key !== node.key || (!expanding && next.get(node.id).kind !== node.kind))) fail('REVISION_TASK_IDENTITY_CHANGED')
  }
}
function reviseState(state, data, options) {
  object(data, ['plan', 'review', 'terminalPolicy', 'recordedAt'], 'revision event')
  validateRevisionTransition(state, data.plan, data.review?.proposal?.rootGoalAuthority, options)
  const review = data.review
  if (!review || review.verdict !== 'APPROVE' || review.baseRevision !== state.revision
      || review.planChecksum !== digest(data.plan) || !/^[a-f0-9]{64}$/.test(review.proposalHash ?? '')
      || typeof review.updaterRunId !== 'string' || typeof review.reviewerRunId !== 'string'
      || !review.updaterRunId || !review.reviewerRunId || review.updaterRunId === review.reviewerRunId) fail('INDEPENDENT_REVISION_REVIEW_REQUIRED')
  applyRevisionPlan(state, data.plan)
}
function applyRevisionPlan(state, plan) {
  const incoming = new Set(isHierarchical(plan) ? [] : plan.edges.filter(edge => edge.kind !== 'prerequisite').map(edge => edge.to))
  state.leaves = Object.fromEntries(plan.nodes.filter(node => node.kind === 'leaf').map(node => [node.id,
    state.leaves[node.id] ?? { status: incoming.has(node.id) ? 'INACTIVE' : 'PENDING', evidence: [], acceptance: 'UNVERIFIED_REFERENCE' }]))
  const previousPlan = state.plan
  state.plan = copy(plan)
  hierarchyAfterRevision(state, previousPlan)
  // A newly added predeclared route may originate in an already finished leaf.
  for (const [id, leaf] of Object.entries(state.leaves)) {
    if (leaf.status === 'COMPLETE' || leaf.status === 'INCOMPLETE') activate(state, id,
      leaf.status === 'COMPLETE' ? 'complete' : 'incomplete', leaf.selectedCase ?? null)
  }
}

/** Read-only scheduling forecast for an already validated proposed plan or the unchanged graph. */
export function revisionOutlook(state, proposedPlan) {
  if (state.active || state.suspended) return { status: state.active ? 'ACTIVE' : 'SUSPENDED' }
  let projected = state
  if (proposedPlan) {
    projected = { ...state, leaves: copy(state.leaves), ...(state.hierarchy ? { hierarchy: copy(state.hierarchy) } : {}) }
    applyRevisionPlan(projected, proposedPlan)
  } else if (state.hierarchy?.pending?.kind === 'PLAN_REVIEW') {
    projected = { ...state, hierarchy: { ...state.hierarchy, pending: null } }
  }
  const root = projected.plan.nodes.find(node => node.parent === null)
  const progress = graphProgress(projected)
  if (progress.complete(root.id)) return { status: 'COMPLETE' }
  if (projected.hierarchy?.pending) return { status: 'REVIEW', scopeId: projected.hierarchy.pending.scopeId }
  const planIssue = terminalDependencyIssue(projected.plan)
  if (planIssue) return { status: 'NO_READY_LEAF', blockedEdges: [], planIssue }
  const next = legalNext(projected, progress, { planIssue: null })
  if (next.length) return { status: 'READY', tasks: next.map(node => node.id) }
  const nodes = new Map(projected.plan.nodes.map(node => [node.id, node]))
  const blockedEdges = projected.plan.edges.filter(edge => {
    if (edge.kind !== 'prerequisite' || !['INCOMPLETE', 'SKIPPED'].includes(projected.leaves[edge.from]?.status)
        || projected.leaves[edge.to]?.status !== 'PENDING') return false
    const target = nodes.get(edge.to)
    return isHierarchical(projected.plan)
      ? !ancestorsOf(projected.plan, target.id).some(group => hierarchyComplete(projected, group.id))
        && !hierarchyPrerequisiteSatisfied(projected, nodes.get(target.parent), target, nodes.get(edge.from))
      : progress.branchState(target.id) !== 'NOT_SELECTED' && progress.unmetPrerequisites(target.id).includes(edge.from)
  }).map(({ from, to }) => ({ from, to }))
  return { status: 'NO_READY_LEAF', blockedEdges }
}

/** Generic, opt-in rework port. Previous events and attempts remain immutable. */
export function reworkClosure(state, nodeIds) {
  if (!state || state.active || state.suspended) fail('REWORK_REQUIRES_QUIESCENT_GRAPH')
  if (state.plan.enableSwitch || !isHierarchical(state.plan) && state.plan.edges.some(edge => edge.kind !== 'prerequisite')) fail('REWORK_ROUTE_GRAPH_UNSUPPORTED')
  const closedGroup = id => state.plan.hierarchy?.version === 2 && ['PASS', 'FAILED'].includes(state.hierarchy.groups[id]?.outcome)
  if (!Array.isArray(nodeIds) || !nodeIds.length || new Set(nodeIds).size !== nodeIds.length
      || nodeIds.some(id => !closedGroup(id) && !['COMPLETE', 'INCOMPLETE'].includes(state.leaves[id]?.status))) fail('REWORK_TERMINAL_TARGET_REQUIRED')
  const affected = new Set(nodeIds)
  for (const id of nodeIds.filter(closedGroup)) for (const child of descendantsOf(state.plan, id)) affected.add(child.id)
  let changed = true
  while (changed) {
    changed = false
    if (isHierarchical(state.plan)) {
      for (const id of [...affected]) for (const ancestor of ancestorsOf(state.plan, id)) if (!affected.has(ancestor.id)) { affected.add(ancestor.id); changed = true }
    }
    for (const edge of state.plan.edges) if (affected.has(edge.from) && !affected.has(edge.to)) {
      affected.add(edge.to); changed = true
      if (isHierarchical(state.plan) && state.plan.nodes.find(node => node.id === edge.to).kind === 'container')
        descendantsOf(state.plan, edge.to).forEach(node => affected.add(node.id))
    }
  }
  return [...affected].filter(id => ['COMPLETE', 'INCOMPLETE'].includes(state.leaves[id]?.status)).sort()
}
function reopenState(state, data) {
  object(data, ['nodeIds', 'attempts', 'decisionId', 'evidence', 'note'], 'rework event')
  const closure = reworkClosure(state, data.nodeIds)
  const attempts = closure.map(nodeId => ({ nodeId, attemptId: state.leaves[nodeId].attemptId }))
  if (canonical(data.attempts) !== canonical(attempts) || !identifier(data.decisionId)) fail('REWORK_ATTEMPT_SET_MISMATCH')
  if (!evidenceRefs(data.evidence).length) fail('REWORK_EVIDENCE_REQUIRED')
  text(data.note, 'rework note')
  for (const id of closure) state.leaves[id] = { status: 'PENDING', reopenedFrom: state.leaves[id].attemptId,
    evidence: [], acceptance: 'UNVERIFIED_REFERENCE' }
  invalidateHierarchy(state, closure)
}

/** Generic serial hold: no finish event, outcome or acceptance is fabricated. */
function suspendState(state, data) {
  object(data, ['active', 'evidence', 'note', 'metadata'], 'suspend event')
  if (!state.active || state.suspended || canonical(data.active) !== canonical(state.active)) fail('SUSPENSION_ACTIVE_MISMATCH')
  if (!evidenceRefs(data.evidence).length) fail('SUSPENSION_EVIDENCE_REQUIRED')
  text(data.note, 'suspension note')
  const node = state.plan.nodes.find(row => row.id === state.active.nodeId)
  state.suspended = { ...copy(data), leaf: copy(state.leaves[node.id]), node: copy(node), incoming: copy(state.plan.edges.filter(row => row.to === node.id)) }
  state.leaves[node.id] = { status: 'PENDING', evidence: [], acceptance: 'UNVERIFIED_REFERENCE' }
  state.active = null
}
function resolveSuspension(state, data, terminalLast) {
  object(data, ['attemptId', 'mode'], 'suspension resolution')
  const held = state.suspended
  if (!held || state.active || data.attemptId !== held.active.attemptId || !['resume', 'supersede'].includes(data.mode)) fail('SUSPENSION_RESOLUTION_INVALID')
  if (data.mode === 'resume') {
    const node = state.plan.nodes.find(row => row.id === held.active.nodeId)
    if (canonical(node) !== canonical(held.node) || canonical(state.plan.edges.filter(row => row.to === held.node.id)) !== canonical(held.incoming)) fail('SUSPENSION_CONTRACT_CHANGED')
    const candidate = { ...state }; delete candidate.suspended
    const deferredTerminals = new Set()
    const choices = legalNext(candidate, undefined, { terminalLast, deferredTerminals, planIssue: null })
    // The held attempt already owns the serial slot. Only a fresh dispatch has to yield on priority.
    if (!choices.some(row => row.id === node.id) && !deferredTerminals.has(node.id)) fail('SUSPENSION_RESUME_NOT_READY')
    state.active = copy(held.active); state.leaves[node.id] = copy(held.leaf)
  }
  delete state.suspended
}
// Deterministic replay is authoritative; snapshots are checked against it.
function replayLedger(events) {
  if (!Array.isArray(events) || !events.length) fail('INVALID_EVENT_LEDGER')
  let state = null, previous = null, unitOrder = null
  // Unmarked historical attempts, including their resumptions, used declaration order.
  let terminalLast = false
  // Validate immutable blueprints against the contract in force when each was committed.
  let terminalSink = false
  const operations = new Set(), eventIds = new Set()
  for (const event of events) {
    object(event, ['id', 'seq', 'operationId', 'type', 'data', 'previousHash', 'hash'], 'event')
    const body = { ...event }; delete body.hash
    if (!identifier(event.id) || eventIds.has(event.id) || !identifier(event.operationId) || operations.has(event.operationId)
        || event.seq !== operations.size + 1 || event.previousHash !== previous || digest(body) !== event.hash) fail('EVENT_CHAIN_OR_REPLAY')
    operations.add(event.operationId); eventIds.add(event.id)
    const blueprint = event.type === 'CREATED' || event.type === 'REVISED'
    if (blueprint) {
      const policy = event.data?.terminalPolicy
      if (policy !== undefined || terminalSink) {
        if (policy !== TERMINAL_SINK || !isHierarchical(event.data?.plan)) fail('INVALID_TERMINAL_POLICY')
        terminalSink = true
      }
    }
    if (!state) {
      if (event.type !== 'CREATED') fail('FIRST_EVENT_MUST_CREATE')
      object(event.data, ['plan', 'terminalPolicy', 'recordedAt'], 'created event')
      const plan = copy(replayUnitPlan(event.data.plan))
      validatePlan(plan, { historicalTerminalSources: !terminalSink })
      const incoming = new Set(isHierarchical(plan) ? [] : plan.edges.filter(edge => edge.kind !== 'prerequisite').map(edge => edge.to))
      const leaves = Object.fromEntries(plan.nodes.filter(node => node.kind === 'leaf').map(node => [node.id,
        { status: incoming.has(node.id) ? 'INACTIVE' : 'PENDING', evidence: [], acceptance: 'UNVERIFIED_REFERENCE' }]))
      state = { schema: 1, revision: 0, plan, leaves, active: null, operations: [], ...(isHierarchical(plan) ? { hierarchy: initialHierarchy() } : {}) }
    } else if (event.type === 'REVISED') {
      reviseState(state, { ...event.data, plan: replayUnitPlan(event.data.plan) }, { historicalTerminalSources: !terminalSink })
    } else if (event.type === 'SUSPENDED') {
      suspendState(state, event.data)
    } else if (event.type === 'SUSPENSION_RESOLVED') {
      resolveSuspension(state, event.data, terminalLast)
    } else if (event.type === 'REOPENED') {
      reopenState(state, event.data)
    } else if (event.type === 'SCOPE_REVIEWED') {
      applyScopeGate(state, event.data)
    } else if (event.type === 'BEGUN') {
      object(event.data, ['nodeId', 'attemptId', 'owner', 'selectionPolicy'], 'begin event')
      const { selectionPolicy, ...attempt } = event.data
      if (selectionPolicy !== undefined || terminalLast) {
        if (selectionPolicy !== TERMINAL_LAST || !isHierarchical(state.plan)) fail('BEGIN_SELECTION_POLICY_INVALID')
        terminalLast = true
      }
      if (!legalNext(state, undefined, { terminalLast, planIssue: null }).some(node => node.id === attempt.nodeId)
          || !identifier(attempt.attemptId) || !identifier(attempt.owner)) fail('BEGIN_NOT_LEGAL')
      state.active = copy(attempt)
      state.leaves[event.data.nodeId].status = 'ACTIVE'
    } else if (event.type === 'FINISHED' || event.type === 'RECONCILED') {
      object(event.data, ['nodeId', 'attemptId', 'owner', 'outcome', 'selectedCase', 'evidence', 'note', 'disposition'], 'finish event')
      finishLeaf(state, event.data)
    } else if (event.type === 'SKIPPED') {
      object(event.data, ['nodeId', 'evidence', 'note'], 'skip event')
      if (state.plan.ruleVersion) fail('RULE_AGENT_BINARY_OUTCOME_REQUIRED')
      if (state.active || state.suspended || state.leaves[event.data.nodeId]?.status !== 'PENDING') fail('SKIP_NOT_LEGAL')
      state.leaves[event.data.nodeId] = { status: 'SKIPPED', disposition: 'SKIPPED_NOT_RUN', evidence: evidenceRefs(event.data.evidence),
        note: text(event.data.note, 'skip note'), acceptance: 'UNVERIFIED_REFERENCE' }
      hierarchyAfterUnitExecution(state, event.data.nodeId)
      // A skip never fires a complete/incomplete route and never satisfies a prerequisite.
    } else fail('UNKNOWN_EVENT_TYPE')
    if (blueprint) {
      const { recordedAt } = event.data
      if (recordedAt !== undefined || state.unitOrder) integer(recordedAt, 0, 'recordedAt')
      unitOrder = updateUnitOrder(unitOrder, state.plan, recordedAt)
      // Unstamped historical snapshots must still validate byte-for-byte.
      if (recordedAt !== undefined) state.unitOrder = unitOrder
    }
    state.revision = event.seq; state.operations.push(event.operationId); previous = event.hash
  }
  return { state, unitOrder }
}
export function replay(events) { return replayLedger(events).state }
// Retain a single verified projection per module instance. Even a cache hit
// verifies the document bytes; caller-owned objects never become cache state.
let latestReplay
export function documentOf(events) {
  const journal = copy(events), replayed = replayLedger(journal)
  const document = { schema: 1, revision: replayed.state.revision, state: copy(replayed.state), events: journal }
  const checksum = digest(document)
  latestReplay = { checksum, replayed: copy(replayed) }
  return { ...document, checksum }
}
function validatedReplay(document) {
  object(document, ['schema', 'revision', 'state', 'events', 'checksum'], 'document')
  if (document.schema !== 1) fail('UNSUPPORTED_DOCUMENT_SCHEMA')
  const body = { ...document }; delete body.checksum
  if (digest(body) !== document.checksum) fail('DOCUMENT_CHECKSUM')
  if (latestReplay?.checksum === document.checksum) return latestReplay.replayed
  const replayed = replayLedger(document.events)
  if (document.revision !== replayed.state.revision || canonical(document.state) !== canonical(replayed.state)) fail('SNAPSHOT_REPLAY_MISMATCH')
  latestReplay = { checksum: document.checksum, replayed: copy(replayed) }
  return latestReplay.replayed
}
export function validateDocument(document) {
  validatedReplay(document)
  return true
}
export function view(document, owner) {
  if (!document) return { revision: 0, graph: null, legalNext: [], active: null, goalReached: false }
  const { state, unitOrder } = validatedReplay(document)
  const deferredTerminals = new Set()
  const planIssue = terminalDependencyIssue(state.plan)
  const progress = graphProgress(state), ready = legalNext(state, progress, { deferredTerminals, planIssue })
  const readyIds = new Set(ready.map(node => node.id))
  const decisions = new Set(state.plan.edges.filter(edge => edge.kind === 'route' || edge.kind === 'case').map(edge => edge.from))
  const selectedBranches = new Map()
  for (const event of document.events) {
    if (event.type !== 'FINISHED' && event.type !== 'RECONCILED') continue
    const { nodeId, outcome, selectedCase } = event.data
    if (!decisions.has(nodeId) && selectedCase === null) continue
    const target = state.plan.edges.find(edge => edge.from === nodeId && matchesRoute(edge, outcome, selectedCase))
    selectedBranches.set(nodeId, { outcome, ...(selectedCase === null ? {} : { case: selectedCase }),
      ...(target ? { targetId: target.to } : {}) })
  }
  if (hasGroupRoutes(state.plan)) for (const [groupId, report] of Object.entries(state.hierarchy.groups)) {
    if (!decisions.has(groupId)) continue
    const outcome = report.outcome.toLowerCase()
    const target = state.plan.edges.find(edge => edge.kind === 'route' && edge.from === groupId && edge.outcome === outcome)
    selectedBranches.set(groupId, { outcome, ...(target ? { targetId: target.to } : {}) })
  }
  const ruleState = state.plan.ruleVersion ? runtimeRules(state) : null
  const nodesById = new Map(state.plan.nodes.map(node => [node.id, node]))
  const rows = unitOrder.ids.map(id => {
    const node = nodesById.get(id)
    const branchState = progress.branchState(node.id), selectedBranch = selectedBranches.get(node.id)
    const row = { id: node.id, key: node.key, label: node.label, kind: node.kind, ...(ruleState ? { ruleState:ruleState.outcome(node.id) ?? (state.active?.nodeId===node.id?'ACTIVE':ruleState.entry(node.id)===null?'WAITING':'READY'), rules:copy(node.rules??[]) } : {}), ...(branchState ? { branchState } : {}) }
    if (node.kind === 'leaf') return { ...row, ...copy(state.leaves[node.id]), ...(selectedBranch ? { selectedBranch } : {}) }
    const allChildrenComplete = progress.complete(node.id)
    return { ...row, childCount: progress.children.get(node.id).length, allChildrenComplete,
      status: allChildrenComplete ? 'COMPLETE' : row.ruleState === 'FAILED' ? 'INCOMPLETE' : state.hierarchy?.groups[node.id]?.outcome === 'BLOCKED' ? 'INCOMPLETE' : 'CONTAINER_INCOMPLETE',
      ...(state.hierarchy?.groups[node.id]?.outcome === 'BLOCKED' ? { disposition: 'UNSATISFIED' } : {}),
      ...(selectedBranch ? { selectedBranch } : {}),
      ...(isHierarchical(state.plan) ? { terminal: node.terminal, acceptance: node.acceptance,
        gate: state.hierarchy.pending?.scopeId === node.id ? state.hierarchy.pending.kind : null } : {}) }
  })
  return { revision: state.revision, graph: { id: state.plan.id, title: state.plan.title }, nodes: rows,
    ...(state.suspended ? { suspended: copy(state.suspended) } : {}),
    active: state.active ? { ...copy(state.active), recoveryRequired: state.active.owner !== owner,
      caseChoices: state.plan.nodes.find(node => node.id === state.active.nodeId).switchCases.map((label, choice) => ({ choice, label })) } : null,
    ...(planIssue ? { planIssue } : {}),
    legalNext: ready.map((node, choice) => ({ choice, id: node.id, label: node.label, switchCases: copy(node.switchCases) })),
    pendingButBlocked: progress.pending.filter(node => !readyIds.has(node.id)).map(node => ({ id: node.id,
      reason: planIssue?.code ?? (state.active ? 'ACTIVE_LEAF' : deferredTerminals.has(node.id) ? 'TERMINAL_DEFERRED' : 'UNMET_PREREQUISITE'),
      unmetPrerequisites: progress.unmetPrerequisites(node.id) })),
    skipChoices: state.active || state.suspended || planIssue ? [] : progress.pending
      .map((node, choice) => ({ choice, id: node.id, label: node.label })),
    ...(isHierarchical(state.plan) ? { hierarchy: copy(state.hierarchy), hierarchyPolicy: copy(state.plan.hierarchy) } : {}),
    ...(ruleState ? {rootOutcome:ruleState.outcome(state.plan.nodes.find(n=>!n.parent).id)} : {}),
    goalReached: isHierarchical(state.plan) && hierarchyComplete(state, state.plan.nodes.find(node => node.parent === null).id), evidenceMeaning: 'References are unverified. Transaction completion does not establish Goal completion.' }
}

export class TransactionGraph {
  constructor(store, { workflowLimits, enableSwitch = false, id = prefix => `${prefix}_${randomUUID()}`, verifyRecovery = async () => false } = {}) {
    this.workflowLimits = resolveWorkflowLimits(workflowLimits)
    this.store = store; this.enableSwitch = enableSwitch; this.id = id; this.owner = id('owner'); this.verifyRecovery = verifyRecovery
    if (!identifier(this.owner)) fail('INVALID_OWNER')
  }
  read() { return view(this.store.read(), this.owner) }
  mutate(expectedRevision, operationId, type, makeData) {
    integer(expectedRevision, 0, 'revision')
    if (!identifier(operationId)) fail('INVALID_OPERATION_ID')
    return this.store.compareAndSwap(expectedRevision, previous => {
      if (previous) validateDocument(previous)
      if (previous?.state.operations.includes(operationId)) fail('OPERATION_REPLAY')
      if (previous && previous.state.plan.enableSwitch !== this.enableSwitch) fail('GRAPH_POLICY_CHANGED')
      if (previous && (type === 'BEGUN' || type === 'SKIPPED')) {
        const issue = terminalDependencyIssue(previous.state.plan)
        if (issue) throw new GraphError(issue.code, issue)
      }
      const data = makeData(previous?.state ?? null)
      const blueprint = type === 'CREATED' || type === 'REVISED'
      const event = { id: this.id('event'), seq: expectedRevision + 1, operationId, type,
        data: blueprint ? { ...data, plan: storedUnitPlan(data.plan), recordedAt: Date.now(), ...(isHierarchical(data.plan) ? { terminalPolicy: TERMINAL_SINK } : {}) } : data,
        previousHash: previous?.events.at(-1).hash ?? null }
      event.hash = digest(event)
      return documentOf([...(previous?.events ?? []), event])
    })
  }
  create({ expectedRevision = 0, operationId, definition }) {
    const result = this.mutate(expectedRevision, operationId, 'CREATED', state => {
      if (state) fail('PLAN_IMMUTABLE_CREATE_ONCE')
      return { plan: normalizePlan(definition, { workflowLimits: this.workflowLimits, enableSwitch: this.enableSwitch, id: this.id }) }
    }); return view(result, this.owner)
  }
  revise({ expectedRevision, operationId, plan, review }) {
    const result = this.mutate(expectedRevision, operationId, 'REVISED', state => {
      if (!state) fail('NO_PLAN')
      const maximum = Math.max(state.plan.nodes.length, this.workflowLimits.maxUnits)
      if (plan.nodes.length > maximum) fail('UNIT_LIMIT', { path: '/nodes', observed: plan.nodes.length, maximum })
      const maxDepth = Math.max(this.workflowLimits.maxDepth, expansionDepth(state.plan))
      validateRevisionTransition(state, plan, review?.proposal?.rootGoalAuthority, { maxDepth })
      if (plan.hierarchy && expansionDepth(plan) > maxDepth) fail(plan.hierarchy.version === 2 ? 'UNIT_DEPTH_LIMIT' : 'GROUP_DEPTH_LIMIT')
      return { plan: copy(plan), review: copy(review) }
    }); return view(result, this.owner)
  }
  reviewScope({ expectedRevision, operationId, scopeId, inputHash, runId, kind, report }) {
    const result = this.mutate(expectedRevision, operationId, 'SCOPE_REVIEWED', state => ({ scopeId, inputHash, runId, kind, ...(report ? { report: copy(report) } : {}) }))
    return view(result, this.owner)
  }
  reopen({ expectedRevision, operationId, nodeIds, decisionId, evidence, note }) {
    const result = this.mutate(expectedRevision, operationId, 'REOPENED', state => {
      const attempts = reworkClosure(state, nodeIds).map(nodeId => ({ nodeId, attemptId: state.leaves[nodeId].attemptId }))
      return { nodeIds: [...nodeIds], attempts, decisionId, evidence: evidenceRefs(evidence), note }
    }); return view(result, this.owner)
  }
  suspend({ expectedRevision, operationId, evidence, note, metadata = {} }) {
    return view(this.mutate(expectedRevision, operationId, 'SUSPENDED', state => {
      if (!state?.active || state.active.owner !== this.owner) fail('SUSPENSION_OWNER_MISMATCH')
      return { active: copy(state.active), evidence: evidenceRefs(evidence), note, metadata: copy(metadata) }
    }), this.owner)
  }
  resolveSuspension({ expectedRevision, operationId, attemptId, mode }) {
    return view(this.mutate(expectedRevision, operationId, 'SUSPENSION_RESOLVED', () => ({ attemptId, mode })), this.owner)
  }
  begin({ expectedRevision, operationId, choice }) {
    const result = this.mutate(expectedRevision, operationId, 'BEGUN', state => {
      if (!state) fail('NO_PLAN')
      if (state.active) fail(state.active.owner === this.owner ? 'ONE_ACTIVE_LEAF_ONLY' : 'RECOVERY_REQUIRED')
      integer(choice, 0, 'choice')
      const selected = legalNext(state)[choice]
      if (!selected) fail('NO_SUCH_LEGAL_CHOICE')
      return { nodeId: selected.id, attemptId: this.id('attempt'), owner: this.owner,
        ...(isHierarchical(state.plan) ? { selectionPolicy: TERMINAL_LAST } : {}) }
    }); return view(result, this.owner)
  }
  finish({ expectedRevision, operationId, outcome, caseIndex, evidence = [], note, disposition = outcome === 'complete' ? 'COMPLETED' : 'UNSATISFIED' }) {
    const result = this.mutate(expectedRevision, operationId, 'FINISHED', state => {
      if (!state?.active) fail('NO_ACTIVE_LEAF')
      if (state.active.owner !== this.owner) fail('RECOVERY_REQUIRED')
      const node = state.plan.nodes.find(node => node.id === state.active.nodeId)
      let selectedCase = null
      if (caseIndex !== undefined) { integer(caseIndex, 0, 'caseIndex'); selectedCase = node.switchCases[caseIndex]; if (selectedCase === undefined) fail('NO_SUCH_CASE') }
      return { ...state.active, outcome, selectedCase, disposition, evidence: evidenceRefs(evidence), note: text(note, 'note') }
    }); return view(result, this.owner)
  }
  skip({ expectedRevision, operationId, choice, evidence = [], note }) {
    const result = this.mutate(expectedRevision, operationId, 'SKIPPED', state => {
      if (!state) fail('NO_PLAN')
      if (state.active) fail(state.active.owner === this.owner ? 'ONE_ACTIVE_LEAF_ONLY' : 'RECOVERY_REQUIRED')
      integer(choice, 0, 'choice')
      const selected = graphProgress(state).pending[choice]
      if (!selected) fail('NO_SUCH_SKIP_CHOICE')
      return { nodeId: selected.id, evidence: evidenceRefs(evidence), note: text(note, 'note') }
    }); return view(result, this.owner)
  }
  async reconcile({ expectedRevision, operationId, outcome, caseIndex, evidence = [], note }) {
    const before = this.store.read()
    if (!before) fail('NO_PLAN')
    validateDocument(before)
    if (before.revision !== expectedRevision || !before.state.active) fail('RECOVERY_STALE_OR_NO_ACTIVE')
    if (before.state.active.owner === this.owner) fail('USE_NORMAL_FINISH')
    const node = before.state.plan.nodes.find(node => node.id === before.state.active.nodeId)
    let selectedCase = null
    if (caseIndex !== undefined) { integer(caseIndex, 0, 'caseIndex'); selectedCase = node.switchCases[caseIndex]; if (selectedCase === undefined) fail('NO_SUCH_CASE') }
    const data = { ...copy(before.state.active), outcome, selectedCase, disposition: outcome === 'complete' ? 'COMPLETED' : 'UNSATISFIED', evidence: evidenceRefs(evidence), note: text(note, 'note') }
    // Freeze the exact route/outcome/refs before awaiting the external attestation.
    const accepted = await this.verifyRecovery({ expectedRevision, ...copy(data) })
    if (accepted !== true) fail('HOST_RECOVERY_ATTESTATION_REQUIRED')
    const result = this.mutate(expectedRevision, operationId, 'RECONCILED', state => {
      if (canonical(state.active) !== canonical(before.state.active)) fail('RECOVERY_ACTIVE_CHANGED')
      return copy(data)
    }); return view(result, this.owner)
  }
}
