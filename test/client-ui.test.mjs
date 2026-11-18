import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { z } from 'zod'
import { createRemoteContribution } from '../remote.mjs'
import { branchLayout, graphPresentation } from '../view-model.mjs'

const graph = {
  revision: 4, title: 'Publish', active: { nodeId: 'inspect', recoveryRequired: true }, pending: null,
  nodes: [
    { id: 'group', label: 'Root', kind: 'container', parent: null, status: 'CONTAINER_INCOMPLETE' },
    { id: 'prepare', label: 'Prepare', kind: 'leaf', parent: 'group', status: 'COMPLETE', disposition: 'COMPLETED' },
    { id: 'check-group', label: 'Checks', kind: 'container', parent: 'group', status: 'CONTAINER_INCOMPLETE' },
    { id: 'inspect', label: 'Inspect', kind: 'leaf', parent: 'check-group', status: 'ACTIVE' },
    { id: 'ship', label: 'Ship', kind: 'leaf', parent: 'group', status: 'INACTIVE' },
    { id: 'escalate', label: 'Escalate', kind: 'leaf', parent: 'group', status: 'INCOMPLETE', disposition: 'FAILED' },
    { id: 'optional', label: 'Optional', kind: 'leaf', parent: 'group', status: 'SKIPPED', disposition: 'SKIPPED_NOT_RUN' },
  ],
  edges: [
    { from: 'prepare', to: 'inspect', kind: 'prerequisite' },
    { from: 'inspect', to: 'ship', kind: 'case', case: 'signed' },
    { from: 'inspect', to: 'escalate', kind: 'route', outcome: 'incomplete' },
  ],
  legalNext: [], skipChoices: [],
}

test('the shared RPC admits strict session-scoped status and execution controls and rejects private fields', () => {
  const contribution = createRemoteContribution(z)
  const [endpoint] = contribution.descriptors
  assert.equal(contribution.package, 'dsh-better-task-grapth')
  assert.equal(contribution.descriptors.length, 4)
  const output = contribution.descriptors.find(row => row.method === 'output')
  const body = contribution.descriptors.find(row => row.method === 'outputBody')
  assert.equal(output.parameters.find(row => row.name === 'request').codec.create().safeParse({ sessionId: 's', workflowId: 'w', cursor: 0 }).success, true)
  assert.equal(output.parameters.find(row => row.name === 'request').codec.create().safeParse({ sessionId: 's', workflowId: 'w', cursor: -1 }).success, false)
  assert.equal(body.parameters.find(row => row.name === 'request').codec.create().safeParse({ sessionId: 's', workflowId: 'w', itemId: '../../secret' }).success, false)
  const control = contribution.descriptors[1]
  assert.equal(control.method, 'control')
  assert.equal(control.parameters.find(row => row.name === 'request').codec.create().safeParse({ sessionId: 's', workflowId: 'w', action: 'resume' }).success, true)
  assert.equal(control.parameters.find(row => row.name === 'request').codec.create().safeParse({ sessionId: 's', workflowId: 'w', action: 'reset' }).success, false)
  assert.equal(endpoint.service, 'transactionGraph')
  assert.equal(endpoint.namespace + '/' + endpoint.method, 'transactionGraphView/status')
  assert.equal(endpoint.cancellation.parameter, 'signal')
  assert.equal(endpoint.parameters[0].source, 'lookup')
  assert.equal(endpoint.parameters[0].wire, 'sessionId')
  assert.equal(endpoint.parameters[0].codec.create().parse('session-1'), 'session-1')
  assert.equal(endpoint.parameters[0].codec.create().safeParse({ sessionId: 'session-1', begin: 1 }).success, false)
  const schema = endpoint.result.create()
  assert.equal(schema.safeParse({ sessionId: 'session-1', status: 'ready', graph }).success, true)
  assert.equal(schema.safeParse({ sessionId: 'session-1', status: 'empty', graph: null }).success, true)
  assert.equal(schema.safeParse({ sessionId: 'session-1', status: 'ready', graph: null }).success, false)
  assert.equal(schema.safeParse({ sessionId: 'session-1', status: 'ready',
    graph: { ...graph, nodes: [{ ...graph.nodes[0], evidence: ['/private/file'] }, ...graph.nodes.slice(1)] } }).success, false)
  assert.equal(schema.safeParse({ sessionId: 'session-1', status: 'ready',
    graph: { ...graph, edges: [{ ...graph.edges[0], outcome: 'complete' }] } }).success, false)
})

