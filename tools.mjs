// SPDX-License-Identifier: GPL-3.0-only
import { createHash } from 'node:crypto'
import { GraphError, copy } from './core.mjs'

export const TOOL_NAMES = Object.freeze(['transaction_graph_read', 'transaction_graph_create',
  'transaction_graph_begin', 'transaction_graph_finish', 'transaction_graph_skip'])
const evidence = { type: 'array', items: { type: 'object', properties: {
  kind: { type: 'string', required: true, enum: ['session_event', 'tool_result', 'artifact'] },
  ref: { type: 'string', required: true }, sha256: { type: 'string' },
}, additionalProperties: false } }
const revision = { type: 'integer', required: true, description: 'Exact revision from the last program-generated read.' }
const definition = { type: 'object', required: true, properties: {
  title: { type: 'string', required: true },
  nodes: { type: 'array', required: true, items: { type: 'object', properties: {
    key: { type: 'string', required: true }, kind: { type: 'string', required: true, enum: ['container', 'leaf'] },
    label: { type: 'string', required: true }, parent: { type: 'string' },
    switchCases: { type: 'array', items: { type: 'string' } },
  }, additionalProperties: false } },
  edges: { type: 'array', required: true, items: { type: 'object', properties: {
    kind: { type: 'string', required: true, enum: ['prerequisite', 'route', 'case'] },
    from: { type: 'string', required: true }, to: { type: 'string', required: true },
    outcome: { type: 'string', enum: ['complete', 'incomplete'] }, case: { type: 'string' },
  }, additionalProperties: false } },
}, additionalProperties: false }

const argumentExample = (label, args) => `${label}\n\`\`\`json\n${JSON.stringify(args)}\n\`\`\``
const createExample = { expectedRevision: 0, definition: {
  title: 'Inspect and deliver', nodes: [
    { key: 'root', kind: 'container', label: 'Project' },
    { key: 'inspect', kind: 'leaf', label: 'Inspect inputs', parent: 'root' },
    { key: 'deliver', kind: 'leaf', label: 'Deliver results', parent: 'root' },
  ], edges: [{ kind: 'prerequisite', from: 'inspect', to: 'deliver' }],
} }
const branchExample = { expectedRevision: 0, definition: {
  title: 'Inspect and route', nodes: [
    { key: 'root', kind: 'container', label: 'Project' },
    { key: 'inspect', kind: 'leaf', label: 'Inspect inputs', parent: 'root', switchCases: ['ready'] },
    { key: 'deliver', kind: 'leaf', label: 'Deliver results', parent: 'root' },
    { key: 'diagnose', kind: 'leaf', label: 'Diagnose unmet conditions', parent: 'root' },
  ], edges: [
    { kind: 'case', from: 'inspect', to: 'deliver', case: 'ready' },
    { kind: 'route', from: 'inspect', to: 'diagnose', outcome: 'incomplete' },
  ],
} }
const receiptExample = [{ kind: 'tool_result', ref: 'dsh-session:example-session#event=12' }]

// Mandatory adapter port. No fallback infers successful tool execution from a ref.
// Implementations must durably reserve one intent, commit only after real successful
// tool/result AND every enclosing PTC parent, and CAS-check again at that boundary.
// A restarted adapter must reconcile persisted pending intents, never replay them.
export class UnconnectedHostPort {
  authorize() { throw new GraphError('DSH_INTEGRATION_NOT_RUN') }
  read() { throw new GraphError('DSH_INTEGRATION_NOT_RUN') }
  stageMutation() { throw new GraphError('DSH_INTEGRATION_NOT_RUN') }
}

function operationId(scope, callId) {
  if (typeof scope !== 'string' || !scope || scope.length > 512 || typeof callId !== 'string' || !callId || callId.length > 512)
    throw new GraphError('HOST_SCOPE_AND_CALL_ID_REQUIRED')
  return 'op_' + createHash('sha256').update(JSON.stringify([scope, callId])).digest('hex')
}
function toolArguments(operation, args) {
  const allowed = { read: [], create: ['expectedRevision', 'definition'], begin: ['expectedRevision', 'choice'],
    finish: ['expectedRevision', 'outcome', 'caseIndex', 'evidence', 'note', 'disposition'],
    skip: ['expectedRevision', 'choice', 'evidence', 'note'] }[operation]
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !allowed.includes(key)))
    throw new GraphError('UNEXPECTED_TOOL_ARGUMENT')
  if (operation !== 'read' && (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0))
    throw new GraphError('INVALID_REVISION')
  if (['begin', 'skip'].includes(operation) && (!Number.isSafeInteger(args.choice) || args.choice < 0))
    throw new GraphError('INVALID_CHOICE')
  return copy(args)
}

