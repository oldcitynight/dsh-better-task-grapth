// SPDX-License-Identifier: GPL-3.0-only
import { z } from 'zod'
import { TOOL_NOT_STARTED, TOOL_OUTCOME_UNKNOWN } from '@deepseek-ai/dsh-session'
import { canonical, copy, digest, GraphError } from './core.mjs'
import { administrative, workKey } from './work-policy.mjs'
export const KEY = 'projectTransactionGraphV4'
export const INTENT = 'plugin:project-transaction-graph/intent-v4'
export const RECEIPT = 'plugin:project-transaction-graph/receipt-v4'
export const RECOVERY = 'plugin:project-transaction-graph/operator-recovery-v4'

const nonempty = z.string().min(1)
const hex = z.string().regex(/^[a-f0-9]{64}$/)
const seq = z.number().int().nonnegative()
const workSchema = z.object({ rootCallId: nonempty, callSeq: seq, rootResultSeq: seq.nullable(), eventDigest: hex }).strict()
const bashFailureSchema = z.object({ rootCallId: nonempty, callId: nonempty }).strict()
const factSchema = z.object({ seq, callId: nonempty, tool: nonempty, isError: z.boolean(),
  outcome: z.enum(['UNVERIFIED', 'FAIL', 'NOT_RUN', 'UNKNOWN']) }).strict()
const intentSchema = z.object({ version: z.literal(4), operationId: nonempty, callId: nonempty,
  rootCallId: nonempty, turn: seq, sessionId: nonempty, bindingDigest: hex, claimDigest: hex,
  operation: z.enum(['create', 'begin', 'finish', 'skip', 'reconcile', 'revise']), expectedGraphRevision: seq, candidateChecksum: hex,
  clearedWork: z.array(workSchema) }).strict()
const dispatchSchema = z.object({ seq, subCallId: nonempty, parentCallId: nonempty, rootCallId: nonempty,
  tool: nonempty, isError: z.boolean(), outcome: z.enum(['UNVERIFIED', 'FAIL', 'NOT_RUN', 'UNKNOWN']), eventDigest: hex, turn: seq }).strict()
const proofSchema = z.object({ seq, callId: nonempty, rootCallId: nonempty, rootCallSeq: seq, rootResultSeq: seq,
  tool: nonempty, successful: z.boolean(), qualification: z.enum(['SUCCESS', 'FAILED', 'UNKNOWN']), isError: z.boolean(),
  outcome: z.enum(['UNVERIFIED', 'FAIL', 'NOT_RUN', 'UNKNOWN']), ownOutcome: z.enum(['UNVERIFIED', 'FAIL', 'NOT_RUN', 'UNKNOWN']),
  ancestorOutcomes: z.array(factSchema), eventDigest: hex, turn: seq }).strict()
const pendingSchema = z.object({ intentSeq: seq, data: intentSchema,
  intentDigest: hex, status: z.enum(['PENDING', 'SUCCESS', 'FAILED', 'UNKNOWN']),
  rootResultSeq: seq.nullable(), rootResultDigest: hex.nullable(), workStartedAtRoot: seq.nullable(), workExecutedAtRoot: seq.nullable() }).strict()
export const stateSchema = z.object({ sessionId: nonempty, ownFrom: seq, turn: seq, lastSeq: z.number().int().min(-1),
  workStarted: seq, workExecuted: seq, uncertainties: z.array(workSchema), acknowledgedWork: z.array(workSchema),
  calls: z.record(z.string(), z.object({ tool: nonempty, turn: seq, seq, eventDigest: hex }).strict()),
  bashFailures: z.array(bashFailureSchema),
  dispatches: z.array(dispatchSchema), intents: z.array(pendingSchema),
  proofs: z.array(proofSchema), receipts: z.array(z.object({ operationId: nonempty, seq,
    status: z.enum(['COMMITTED', 'ABORTED']), graphRevision: seq, graphChecksum: hex.nullable(), eventDigest: hex }).strict()), failure: z.string().nullable() }).strict()