test('nested groups preserve containment and list the direct entry conditions', () => {
  const view = graphPresentation(graph)
  assert.equal(view.active.id, 'inspect')
  assert.equal(view.selected.id, 'inspect')
  assert.deepEqual(view.children.get('check-group').map(node => node.id), ['inspect'])
  assert.deepEqual(view.conditions.map(node => node.id), ['prepare'])
  assert.deepEqual(view.progress, { total: 5, complete: 1, incomplete: 1, skipped: 1, inactive: 1, excluded: 0, ready: 0 })
})

test('the branch canvas ranks dependencies and distinguishes chosen, excluded and blocked lines', () => {
  const nodes = graph.nodes.map(node => {
    if (node.id === 'ship') return { ...node, branchState: 'NOT_SELECTED' }
    if (node.id === 'inspect') return { ...node, status: 'INCOMPLETE', disposition: 'FAILED',
      selectedBranch: { outcome: 'incomplete', targetId: 'escalate' } }
    if (node.id === 'optional') return { ...node, status: 'PENDING', disposition: undefined, blocked: true }
    return node
  })
  const edges = [...graph.edges,
    { from: 'prepare', to: 'optional', kind: 'prerequisite' },
    { from: 'escalate', to: 'optional', kind: 'prerequisite' }]
  const updated = { ...graph, nodes, edges }
  const layout = branchLayout(updated)
  assert.deepEqual(branchLayout(updated), layout)
  assert.deepEqual(layout.cards.map(card => [card.node.id, card.column]),
    [['prepare', 0], ['inspect', 1], ['ship', 2], ['escalate', 2], ['optional', 3]])
  assert.deepEqual(layout.wires.map(wire => wire.state),
    ['prerequisiteMet', 'branchExcluded', 'branchChosen', 'prerequisiteMet', 'blocked'])
  assert.equal(layout.cards.find(card => card.node.id === 'optional').additionalPrerequisites, 0)
  assert.equal(layout.cards.find(card => card.node.id === 'inspect').group, 'Checks')
  assert.deepEqual(graphPresentation(updated, 'optional').conditions.map(node => [node.id, node.disposition]),
    [['prepare', 'COMPLETED'], ['escalate', 'FAILED']])
  const schema = createRemoteContribution(z).descriptors[0].result.create()
  assert.equal(schema.parse({ sessionId: 'session-1', status: 'ready', graph: updated }).graph.nodes.at(-1).blocked, true)
})

const prerequisite = (from, to) => ({ from, to, kind: 'prerequisite' })

test('a prerequisite already implied by the chain drops out of the map and entry list', () => {
  const chain = [prerequisite('prepare', 'inspect'), prerequisite('inspect', 'escalate'), prerequisite('escalate', 'optional')]
  const edges = [...chain, prerequisite('prepare', 'optional'), prerequisite('inspect', 'optional')]
  const updated = { ...graph, edges }
  const layout = branchLayout(updated)
  assert.deepEqual(layout.wires.map(wire => wire.edge), chain)
  assert.equal(layout.cards.find(card => card.node.id === 'optional').additionalPrerequisites, 0)
  assert.deepEqual(graphPresentation(updated, 'optional').conditions.map(node => node.id), ['escalate'])
  assert.equal(updated.edges.length, 5)
})

test('an intermediate branch gate or a container keeps the explicit prerequisite', () => {
  const gated = { ...graph, edges: [
    prerequisite('prepare', 'inspect'), prerequisite('inspect', 'optional'), prerequisite('prepare', 'optional'),
    { from: 'ship', to: 'inspect', kind: 'case', case: 'enabled' },
  ] }
  assert.deepEqual(graphPresentation(gated, 'optional').conditions.map(node => node.id), ['inspect', 'prepare'])
  const gatedLayout = branchLayout(gated)
  assert.equal(gatedLayout.cards.find(card => card.node.id === 'optional').additionalPrerequisites, 0)
  assert.ok(gatedLayout.wires.some(wire => wire.edge.kind === 'case'))

  const grouped = { ...graph, edges: [
    prerequisite('check-group', 'ship'), prerequisite('ship', 'optional'), prerequisite('check-group', 'optional'),
  ] }
  assert.deepEqual(graphPresentation(grouped, 'optional').conditions.map(node => node.id), ['ship', 'check-group'])
  assert.equal(branchLayout(grouped).cards.find(card => card.node.id === 'optional').additionalPrerequisites, 0)
})