export function createToolDefinitions({ defineTool, hostPort = new UnconnectedHostPort() }) {
  if (typeof defineTool !== 'function') throw new GraphError('REAL_DSH_DEFINE_TOOL_REQUIRED')
  const definitions = [
    { name: TOOL_NAMES[0], operation: 'read', parameters: {},
      description: 'Read program-generated transaction IDs, revision, legal begin/skip choices, active/recovery state and parent summaries. Goal completion is independent.'
        + '\n' + argumentExample('Read the current graph', {}) },
    { name: TOOL_NAMES[1], operation: 'create', parameters: { expectedRevision: revision, definition },
      description: 'Propose one immutable bounded transaction graph. Use one root container and omit its parent field. Other nodes reference their parent container by key. A prerequisite edge points from the prerequisite to its dependent leaf. Use parent for containment. Declare immediate prerequisites and keep independent conditions. Omit prerequisites already implied by an unconditional chain. Use local node keys so the program can assign durable IDs. A staged proposal still awaits commit. Adapt the example to the current project and use the reported revision.'
        + '\n' + argumentExample('Create a graph with a prerequisite', createExample)
        + '\nRoute and case endpoints are declared leaves. Use named cases only when the host enables switches.'
        + '\n' + argumentExample('Create a conditional graph when switches are enabled', branchExample) },
    { name: TOOL_NAMES[2], operation: 'begin', parameters: { expectedRevision: revision, choice: { type: 'integer', required: true } },
      description: 'Stage the displayed legal choice index as the sole active leaf. Use the revision and zero-based choice from the latest read. Restarted ACTIVE requires host reconciliation.'
        + '\n' + argumentExample('Begin choice 0 at revision 1', { expectedRevision: 1, choice: 0 }) },
    { name: TOOL_NAMES[3], operation: 'finish', parameters: { expectedRevision: revision,
      outcome: { type: 'string', required: true, enum: ['complete', 'incomplete'] }, caseIndex: { type: 'integer' },
      disposition: { type: 'string', enum: ['SKIPPED_NOT_RUN', 'UNSATISFIED', 'FAILED'], description: 'Required for incomplete: explicit non-execution, unsatisfied outcome, or real known terminal failure. UNKNOWN never qualifies.' },
      evidence, note: { type: 'string', required: true } },
      description: 'Stage complete or explicit incomplete disposition for the active attempt. Use the actual committed revision and exact same-session evidence after begin. The sample ref shows the syntax only. FAILED requires a real terminal failure receipt. SKIPPED_NOT_RUN preserves non-execution. UNSATISFIED records a result that did not meet the criterion. Wait for all owned work to settle. An authorized switch leaf also needs its displayed caseIndex on complete. Goal success is independent.'
        + '\n' + argumentExample('Complete with a qualified successful tool result', { expectedRevision: 2, outcome: 'complete', evidence: receiptExample, note: 'The check confirmed the expected result.' })
        + '\n' + argumentExample('Complete an authorized switch and select its displayed ready case', { expectedRevision: 2, outcome: 'complete', caseIndex: 0, evidence: receiptExample, note: 'The input is ready for delivery.' })
        + '\n' + argumentExample('Record a known failure with its own failed result', { expectedRevision: 2, outcome: 'incomplete', disposition: 'FAILED', evidence: receiptExample, note: 'The recorded check terminated with an error.' })
        + '\n' + argumentExample('Record a leaf whose criterion was unmet', { expectedRevision: 2, outcome: 'incomplete', disposition: 'UNSATISFIED', evidence: receiptExample, note: 'The recorded output differs from the required result.' })
        + '\n' + argumentExample('Record confirmed non-execution', { expectedRevision: 2, outcome: 'incomplete', disposition: 'SKIPPED_NOT_RUN', evidence: [], note: 'No work ran for this attempt.' }) },
    { name: TOOL_NAMES[4], operation: 'skip', parameters: { expectedRevision: revision, choice: { type: 'integer', required: true },
      evidence, note: { type: 'string', required: true } },
      description: 'Stage a displayed pending skip choice when no leaf is active. A skip leaves prerequisites unmet and routes inactive. Copy the latest revision and displayed choice.'
        + '\n' + argumentExample('Skip a pending optional leaf', { expectedRevision: 1, choice: 0, evidence: [], note: 'The optional leaf is outside the selected scope.' }) },
  ]
  return definitions.map(({ operation, ...tool }) => defineTool({ ...tool,
    ...(operation === 'read' ? { projectPlanCapability: 'read_or_protocol' } : {}),
    output: { schema: { type: 'object', properties: {}, additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      exec.signal?.throwIfAborted()
      if (!exec.agent || typeof exec.callId !== 'string') throw new GraphError('REAL_AGENT_TOOL_EXECUTION_REQUIRED')
      const checkedArguments = toolArguments(operation, args)
      // The real port must verify current initiator, running agent, active session
      // and permission scope using actual DSH APIs, not model-supplied fields.
      const authority = await hostPort.authorize(exec, { operation })
      if (!authority || authority.currentInitiatorVerified !== true || authority.agentId !== exec.agent.id)
        throw new GraphError('HOST_OWNERSHIP_NOT_VERIFIED')
      exec.signal?.throwIfAborted()
      if (operation === 'read') return hostPort.read(authority, exec)
      const result = await hostPort.stageMutation({ operation, arguments: checkedArguments,
        operationId: operationId(authority.sessionScope, exec.callId), authority, execution: exec })
      if (result?.state !== 'PENDING_HOST_COMMIT') throw new GraphError('HOST_MUST_STAGE_NOT_PRETEND_COMMIT')
      return { ...result, goalReached: false,
        instruction: 'Await the real successful tool/PTC commit boundary, then read the committed revision. Pending is not completion.' }
    },
  }))
}