export function initialState(header, inheritedEventCount = 0) {
  return { sessionId: header.id, ownFrom: inheritedEventCount, turn: 0, lastSeq: -1, workStarted: 0, workExecuted: 0,
    uncertainties: [], acknowledgedWork: [],
    calls: {}, bashFailures: [], dispatches: [], intents: [], proofs: [], receipts: [], failure: null }
}
export function outcomeOfContent(content = []) {
  const outcomes = new Set()
  for (const block of content) {
    if (block.type !== 'text' || typeof block.text !== 'string') continue

    let value
    try { value = JSON.parse(block.text) } catch { continue }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    // Plain JSON may be domain data returned by a successful tool. Only
    // explicitly named verification results carry qualification here.
    for (const status of [value.goalVerification?.status, value.verification?.status]) if (typeof status === 'string') {
      if (['FAIL', 'FAILED', 'ERROR'].includes(status.toUpperCase())) outcomes.add('FAIL')
      if (['NOT_RUN', 'UNKNOWN'].includes(status.toUpperCase())) outcomes.add(status.toUpperCase())
    }
  }
  // A first FAIL/NOT_RUN block may not hide a later UNKNOWN/contradiction.
  return outcomes.has('UNKNOWN') || outcomes.size > 1 ? 'UNKNOWN' : [...outcomes][0] ?? 'UNVERIFIED'
}
function toolOutcome(state, tool, rootCallId, callId, content) {
  const outcome = outcomeOfContent(content)
  if (tool !== 'bash' || !state.bashFailures.some(row => row.rootCallId === rootCallId && row.callId === callId)) return outcome
  return outcome === 'UNKNOWN' || outcome === 'NOT_RUN' ? 'UNKNOWN' : 'FAIL'
}
export function chainQualification(start, root, dispatches) {
  let child = start
  const visited = new Set()
  let failed = false, unknown = false
  while (child !== root) {
    if (visited.has(child)) return 'UNKNOWN'
    visited.add(child)
    const matches = dispatches.filter(row => row.subCallId === child && row.rootCallId === root)
    if (matches.length !== 1) return 'UNKNOWN'
    const row = matches[0]
    if (row.isError || ['FAIL', 'NOT_RUN'].includes(row.outcome)) failed = true
    if (row.outcome === 'UNKNOWN' || !['UNVERIFIED', 'FAIL', 'NOT_RUN'].includes(row.outcome)) unknown = true
    child = row.parentCallId
  }
  return unknown ? 'UNKNOWN' : failed ? 'FAILED' : 'SUCCESS'
}
export const chainSucceeded = (start, root, dispatches) => chainQualification(start, root, dispatches) === 'SUCCESS'
function ancestryFacts(start, root, dispatches) {
  const facts = [], visited = new Set()
  let cursor = start
  while (cursor !== root && !visited.has(cursor)) {
    visited.add(cursor)
    const matches = dispatches.filter(row => row.subCallId === cursor && row.rootCallId === root)
    if (matches.length !== 1) break
    const row = matches[0]
    if (cursor !== start) facts.push({ seq: row.seq, callId: row.subCallId, tool: row.tool, isError: row.isError, outcome: row.outcome })
    cursor = row.parentCallId
  }
  return facts
}
const qualifiedStatus = (root, chain) => root === 'UNKNOWN' || chain === 'UNKNOWN' ? 'UNKNOWN'
  : root === 'FAILED' || chain === 'FAILED' ? 'FAILED' : 'SUCCESS'