test('branch markers cross the Web RPC and remove unselected work from progress', () => {
  const nodes = graph.nodes.map(node => {
    if (node.id === 'ship') return { ...node, branchState: 'NOT_SELECTED' }
    if (node.id === 'inspect') return { ...node, status: 'INCOMPLETE',
      selectedBranch: { outcome: 'incomplete', targetId: 'escalate' } }
    return node
  })
  const schema = createRemoteContribution(z).descriptors[0].result.create()
  const result = schema.parse({ sessionId: 'session-1', status: 'ready', graph: { ...graph, nodes, active: null } })
  const view = graphPresentation(result.graph)
  assert.equal(view.nodes.get('inspect').selectedBranch.targetId, 'escalate')
  assert.equal(view.nodes.get('ship').branchState, 'NOT_SELECTED')
  assert.equal(view.progress.total, 4)
  assert.equal(view.progress.excluded, 1)
})

test('selection falls back to the Host-ready leaf then the root and never infers readiness from a status', () => {
  const idle = { ...graph, active: null, legalNext: [{ id: 'ship', choice: 0 }] }
  assert.equal(graphPresentation(idle, 'missing').selected.id, 'ship')
  assert.equal(graphPresentation(idle, 'inspect').selected.id, 'inspect')
  const blocked = graphPresentation({ ...idle, pending: { operation: 'begin', qualification: 'UNKNOWN' }, legalNext: [] })
  assert.equal(blocked.selected.id, 'group')
  assert.equal(blocked.legal.size, 0)
})

test('generated bundle registers the graph in the existing session composer dock', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  let plugin
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(row) {
      assert.equal(row.id, 'dsh-better-task-grapth')
      plugin = row.factory(name => ({ react: {}, zod: { z } })[name])
    } } },
  })
  let scope, endpoint, entry
  const callbacks = []
  const ctx = {
    effect(callback) { callbacks.push(callback) },
    locale: { register(namespace, locales) {
      assert.equal(namespace, 'projectTransactionGraph')
      assert.equal(locales.zh.title, '事务图')
      assert.equal(locales.en.title, 'Transaction graph')
    } },
    remote: {
      transactionGraphView: { status() { throw new Error('UI mount must not read before a session renders') } },
      async $mount(contribution) { endpoint = contribution.descriptors[0]; return () => {} },
    },
    inject(deps, callback) {
      scope = [...deps]
      callback(this)
    },
    slots: {
      inject(name, callback) { assert.equal(name, 'conversation.input.dock'); callback() },
      register(spec, component) { entry = spec; assert.equal(typeof component, 'function') },
    },
  }
  await plugin.apply(ctx)
  callbacks[0]()
  assert.deepEqual(scope, ['remote.transactionGraphView'])
  assert.equal(endpoint.namespace, 'transactionGraphView')
  assert.equal(entry.id, 'project-transaction-graph')
  assert.equal(entry.name, 'conversation.input.dock')
})

test('empty polling and quick initial reads stay hidden; slow reads and failures remain visible', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  let result, stateIndex, Dock, plugin, refreshes = 0
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: initial => [stateIndex++ === 0 ? result : initial, () => { refreshes++ }],
    useRef: current => ({ current }), useEffect() {}, useMemo: fn => fn(),
  }
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(row) {
    plugin = row.factory(name => ({ react: React, zod: { z } })[name])
  } } } })
  const ctx = { effect() {}, remote: { transactionGraphView: {}, async $mount() { return () => {} } },
    inject(_deps, callback) { callback(this) }, slots: { inject(_name, callback) { callback() }, register(_spec, component) { Dock = component } } }
  await plugin.apply(ctx)
  const render = (value, access = true, open = true) => {
    result = value; stateIndex = 0
    return Dock({ sessionId: 's', useAccess: () => access,
      useSession: select => select({ openState: open ? 'open' : 'closed', removed: false, running: false }), t: key => key })
  }
  const text = node => typeof node === 'string' ? node : node?.children?.map(text).join(' ') ?? ''
  assert.equal(render(null), null)
  assert.equal(render({ sessionId: 's', graph: null, busy: true, failed: false }), null)
  assert.match(text(render({ sessionId: 's', graph: null, busy: true, failed: false, showLoading: true })), /loading/)
  assert.equal(render({ sessionId: 's', status: 'empty', graph: null, busy: true, failed: false, showLoading: true }), null)
  const failed = render({ sessionId: 's', graph: null, busy: false, failed: true })
  assert.match(text(failed), /unavailable/)
  const retry = failed.children.find(node => node?.type === 'button')
  assert.equal(retry.props.disabled, false); retry.props.onClick(); assert.equal(refreshes, 1)
  assert.equal(render({ sessionId: 's', graph: null, execution: null, busy: false, failed: false }), null)
  assert.equal(render({ sessionId: 'old-session', graph, busy: false, failed: false }), null)
  assert.equal(render({ sessionId: 's', graph, busy: false, failed: true }).type.name, 'GraphPanel')
  assert.equal(render(null, false), null); assert.equal(render(null, true, false), null)
})
