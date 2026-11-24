// SPDX-License-Identifier: GPL-3.0-only
import { z } from 'zod'
import { defineTool as nativeDefineTool } from '@deepseek-ai/dsh-tools'
import { checkedTool } from './validation.mjs'
const defineTool = options => checkedTool(nativeDefineTool, options)
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { createToolDefinitions } from './tools.mjs'
import { DshTransactionHost, formatGraphView } from './host.mjs'
import { projection, KEY } from './projection.mjs'
import { createRemoteContribution } from './remote.mjs'
import { WorkflowRegistry, WORKFLOW_CONTRACT } from './interop.mjs'
import { EXTENSION_CONTRACT, SessionPolicies } from './extensions.mjs'
import { FileGraphStore } from './store.mjs'
import { installGraphCommand } from './commands.mjs'
import Schema from '@deepseek-ai/schemastery'
import { defaultWorkflowLimits, resolveWorkflowLimits } from './workflow-limits.mjs'
import path from 'node:path'
import fs from 'node:fs'

export const name = 'dsh-better-task-grapth'
export const Config = Schema.object({
  projectRoot: Schema.string().volatile(),
  storageRelative: Schema.string().default('.dsh/transaction-graphs-v4').volatile(),
  enableSwitch: Schema.boolean().default(false).volatile(),
  workflowLimits: Schema.object(Object.fromEntries(Object.entries(defaultWorkflowLimits).map(([key, value]) =>
    [key, Schema.number().step(1).min(key === 'maxUnits' ? 1 : 0).default(value)]))).default({}).volatile(),
})
Object.defineProperty(Config, '~standard', { get: () => ({ version: 1, vendor: 'schemastery', validate(input = {}) {
  try {
    if (Object.keys(input).some(key => !Object.hasOwn(Config.dict, key))) throw Error('Invalid transaction graph configuration')
    if (input.workflowLimits !== undefined) resolveWorkflowLimits(input.workflowLimits)
    const fields = Config(input)
    const projectRoot = fields.projectRoot.get(), storageRelative = fields.storageRelative.get()
    if (projectRoot !== undefined && (!path.isAbsolute(projectRoot) || fs.realpathSync(projectRoot) !== path.resolve(projectRoot)
        || !fs.lstatSync(projectRoot).isDirectory())) throw Error('EXPLICIT_REAL_PROJECT_REQUIRED')
    if (!storageRelative || path.isAbsolute(storageRelative) || storageRelative.split(/[\\/]/).some(x => !x || x === '..' || x === '.'))
      throw Error('INVALID_STORAGE_RELATIVE_PATH')
    return { value: { projectRoot, storageRelative, enableSwitch: fields.enableSwitch.get(), workflowLimits: fields.workflowLimits } }
  } catch (error) { return { issues: [{ message: error.message }] } }
} }) })

let bindSessionResource, bindControlResource, bindOutputResource, bindOutputBodyResource
Remote({ resources: { session: ({ sessionId }) => sessionId } })(undefined, {
  kind: 'method', name: 'status', addInitializer: callback => { bindSessionResource = callback },
})
Remote({ resources: { session: ({ sessionId }) => sessionId } })(undefined, {
  kind: 'method', name: 'control', addInitializer: callback => { bindControlResource = callback },
})
Remote({ resources: { session: ({ sessionId }) => sessionId } })(undefined, {
  kind: 'method', name: 'output', addInitializer: callback => { bindOutputResource = callback },
})
Remote({ resources: { session: ({ sessionId }) => sessionId } })(undefined, {
  kind: 'method', name: 'outputBody', addInitializer: callback => { bindOutputBodyResource = callback },
})
const guidance = 'For work the user asks to track in a transaction graph, read the program-generated revision and choices before creating or resuming it. One leaf may be active. Begin must commit before work starts. Pending or UNKNOWN work blocks finish and dependent work. Never replay blindly. Complete requires a qualified successful tool result after begin. Incomplete requires known failure, confirmed non-execution, or an unsatisfied outcome. Wait for the enclosing tool call to finish and read the committed state before continuing. Containers aggregate. Transaction completion does not complete Goal.'