const internal = administrative
export function applyEvent(state, event) {
  if (state.failure) return state
  try {
    if (event.seq < state.ownFrom) return state // Fork parents cannot authorize a child's graph.
    if (event.type.startsWith('plugin:project-transaction-graph/') && ![INTENT, RECEIPT, RECOVERY].includes(event.type))
      throw new GraphError('LEGACY_GRAPH_REQUIRES_EXPLICIT_MIGRATION')
    if (!['turn/start', 'turn/end', 'tool/call', 'tool/ptc-dispatch', 'tool/result', 'job/settled', INTENT, RECEIPT, RECOVERY].includes(event.type)) return state
    const d = event.data
    let next = { ...state, lastSeq: event.seq }
    if (event.type === 'turn/start') return { ...next, turn: d.turn }
    if (event.type === 'tool/call') {
      if (Object.hasOwn(state.calls, d.callId)) throw new GraphError('CALL_ID_REPLAY')
      return { ...next, workStarted: state.workStarted + (!internal(d.name) && d.name !== 'run_code' ? 1 : 0),
        calls: { ...state.calls, [d.callId]: { tool: d.name, turn: state.turn, seq: event.seq, eventDigest: digest(event) } } }
    }
    if (event.type === INTENT || event.type === RECOVERY) {
      const data = intentSchema.parse(d)
      if (data.sessionId !== state.sessionId || data.turn !== state.turn || (event.type === INTENT && !state.turn)
          || state.intents.some(row => row.data.operationId === data.operationId)) throw new GraphError('INTENT_SCOPE_REPLAY')
      if (event.type === INTENT && data.clearedWork.length) throw new GraphError('MODEL_INTENT_CANNOT_ACKNOWLEDGE_WORK')
      let uncertainties = state.uncertainties, acknowledgedWork = state.acknowledgedWork
      if (event.type === RECOVERY) {
        for (const work of data.clearedWork) {
          const unknown = uncertainties.find(row => canonical(row) === canonical(work))
          const open = state.calls[work.rootCallId]
          if (!unknown && !(work.rootResultSeq === null && open?.seq === work.callSeq && open.eventDigest === work.eventDigest))
            throw new GraphError('OPERATOR_WORK_ACK_NOT_OWN_RECORDED_FACT')
        }
        const keys = new Set(data.clearedWork.map(workKey))
        uncertainties = uncertainties.filter(row => !keys.has(workKey(row)))
        acknowledgedWork = [...acknowledgedWork, ...data.clearedWork.filter(row => !acknowledgedWork.some(old => workKey(old) === workKey(row)))]

      }
      return { ...next, uncertainties, acknowledgedWork, intents: [...state.intents, { intentSeq: event.seq, data,
        intentDigest: digest(event), status: event.type === RECOVERY ? 'SUCCESS' : 'PENDING',
        rootResultSeq: event.type === RECOVERY ? event.seq : null, rootResultDigest: event.type === RECOVERY ? digest(event) : null,
        workStartedAtRoot: event.type === RECOVERY ? state.workStarted : null, workExecutedAtRoot: event.type === RECOVERY ? state.workExecuted : null }] }
    }
    if (event.type === 'job/settled') {
      const origin = d.toolCall
      if (d.kind !== 'bash' || d.owner !== state.sessionId || !origin || !Object.hasOwn(state.calls, origin.rootCallId)
          || d.status !== 'completed' || d.producerReported !== true) return next
      // Native Bash reports a nonzero exit in the owned job log even when its tool message is not an error.
      const exit = /^exit code: (-?\d+)(?:;|$)/.exec(d.detail ?? '')
      if (!exit || Number(exit[1]) === 0) return next
      const failure = bashFailureSchema.parse({ rootCallId: origin.rootCallId, callId: origin.callId })
      if (state.bashFailures.some(row => row.rootCallId === failure.rootCallId && row.callId === failure.callId)) return next

      return { ...next, bashFailures: [...state.bashFailures, failure] }
    }
    if (event.type === 'tool/ptc-dispatch') {
      const rootCallId = d.rootCallId ?? d.parentCallId
      if (!Object.hasOwn(state.calls, rootCallId)) {
        // Only a child of an open, owned root can become evidence. Once a
        // graph has history, an unexplained dispatch could hide actual work.
        if (state.intents.length || state.receipts.length) throw new GraphError('UNATTRIBUTED_PTC_DISPATCH_IN_GRAPH_SESSION')
        return next
      }
      const dispatch = dispatchSchema.parse({ seq: event.seq, subCallId: d.subCallId, parentCallId: d.parentCallId,
        rootCallId, tool: d.name, isError: d.isError,
        outcome: toolOutcome(state, d.name, rootCallId, d.subCallId, d.content), eventDigest: digest(event), turn: state.turn })
      if (state.dispatches.some(row => row.subCallId === dispatch.subCallId && row.rootCallId === dispatch.rootCallId)) throw new GraphError('PTC_DISPATCH_REPLAY')
      return { ...next, workStarted: state.workStarted + (!internal(d.name) && d.name !== 'run_code' ? 1 : 0),
        dispatches: [...state.dispatches, dispatch] }
    }
    if (event.type === 'tool/result') {
      const root = d.message.source.callId, success = d.message.isError !== true // Optional false in the published ToolResultMessage API.
      const syntheticUnknown = [TOOL_OUTCOME_UNKNOWN, TOOL_NOT_STARTED].includes(d.error?.code)
      const sources = state.dispatches.filter(row => row.rootCallId === root)
      const call = state.calls[root]
      if (!call) {
        if (state.intents.some(row => row.data.rootCallId === root && ['PENDING', 'UNKNOWN'].includes(row.status)))
          throw new GraphError('OWN_INTENT_RESULT_WITHOUT_OWN_TOOL_CALL')
        // Fork/restore seeds may synthesize child-owned closers for an inherited
        // call. They are not child work, evidence, or authority for a candidate.
        return next
      }
      const standaloneCode = call.tool === 'run_code' && !sources.length
      const rootOutcome = toolOutcome(state, call.tool, root, root, d.message.content)
      const rootQualification = syntheticUnknown || rootOutcome === 'UNKNOWN' ? 'UNKNOWN'
        : !success || ['FAIL', 'NOT_RUN'].includes(rootOutcome) ? 'FAILED' : 'SUCCESS'
      const leafCode = sources.filter(row => row.tool === 'run_code' && !sources.some(child => child.parentCallId === row.subCallId))
      const workStarted = state.workStarted + (standaloneCode ? 1 : 0) + leafCode.length
      const executed = sources.filter(row => !internal(row.tool) && (row.tool !== 'run_code' || leafCode.includes(row)) && !['NOT_RUN', 'UNKNOWN'].includes(row.outcome)).length
        + (!internal(call.tool) && (call.tool !== 'run_code' || standaloneCode) && !['NOT_RUN', 'UNKNOWN'].includes(rootOutcome) && !syntheticUnknown ? 1 : 0)
      const workExecuted = state.workExecuted + executed
      const intents = state.intents.map(row => row.data.rootCallId !== root ? row : {
        ...row, status: qualifiedStatus(rootQualification, chainQualification(row.data.callId, root, sources)),
        rootResultSeq: event.seq, rootResultDigest: digest(event), workStartedAtRoot: workStarted, workExecutedAtRoot: workExecuted })
      const rootFact = { seq: event.seq, callId: root, tool: call.tool, isError: !success, outcome: syntheticUnknown ? 'UNKNOWN' : rootOutcome }
      const proofs = sources.filter(row => !internal(row.tool) && (row.tool !== 'run_code' || leafCode.includes(row))).map(row => {
        const qualification = qualifiedStatus(rootQualification, chainQualification(row.subCallId, root, sources))
        return { seq: row.seq, callId: row.subCallId, rootCallId: root, rootResultSeq: event.seq, rootCallSeq: call.seq,
          tool: row.tool, successful: qualification === 'SUCCESS', qualification, isError: row.isError,
          outcome: row.outcome, ownOutcome: row.outcome, ancestorOutcomes: [...ancestryFacts(row.subCallId, root, sources), rootFact],
          eventDigest: row.eventDigest, turn: row.turn }
      })
      if (!internal(call.tool) && (call.tool !== 'run_code' || !sources.length)) proofs.push({ seq: event.seq,
        callId: root, rootCallId: root, rootResultSeq: event.seq, tool: call.tool,
        rootCallSeq: call.seq,
        successful: rootQualification === 'SUCCESS', qualification: rootQualification, isError: !success,
        outcome: syntheticUnknown ? 'UNKNOWN' : rootOutcome, ownOutcome: syntheticUnknown ? 'UNKNOWN' : rootOutcome, ancestorOutcomes: [],
        eventDigest: digest(event), turn: call.turn })
      const calls = { ...state.calls }; delete calls[root]
      let uncertainties = state.uncertainties
      if (rootQualification === 'UNKNOWN' || sources.some(row => row.outcome === 'UNKNOWN') || proofs.some(row => row.qualification === 'UNKNOWN')) {
        const work = { rootCallId: root, callSeq: call.seq, rootResultSeq: event.seq, eventDigest: digest(event) }
        if (!state.acknowledgedWork.some(row => workKey(row) === workKey(work)) && !uncertainties.some(row => workKey(row) === workKey(work)))
          uncertainties = [...uncertainties, work]

      }
      return { ...next, calls, intents, workStarted, workExecuted, uncertainties, dispatches: state.dispatches.filter(row => row.rootCallId !== root),
        bashFailures: state.bashFailures.filter(row => row.rootCallId !== root),
        proofs: [...state.proofs, ...proofs] }
    }
    if (event.type === RECEIPT) {
      const row = z.object({ operationId: nonempty, status: z.enum(['COMMITTED', 'ABORTED']),
        graphRevision: seq, graphChecksum: hex.nullable() }).strict().parse(d)
      const previous = state.receipts.find(old => old.operationId === row.operationId)
      if (previous && ['status', 'graphRevision', 'graphChecksum'].some(key => previous[key] !== row[key])) throw new GraphError('RECEIPT_CONFLICT')
      return previous ? next : { ...next, receipts: [...state.receipts, { ...row, seq: event.seq, eventDigest: digest(event) }] }
    }
    if (event.type === 'turn/end') return { ...next, turn: 0, intents: state.intents.map(row => row.status === 'PENDING' ? { ...row, status: 'UNKNOWN' } : row) }
    return next
  } catch (error) { return { ...state, failure: `Transaction projection failed at ${event.seq}: ${error.message}` } }
}
export const projection = { key: KEY, stateVersion: 8, stateSchema, init: initialState, apply: applyEvent }
