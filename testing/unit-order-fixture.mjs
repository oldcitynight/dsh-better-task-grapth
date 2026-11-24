// SPDX-License-Identifier: GPL-3.0-only
import { digest, revisedPlan } from '../core.mjs'
import { formatGraphView } from '../host.mjs'

export const group = (key, parent, terminal) => ({ key, parent, terminal, kind: 'container', label: key, acceptance: key })
export const pass = node => ({ node, in: ['PASS'] })
export const leaf = (key, parent, when) => ({ key, parent, kind: 'leaf', label: key, rules: when ? [{ id: 'entry', when }] : [] })
export const blueprint = nodes => ({ title: 'Display order', hierarchy: { version: 1, maxGroupDepth: 3 }, ruleVersion: 1, edges: [], nodes })
export const root = group('root', null, 'end')
export const base = () => blueprint([root, leaf('a', 'root'), leaf('c', 'root', pass('a')), leaf('d', 'root'), leaf('end', 'root')])
export const inserted = () => blueprint([root, leaf('a', 'root'), leaf('c', 'root', pass('b')), leaf('d', 'root'), leaf('end', 'root'), leaf('b', 'root', pass('a'))])

export function commitRevision(graph, definition) {
  const previous = graph.store.read()
  const plan = revisedPlan(previous, definition)
  return graph.revise({ expectedRevision: previous.revision, operationId: 'edit_' + previous.revision, plan,
    review: { verdict: 'APPROVE', baseRevision: previous.revision, planChecksum: digest(plan),
      proposalHash: digest(definition), updaterRunId: 'updater', reviewerRunId: 'reviewer' } })
}
export function screen(graph) {
  return formatGraphView(graph.read(), graph.store.read().state.plan)
}