export default class TransactionGraphPlugin extends TypertRemoteService {
  static Config = Config
  static inject = ['agents', 'sessions', 'sessionProjections', 'sessionPersistence', 'workingDirectory', 'tools', 'systemPrompt']
  constructor(ctx, config = {}) {
    super(ctx, 'transactionGraph', { namespace: 'transactionGraphView' })
    bindSessionResource.call(this)
    bindControlResource.call(this)
    bindOutputResource.call(this)
    bindOutputBodyResource.call(this)
    if (!config || typeof config !== 'object' || Array.isArray(config)
        || Object.keys(config).some(key => !['projectRoot', 'storageRelative', 'enableSwitch', 'workflowLimits'].includes(key)))
      throw new Error('Invalid transaction graph configuration')
    this.host = new DshTransactionHost(ctx, { ...config, appendPluginRecord })
    this.workflows = new WorkflowRegistry(ctx)
    this.sessionPolicies = new SessionPolicies()
    this.host.allowClassic = agent => this.sessionPolicies.allowClassic(agent)
    installGraphCommand(ctx, this.host, this.sessionPolicies)
    Object.defineProperty(this, 'workflowContract', { value: WORKFLOW_CONTRACT })
    Object.defineProperty(this, 'extensionContract', { value: EXTENSION_CONTRACT })
    ctx.sessionProjections.register(projection)
    for (const definition of createToolDefinitions({ defineTool, hostPort: this.host })) {
      this.host.definitions.set(definition.name, definition)
      ctx.tools.register(definition)
    }
      ctx.systemPrompt.section({ name: 'project:transaction-graph', order: 46,
        text: ({ agent }) => this.host.inProject(agent?.session) && this.sessionPolicies.allowClassic(agent) ? guidance : '' })
      ctx.systemPrompt.context({ name: 'project:transaction-graph-state', order: 46, required: true, interpolate: false,
        text: ({ agent }) => this.host.inProject(agent?.session) && this.sessionPolicies.allowClassic(agent) ? this.host.context(agent) : '' })
    ctx.inject(['typert', 'sessionController'], remoteCtx => {
      const typert = remoteCtx.typert
      if (typert.resources.get('session')?.field !== 'sessionId') throw new Error('Transaction graph requires the native Session RPC resource')
      const contribution = createRemoteContribution(z)
      remoteCtx.effect(() => typert.register({ package: contribution.package, face: 'host', schemas: [],
        model: { services: [], events: [], objects: [] }, invocations: contribution.descriptors }))
    })
    ctx.on('tools/execute', async (exec, next) => {
      if (!exec.agent) return next()
      const running = this.host.running.get(exec.agent) ?? new Set()
      running.add(exec); this.host.running.set(exec.agent, running)
      try { return await next() } finally { running.delete(exec) }
    })
    ctx.on('session/event', (session, event) => {
      if ((event.type === 'tool/result' || event.type === 'turn/end')
          && ctx.sessionProjections.stateOf(session, KEY)?.intents.length) {
        // Appending during publication is forbidden by Session; defer the
        // durability barrier and journal CAS until publication has unwound.
        queueMicrotask(() => { if (!this.host.closed) this.host.schedule(session) })
      }
    })
    ctx.effect(() => () => { this.workflows.close(); this.sessionPolicies.close(); return this.host.close() })
  }
  async status({ sessionId }, signal) {
    signal?.throwIfAborted()
    const controller = this.ctx.get('sessionController')
    if (!controller) throw new RemoteError('session/not-found', 'Session controller unavailable', { sessionId })
    const result = await controller.resolveAgent(sessionId)
    if (result.error) throw result.error
    signal?.throwIfAborted()
    const readScope = new Map()
    const execution = this.workflows.executionView(result.agent, readScope)
    const snapshot = { ...this.host.snapshot(result.agent.session), ...(execution ? { execution } : {}) }
    if (snapshot.status !== 'empty') return snapshot
    try {
      const source = this.workflows.graphView(result.agent, readScope)
      return source ? { ...snapshot, status: 'ready', graph: formatGraphView(source.display, source.plan) } : snapshot
    } catch {
      return { ...snapshot, status: 'unavailable' }
    }
  }
  async output(request, signal) {
    signal?.throwIfAborted()
    const controller = this.ctx.get('sessionController')
    if (!controller) throw new RemoteError('session/not-found', 'Session controller unavailable', { sessionId: request.sessionId })
    const result = await controller.resolveAgent(request.sessionId)
    if (result.error) throw result.error
    return { sessionId: request.sessionId, workflowId: request.workflowId, ...await this.workflows.executionOutput(result.agent, request, signal) }
  }
  async outputBody(request, signal) { return this.output(request, signal) }
  async control(request, signal) {
    signal?.throwIfAborted()
    const controller = this.ctx.get('sessionController')
    if (!controller) throw new RemoteError('session/not-found', 'Session controller unavailable', { sessionId: request.sessionId })
    const result = await controller.resolveAgent(request.sessionId)
    if (result.error) throw result.error
    await this.workflows.controlExecution(result.agent, request, signal)
    return this.status({ sessionId: request.sessionId }, signal)
  }
  registerRecoveryVerifier(adapter) { return this.host.registerRecoveryVerifier(adapter) }
  recoverInterrupted(agent, request) { return this.host.recoverInterrupted(agent, request) }
  registerWorkflowProvider(adapter) { return this.workflows.register(adapter) }
  listWorkflows(agent) { return this.workflows.list(agent) }
  readWorkflow(agent, reference) { return this.workflows.read(agent, reference) }
  dispatchWorkflow(agent, reference, operation, request, signal) { return this.workflows.dispatch(agent, reference, operation, request, signal) }
  subscribeWorkflows(callback) { return this.workflows.subscribe(callback) }
  registerSessionPolicy(provider) { return this.sessionPolicies.register(provider) }
  createExtensionStore(options) {
    if (this.host.closed) throw new Error('TASK_GRAPH_SERVICE_CLOSED')
    return new FileGraphStore(options)
  }
  inspectGraphPresence(agent) { return this.host.presence(agent.session) }
}
