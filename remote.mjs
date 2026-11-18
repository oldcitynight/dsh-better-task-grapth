// SPDX-License-Identifier: GPL-3.0-only
// Shared by the Host registration and the lazy browser module.
export function createRemoteContribution(z) {
  const packageName = 'dsh-better-task-grapth'
  const id = z.string().min(1).max(128)
  const input = z.object({ sessionId: id }).strict()
  const controlInput = z.object({ sessionId: id, workflowId: id, action: z.enum(['pause', 'resume']) }).strict()
  const offset = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
  const outputInput = z.object({ sessionId: id, workflowId: id, cursor: offset.optional(), before: offset.optional() }).strict()
  const bodyInput = z.object({ sessionId: id, workflowId: id, itemId: z.string().uuid(), offset: offset.optional() }).strict()
  const outputPage = z.object({ sessionId: id, workflowId: id, cursor: offset, more: z.boolean(), older: z.boolean(), warning: z.string().nullable(),
    items: z.array(z.object({ id: z.string().uuid(), sequence: offset, revision: offset, at: z.string(), updatedAt: z.string(),
      stage: z.string().max(128), step: offset, taskId: id.nullable(), taskLabel: z.string().max(512).nullable().optional(), sessionId: id.nullable(),
      kind: z.enum(['model', 'reasoning', 'message', 'tool_input', 'tool']), title: z.string().max(256),
      state: z.enum(['running', 'complete', 'interrupted', 'error']), bytes: offset,
      preview: z.string().max(9000), previewOffset: offset }).strict()).max(40) }).strict()
  const outputBody = z.object({ sessionId: id, workflowId: id, itemId: z.string().uuid(), text: z.string().max(32772),
    offset, nextOffset: offset, totalBytes: offset }).strict()
  const execution = z.object({
    workflowId: id, state: z.enum(['running', 'pausing', 'paused', 'interrupted', 'waiting', 'complete', 'idle', 'blocked']),
    phase: z.string().max(128), reason: z.string().max(512).nullable(),
    pauseKind: z.enum(['normal', 'unexpected']).nullable(),
    canPause: z.boolean(), canResume: z.boolean(),
    activity: z.object({ stage: z.string().max(128), kind: z.enum(['model', 'tool', 'result', 'boundary']),
      sessionId: id.nullable(), step: z.number().int().nonnegative(), tool: z.string().max(128).nullable(),
      at: z.string().max(64) }).strict().nullable(),
  }).strict()
  const node = z.object({
    id, label: z.string().min(1).max(512), kind: z.enum(['container', 'leaf']),
    parent: id.nullable(),
    status: z.enum(['COMPLETE', 'CONTAINER_INCOMPLETE', 'ACTIVE', 'INACTIVE', 'INCOMPLETE', 'PENDING', 'SKIPPED']),
    terminal: id.optional(), isTerminal: z.literal(true).optional(), acceptance: z.string().min(1).max(8000).optional(),
    gate: z.enum(['GROUP_REVIEW', 'PLAN_REVIEW', 'GRAPH_UPDATE', 'GRAPH_AUDIT', 'PAUSE_REVIEW', 'WAITING_USER', 'BLOCKAGE']).nullable().optional(),
    blocked: z.literal(true).optional(),
    disposition: z.enum(['COMPLETED', 'SKIPPED_NOT_RUN', 'UNSATISFIED', 'FAILED']).optional(),
    branchState: z.enum(['SELECTED', 'WAITING', 'NOT_SELECTED']).optional(),
    selectedBranch: z.object({
      outcome: z.enum(['complete', 'incomplete']), case: z.string().min(1).max(64).optional(), targetId: id.optional(),
    }).strict().optional(),
  }).strict()
  const edge = z.discriminatedUnion('kind', [
    z.object({ from: id, to: id, kind: z.literal('prerequisite') }).strict(),
    z.object({ from: id, to: id, kind: z.literal('route'), outcome: z.enum(['complete', 'incomplete']) }).strict(),
    z.object({ from: id, to: id, kind: z.literal('case'), case: z.string().min(1).max(64) }).strict(),
  ])
  const choice = z.object({ id, choice: z.number().int().min(0).max(127) }).strict()
  const graph = z.object({
    hierarchy: z.object({ version: z.literal(1), maxGroupDepth: z.number().int().min(1).max(16), focusScopeId: id, complete: z.boolean(),
      pending: z.object({ kind: z.enum(['GROUP_REVIEW','PLAN_REVIEW']), scopeId: id, subjectId: id }).strict().nullable() }).strict().optional(),
    revision: z.number().int().min(1).max(1024), title: z.string().min(1).max(512),
    nodes: z.array(node).min(2).max(128), edges: z.array(edge).max(512),
    active: z.object({ nodeId: id, recoveryRequired: z.boolean() }).strict().nullable(),
    pending: z.object({ operation: z.string().min(1).max(64), qualification: z.string().min(1).max(128) }).strict().nullable(),
    legalNext: z.array(choice).max(128), skipChoices: z.array(choice).max(128),
  }).strict()
  const output = z.discriminatedUnion('status', [
    z.object({ sessionId: id, status: z.literal('ready'), graph, execution: execution.nullable().optional() }).strict(),
    z.object({ sessionId: id, status: z.literal('empty'), graph: z.null(), execution: execution.nullable().optional() }).strict(),
    z.object({ sessionId: id, status: z.literal('unavailable'), graph: z.null(), execution: execution.nullable().optional() }).strict(),
  ])
  const codec = (key, schema) => ({ mode: 'strict', typeSymbol: `${packageName}#${key}`, create: () => schema })
  return {
    package: packageName,
    descriptors: [{
      id: `${packageName}#transactionGraphView/status`,
      service: 'transactionGraph', namespace: 'transactionGraphView', method: 'status', invocation: { kind: 'direct' },
      parameters: [{
        name: 'request', wire: 'request', source: 'json',
        codec: codec('TransactionGraphStatusRequest', input),
        strictCodec: codec('TransactionGraphStatusStrictRequest', input),
      }],
      cancellation: { parameter: 'signal' },
      result: codec('TransactionGraphStatusResult', output),
    }, {
      id: `${packageName}#transactionGraphView/control`, service: 'transactionGraph',
      namespace: 'transactionGraphView', method: 'control', invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json',
        codec: codec('TransactionGraphControlRequest', controlInput),
        strictCodec: codec('TransactionGraphControlStrictRequest', controlInput) }],
      cancellation: { parameter: 'signal' }, result: codec('TransactionGraphControlResult', output),
    }, ...[['output', outputInput, outputPage], ['outputBody', bodyInput, outputBody]].map(([method, input, result]) => ({
      id: `${packageName}#transactionGraphView/${method}`, service: 'transactionGraph', namespace: 'transactionGraphView', method,
      invocation: { kind: 'direct' }, parameters: [{ name: 'request', wire: 'request', source: 'json',
        codec: codec(`Execution${method}Request`, input), strictCodec: codec(`Execution${method}StrictRequest`, input) }],
      cancellation: { parameter: 'signal' }, result: codec(`Execution${method}Result`, result),
    }))],
  }
}
