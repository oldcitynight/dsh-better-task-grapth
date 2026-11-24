// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test'
import assert from 'node:assert/strict'
import { digest, documentOf, normalizePlan, revisedPlan, TransactionGraph, validateDocument, validatePlan } from '../core.mjs'
import { scopeSignature, childUnitResult, childrenOf } from '../hierarchy.mjs'
import { MemoryGraphStore } from '../store.mjs'
import { evaluate, graphWitnesses, inspectRules, outcomes } from '../rules.mjs'
import { formatGraphView } from '../host.mjs'
import { createRemoteContribution } from '../remote.mjs'
import { z } from 'zod'

const atom = (node, ...accepted) => ({ node, in: accepted })
const rule = (id, when) => ({ id, when })
function terminalError(expected) {
  return error => {
    assert.equal(error.code, 'TERMINAL_AS_PREDECESSOR')
    for (const [key, value] of Object.entries(expected)) assert.equal(error.details[key], value, key)
    return true
  }
}
const group = (key, parent, terminal, ...rules) => ({
  key,
  label: key,
  parent,
  kind: 'container',
  terminal,
  acceptance: key,
  rules
})
const leaf = (key, parent, ...rules) => ({ key, parent, label: key, kind: 'leaf', rules })
const definition = (...nodes) => ({
  title: 'Outcome branches',
  ruleVersion: 1,
  hierarchy: { version: 1, maxGroupDepth: 3 },
  edges: [],
  nodes
})
function graphOf(plan) {
  const store = new MemoryGraphStore(),
    graph = new TransactionGraph(store)
  let serial = 0
  const operation = () => ({ expectedRevision: store.read()?.revision ?? 0, operationId: 'test_' + ++serial })
  graph.create({ ...operation(), definition: plan })
  const next = () => graph.read().legalNext.map((node) => node.key ?? node.label)
  const states = () => Object.fromEntries(graph.read().nodes.map((node) => [node.key, node.ruleState]))
  const evidence = [{ kind: 'artifact', ref: 'check.txt' }]
  function finish(key, outcome = 'PASS') {
    const choice = next().indexOf(key)
    assert.notEqual(choice, -1, key + ' must be runnable')
    graph.begin({ ...operation(), choice })
    graph.finish({
      ...operation(),
      outcome: outcome === 'PASS' ? 'complete' : 'incomplete',
      disposition: outcome === 'PASS' ? 'COMPLETED' : 'FAILED',
      evidence,
      note: outcome
    })
  }
  function review(outcome) {
    const state = store.read().state,
      gate = state.hierarchy.pending
    assert.ok(gate, 'expected a scope checkpoint')
    const report =
      gate.kind === 'GROUP_REVIEW'
        ? {
            outcome,
            summary: 'review result',
            children: childrenOf(state.plan, gate.scopeId).map((node) => ({
              id: node.id,
              sha256: digest(childUnitResult(state, node))
            })),
            ...(outcome === 'FAILED'
              ? {
                  audit: {
                    action: 'FAILED',
                    unmetCriterion: 'missing output',
                    scopeBoundary: 'checked scope',
                    evidence
                  }
                }
              : {})
          }
        : undefined
    return graph.reviewScope({
      ...operation(),
      scopeId: gate.scopeId,
      kind: gate.kind,
      inputHash: scopeSignature(state, gate.scopeId),
      runId: 'check_' + serial,
      ...(report ? { report } : {})
    })
  }
  return { graph, store, states, next, finish, review, operation }
}

test('all seven nonempty outcome masks wait for settlement and recognize exactly their members', () => {
  for (let mask = 1; mask <= 7; mask++) {
    const allowed = outcomes.filter((_, i) => mask & (1 << i)),
      expr = atom('a', ...allowed)
    assert.equal(
      evaluate(expr, () => null),
      null
    )
    for (const state of outcomes)
      assert.equal(
        evaluate(expr, () => state),
        allowed.includes(state)
      )
  }
  const all = { all: [atom('a', 'PASS'), atom('b', 'BLOCK')] },
    any = { any: all.all }
  assert.equal(
    evaluate(all, (key) => (key === 'a' ? 'FAILED' : null)),
    false
  )
  assert.equal(
    evaluate(any, (key) => (key === 'a' ? 'PASS' : null)),
    true
  )
  assert.equal(
    evaluate(any, (key) => (key === 'a' ? 'FAILED' : null)),
    null
  )
})

test('diagnostics distinguish contradictions, equivalent branches, coverage and partial overlap', () => {
  const a = atom('a', 'PASS'),
    b = atom('b', 'PASS'),
    c = atom('c', 'FAILED')
  assert.throws(() => inspectRules([rule('bad', { all: [a, atom('a', 'FAILED')] })]), { code: 'RULE_CONTRADICTION' })
  for (const [second, kind] of [
    [a, 'duplicate'],
    [{ all: [a, b] }, 'covered']
  ]) {
    const result = inspectRules([rule('first', a), rule('second', second)])
    assert.equal(result.warnings[0].kind, kind)
    assert.deepEqual(result.merged, [rule('first', a)])
  }
  const rows = [rule('left', { all: [a, b] }), rule('right', { all: [a, c] })],
    result = inspectRules(rows)
  assert.equal(result.warnings.at(-1).kind, 'overlap')
  for (const va of [...outcomes, null])
    for (const vb of [...outcomes, null])
      for (const vc of [...outcomes, null]) {
        const read = (k) => ({ a: va, b: vb, c: vc })[k]
        assert.equal(
          evaluate({ any: rows.map((r) => r.when) }, read),
          evaluate({ any: result.merged.map((r) => r.when) }, read)
        )
      }
  const timeout = inspectRules([rule('wait', { all: [a, atom('b', ...outcomes)] })])
  assert.equal(
    evaluate(timeout.merged[0].when, (k) => (k === 'a' ? 'PASS' : null)),
    null
  )
})

test('NOT is unary, keeps pending unknown, and obeys both De Morgan laws for all partial assignments', () => {
  const a = atom('a', 'PASS'),
    b = atom('b', 'FAILED', 'BLOCK')
  for (const va of [...outcomes, null])
    for (const vb of [...outcomes, null]) {
      const read = (k) => (k === 'a' ? va : vb)
      assert.equal(evaluate({ not: a }, read), va === null ? null : va !== 'PASS')
      assert.equal(evaluate({ not: { not: a } }, read), evaluate(a, read))
      for (const [op, dual] of [
        ['all', 'any'],
        ['any', 'all']
      ]) {
        const left = { not: { [op]: [a, b] } },
          right = { [dual]: [{ not: a }, { not: b }] }
        assert.equal(evaluate(left, read), evaluate(right, read))
        const checked = inspectRules([rule('original', left), rule('equivalent', right)])
        assert.equal(checked.warnings.at(-1).kind, 'duplicate')
        assert.equal(checked.merged.length, 1)
      }
    }
  assert.throws(() => inspectRules([rule('never', { all: [a, { not: a }] })]), { code: 'RULE_CONTRADICTION' })
  assert.throws(() => inspectRules([rule('never', { not: atom('a', ...outcomes) })]), { code: 'RULE_CONTRADICTION' })
  const completed = { not: { all: [a, { not: a }] } }
  inspectRules([rule('settlement', completed)])
  assert.equal(
    evaluate(completed, () => null),
    null
  )
  for (const outcome of outcomes)
    assert.equal(
      evaluate(completed, () => outcome),
      true
    )
  const shape = (when) =>
    definition(group('root', undefined, 'join'), leaf('a', 'root'), leaf('join', 'root', rule('route', when)))
  for (const bad of [{ not: [a] }, { not: null }, { not: a, any: [b] }])
    assert.throws(() => normalizePlan(shape(bad)), { code: 'RULE_EXPRESSION' })
  assert.throws(() => normalizePlan(shape({ not: atom('a', 'PASS', 'FAILED') })), { code: 'RULE_ROUTE_UNREACHABLE' })
  assert.equal(graphWitnesses(normalizePlan(shape({ not: a }))).join.a, 'FAILED')
})

test('confirmed automatic merges preserve all three truth values across nested AND, OR and NOT', () => {
  // A fixed seed makes any counterexample reproducible. Enumerate all four observable states for each predecessor.
  let seed = 20261121
  const pick = (size) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return (seed >>> 8) % size
  }
  function generated(depth) {
    if (!depth || pick(4) === 0) {
      const mask = 1 + pick(7)
      return atom(['a', 'b', 'c'][pick(3)], ...outcomes.filter((_, i) => mask & (1 << i)))
    }
    switch (pick(3)) {
      case 0:
        return { not: generated(depth - 1) }
      case 1:
        return { any: [generated(depth - 1), generated(depth - 1)] }
      default:
        return { all: [generated(depth - 1), generated(depth - 1)] }
    }
  }
  let checked = 0
  for (let i = 0; i < 100; i++) {
    const shared = generated(2),
      other = generated(2)
    const rows = [rule('main', shared), rule('covered', { all: [shared, other] }), rule('alternative', generated(3))]
    let merged
    try {
      merged = inspectRules(rows).merged
    } catch (error) {
      assert.equal(error.code, 'RULE_CONTRADICTION')
      continue
    }
    checked++
    const source = { any: rows.map((row) => row.when) },
      compiled = { any: merged.map((row) => row.when) }
    for (const a of [...outcomes, null])
      for (const b of [...outcomes, null])
        for (const c of [...outcomes, null]) {
          const read = (key) => ({ a, b, c })[key]
          assert.equal(evaluate(compiled, read), evaluate(source, read), JSON.stringify({ rows, merged, a, b, c }))
        }
  }
  assert.ok(checked >= 35)
})

test('preflight binds stable keys, rejects cycles, illegal scope and graph-impossible combinations', () => {
  const make = (...rows) =>
    definition(
      group('root', undefined, 'join'),
      leaf('gate', 'root'),
      leaf('left', 'root', rule('success', atom('gate', 'PASS'))),
      leaf('right', 'root', rule('failure', atom('gate', 'FAILED'))),
      leaf('join', 'root', ...rows)
    )
  assert.throws(() => normalizePlan(make(rule('both', { all: [atom('left', 'PASS'), atom('right', 'PASS')] }))), {
    code: 'RULE_ROUTE_UNREACHABLE'
  })
  assert.throws(() => normalizePlan(make(rule('never', atom('gate', 'BLOCK')))), { code: 'RULE_ROUTE_UNREACHABLE' })
  assert.throws(() => normalizePlan(make(rule('typo', atom('old', 'PASS')))), { code: 'RULE_UNKNOWN_PREDECESSOR' })
  const cyclic = make(rule('left_done', atom('left', 'PASS')))
  cyclic.nodes[1].rules = [rule('late', atom('left', 'PASS'))]
  assert.throws(() => normalizePlan(cyclic), /CYCLE/)
  const cross = definition(
    group('root', undefined, 'final'),
    group('sub', 'root', 'child'),
    leaf('child', 'sub'),
    leaf('final', 'root', rule('private', atom('child', 'PASS')))
  )
  assert.throws(() => normalizePlan(cross), { code: 'CROSS_SCOPE_EDGE' })
  const plan = normalizePlan(make(rule('fallback', { all: [atom('left', 'BLOCK'), atom('right', 'PASS')] })))
  assert.deepEqual({ ...graphWitnesses(plan).join }, { gate: 'FAILED', right: 'PASS' })
})

test('a failed leaf closes one route, opens a BLOCK fallback, and never forges a child execution', () => {
  const plan = definition(
    group('root', undefined, 'repair'),
    leaf('gate', 'root'),
    leaf('optional', 'root', rule('only', atom('gate', 'PASS'))),
    leaf('repair', 'root', rule('fallback', atom('optional', 'BLOCK', 'FAILED')))
  )
  const { graph, store, states, next, finish, review, operation } = graphOf(plan)
  assert.deepEqual(next(), ['gate'])
  assert.deepEqual([states().gate, states().optional, states().repair], ['READY', 'WAITING', 'WAITING'])
  assert.throws(() => graph.skip({ ...operation(), choice: 0, note: 'agent blocked' }), {
    code: 'RULE_AGENT_BINARY_OUTCOME_REQUIRED'
  })
  finish('gate', 'FAILED')
  review()
  assert.deepEqual([states().gate, states().optional, states().repair], ['FAILED', 'BLOCK', 'READY'])
  const state = store.read().state,
    optional = state.plan.nodes.find((n) => n.key === 'optional')
  assert.equal(state.leaves[optional.id].attemptId, undefined)
  assert.equal(childUnitResult(state, optional).predecessors[0].outcome, 'FAILED')
  const remote = formatGraphView(graph.read(), state.plan)
  createRemoteContribution(z)
    .descriptors[0].result.create()
    .parse({ status: 'ready', sessionId: 'test', graph: remote })
  assert.equal(remote.nodes.find((n) => n.label === 'repair').ruleState, 'READY')
  assert.deepEqual(next(), ['repair'])
  finish('repair')
  review('PASS')
  assert.equal(graph.read().rootOutcome, 'PASS')
  assert.equal(graph.read().goalReached, true)
  validateDocument(store.read())
})

for (const verdict of ['PASS', 'FAILED'])
  test('audited group ' + verdict + ' routes to sibling group, with its own leaf and terminal audit', () => {
    const plan = definition(
      group('root', undefined, 'finish'),
      group('review', 'root', 'check'),
      leaf('check', 'review'),
      group('recovery', 'root', 'fix', rule('failure', { not: atom('review', 'PASS', 'BLOCK') })),
      leaf('fix', 'recovery'),
      leaf('finish', 'root', rule('always_after', atom('recovery', ...outcomes)))
    )
    const { graph, store, states, next, finish, review } = graphOf(plan)
    assert.deepEqual(next(), ['check'])
    finish('check')
    assert.throws(() => review('BLOCKED'), { code: 'GROUP_REPORT_INPUT_MISMATCH' })
    review(verdict)
    review()
    assert.equal(states().review, verdict)
    if (verdict === 'FAILED') {
      assert.deepEqual(next(), ['fix'])
      finish('fix')
      review('PASS')
      review()
    } else {
      assert.equal(states().recovery, 'BLOCK')
      assert.equal(states().fix, 'BLOCK')
    }
    assert.deepEqual(next(), ['finish'])
    finish('finish')
    review('PASS')
    assert.equal(graph.read().goalReached, true)
    validateDocument(store.read())
  })

test('revision protects an entered group and its settled leaves while allowing changes to future rules', () => {
  const plan = definition(
    group('root', undefined, 'finish'),
    leaf('gate', 'root'),
    group('sub', 'root', 'check', rule('enter', atom('gate', 'PASS'))),
    leaf('check', 'sub'),
    leaf('finish', 'root', rule('after', atom('sub', ...outcomes)))
  )
  const { store, finish, review } = graphOf(plan)
  finish('gate')
  review()
  finish('check')
  review('PASS')
  review()
  const altered = structuredClone(plan)
  altered.nodes.find((n) => n.key === 'sub').rules = [rule('enter', { not: atom('gate', 'FAILED') })]
  assert.throws(() => revisedPlan(store.read(), altered), { code: 'STARTED_GROUP_RULES_IMMUTABLE' })
  const future = structuredClone(plan)
  future.nodes.find((n) => n.key === 'finish').rules = [rule('after', { not: atom('sub', 'FAILED') })]
  assert.deepEqual(
    revisedPlan(store.read(), future).nodes.find((n) => n.key === 'finish').rules,
    future.nodes.at(-1).rules
  )
})

test('an independent terminal is deferred behind every runnable sibling, including for explicit selections', () => {
  const { graph, store, operation, next, states, finish, review } = graphOf(definition(
    group('root', undefined, 'terminal'), leaf('terminal', 'root'), leaf('first', 'root'), leaf('second', 'root')
  ))
  assert.equal(states().terminal, 'READY')
  const terminal = store.read().state.plan.nodes.find(node => node.key === 'terminal')
  assert.deepEqual(graph.read().pendingButBlocked.find(node => node.id === terminal.id),
    { id: terminal.id, reason: 'TERMINAL_DEFERRED', unmetPrerequisites: [] })
  assert.deepEqual(next(), ['first', 'second'])
  assert.throws(() => graph.begin({ ...operation(), choice: 2 }), { code: 'NO_SUCH_LEGAL_CHOICE' })
  finish('second')
  assert.deepEqual(next(), [])
  review()
  assert.deepEqual(next(), ['first'])
  finish('first')
  review()
  assert.deepEqual(next(), ['terminal'])
  finish('terminal')
  assert.equal(store.read().state.hierarchy.pending.kind, 'GROUP_REVIEW')
  review('PASS')
  assert.equal(graph.read().goalReached, true)
})

test('each layer defers its terminal leaf or group until ordinary work at that layer has run', () => {
  const { graph, next, finish, review } = graphOf(definition(
    group('root', undefined, 'final_group'),
    group('final_group', 'root', 'seal'), leaf('seal', 'final_group'), leaf('prepare', 'final_group'),
    group('ordinary', 'root', 'handoff'), leaf('handoff', 'ordinary'), leaf('work', 'ordinary'),
    leaf('side', 'root')
  ))
  assert.deepEqual(next(), ['work'])
  finish('work')
  review()
  assert.deepEqual(next(), ['handoff'])
  finish('handoff')
  review('PASS')
  review()
  assert.deepEqual(next(), ['side'])
  finish('side')
  review()
  assert.deepEqual(next(), ['prepare'])
  finish('prepare')
  review()
  assert.deepEqual(next(), ['seal'])
  finish('seal')
  review('PASS')
  review('PASS')
  assert.equal(graph.read().goalReached, true)
})

test('a waiting sibling whose route closes yields to the terminal for the final group review', () => {
  const { graph, store, states, next, finish, review } = graphOf(definition(
    group('root', undefined, 'terminal'), leaf('terminal', 'root'), leaf('gate', 'root'),
    leaf('optional', 'root', rule('success', atom('gate', 'PASS')))
  ))
  assert.deepEqual(next(), ['gate'])
  assert.equal(states().optional, 'WAITING')
  finish('gate', 'FAILED')
  review()
  assert.equal(states().optional, 'BLOCK')
  assert.deepEqual(next(), ['terminal'])
  finish('terminal')
  assert.equal(store.read().state.hierarchy.pending.kind, 'GROUP_REVIEW')
  review('PASS')
  assert.equal(graph.read().goalReached, true)
})

test('a terminal leaf or group cannot supply a sibling rule, even inside an alternate or negated branch', () => {
  for (const accepted of [['PASS'], ['FAILED'], ['BLOCK'], outcomes]) {
    for (const terminalKind of ['leaf', 'group']) {
      const bad = rule('fallback', { any: [atom('ordinary', 'PASS'), {
        all: [atom('ordinary', 'FAILED'), { not: atom('terminal', ...accepted) }]
      }] })
      const plan = definition(group('root', undefined, 'terminal'), leaf('ordinary', 'root'),
        group('side', 'root', 'work', bad), leaf('work', 'side'),
        ...(terminalKind === 'leaf' ? [leaf('terminal', 'root')] : [group('terminal', 'root', 'end'), leaf('end', 'terminal')]))
      const store = new MemoryGraphStore(), graph = new TransactionGraph(store)
      assert.throws(() => graph.create({ operationId: 'create', definition: plan }), terminalError({
        scope: 'root', terminal: 'terminal', target: 'side', ruleId: 'fallback',
        path: '/nodes/2/rules/0/when/any/1/all/1/not/node'
      }))
      assert.equal(store.read(), null)
    }
  }
})

test('legacy prerequisite and conditional edges reject a terminal source, including in a cycle', () => {
  const plan = { title: 'Legacy group', hierarchy: { version: 1, maxGroupDepth: 3 }, nodes: [
    { key: 'root', kind: 'container', label: 'Root', terminal: 'last', acceptance: 'Review delivery' },
    { key: 'last', kind: 'container', parent: 'root', label: 'Last', terminal: 'end', acceptance: 'Final result' },
    { key: 'end', kind: 'leaf', parent: 'last', label: 'End' },
    { key: 'peer', kind: 'leaf', parent: 'root', label: 'Peer' }
  ], edges: [{ kind: 'prerequisite', from: 'peer', to: 'last' }] }
  for (const edge of [{ kind: 'prerequisite' }, { kind: 'route', outcome: 'complete' }, { kind: 'route', outcome: 'blocked' }]) {
    assert.throws(() => normalizePlan({ ...plan, edges: [...plan.edges, { ...edge, from: 'last', to: 'peer' }] }),
      terminalError({ scope: 'root', terminal: 'last', target: 'peer', path: '/edges/1/from' }))
  }
})

test('a terminal can consume siblings and its enclosing group can supply a parent-level rule; redesignation rechecks all references', () => {
  const plan = definition(group('root', undefined, 'final'), group('stage', 'root', 'end'),
    leaf('work', 'stage'), leaf('end', 'stage', rule('checked', atom('work', 'PASS'))),
    leaf('final', 'root', rule('handoff', atom('stage', 'PASS'))))
  const { store, next, finish, review } = graphOf(plan)
  for (const [scope, terminal, target] of [['stage', 'work', 'end'], ['root', 'stage', 'final']]) {
    const change = structuredClone(plan)
    change.nodes.find(n => n.key === scope).terminal = terminal
    assert.throws(() => revisedPlan(store.read(), change), terminalError({ scope, terminal, target }))
  }
  assert.equal(store.read().revision, 1)
  finish('work')
  review()
  finish('end')
  review('PASS')
  review()
  assert.deepEqual(next(), ['final'])
})

test('a closed terminal still propagates BLOCK', () => {
  const closed = graphOf(
    definition(
      group('root', undefined, 'terminal'),
      leaf('gate', 'root'),
      leaf('terminal', 'root', rule('needed', atom('gate', 'PASS'))),
      leaf('side', 'root')
    )
  )
  closed.finish('gate', 'FAILED')
  assert.equal(closed.graph.read().rootOutcome, 'BLOCK')
  assert.equal(closed.states().side, 'BLOCK')
  assert.deepEqual(closed.next(), [])
})

test('old blueprints and attempts with a terminal source replay; a reviewed repair is required for new dispatch', () => {
  const spec = definition(group('root', undefined, 'after'), leaf('last', 'root'),
    leaf('after', 'root', rule('ordered', atom('last', 'PASS'))))
  const valid = normalizePlan(spec), broken = structuredClone(valid)
  const last = broken.nodes.find(node => node.key === 'last')
  broken.nodes[0].terminal = last.id
  const reviewFor = (revision, plan) => ({ verdict: 'APPROVE', baseRevision: revision, planChecksum: digest(plan),
    proposalHash: digest({ revision, plan }), updaterRunId: 'updater', reviewerRunId: 'reviewer' })
  function append(events, type, data) {
    const seq = events.length + 1
    const event = { id: 'old_event_' + seq, operationId: 'old_op_' + seq, seq, type, data, previousHash: events.at(-1)?.hash ?? null }
    return [...events, { ...event, hash: digest(event) }]
  }
  assert.throws(() => validatePlan(broken), terminalError({ terminal: 'last' }))
  assert.throws(() => documentOf(append([], 'CREATED', { plan: broken, terminalPolicy: 'sink' })), terminalError({ target: 'after' }))
  assert.ok(validateDocument(documentOf(append([], 'CREATED', { plan: broken }))))
  const initial = append([], 'CREATED', { plan: valid })
  const revised = append(initial, 'REVISED', { plan: broken, review: reviewFor(1, broken) })
  assert.throws(() => documentOf(append(initial, 'REVISED', { plan: broken, review: reviewFor(1, broken), terminalPolicy: 'sink' })),
    terminalError({ target: 'after' }))
  const archived = documentOf(revised)
  const idle = new TransactionGraph(new MemoryGraphStore(archived))
  assert.equal(idle.read().planIssue.terminal, 'last')
  assert.deepEqual(idle.read().legalNext, [])
  assert.throws(() => idle.begin({ expectedRevision: 2, operationId: 'illegal', choice: 0 }), terminalError({ target: 'after' }))
  assert.throws(() => idle.revise({ expectedRevision: 2, operationId: 'bad_revision', plan: broken, review: reviewFor(2, broken) }),
    terminalError({ scope: 'root' }))
  assert.equal(idle.read().revision, 2)

  let index = 0
  const historical = append(revised, 'BEGUN', { nodeId: last.id, owner: 'old_owner', attemptId: 'old_attempt', selectionPolicy: 'terminal-last' })
  const store = new MemoryGraphStore(documentOf(historical))
  const graph = new TransactionGraph(store, { id: prefix => prefix === 'owner' ? 'old_owner' : prefix + '_' + ++index })
  graph.finish({ expectedRevision: 3, operationId: 'finished', outcome: 'complete',
    evidence: [{ kind: 'artifact', ref: 'receipt.txt' }], note: 'The recorded attempt finished.' })
  const repair = revisedPlan(store.read(), spec)
  graph.revise({ expectedRevision: 4, operationId: 'repair', plan: repair, review: reviewFor(4, repair) })
  assert.equal(store.read().events.at(-1).data.terminalPolicy, 'sink')
  assert.throws(() => documentOf(append(store.read().events, 'REVISED', { plan: broken, review: reviewFor(5, broken) })),
    { code: 'INVALID_TERMINAL_POLICY' })
  assert.deepEqual(store.read().events.slice(0, historical.length), historical)
  assert.equal(graph.read().planIssue, undefined)
  assert.deepEqual(graph.read().legalNext.map(row => row.label), ['after'])
  graph.begin({ expectedRevision: 5, operationId: 'continue', choice: 0 })
  assert.ok(validateDocument(store.read()))
})

test('an old early terminal group replays and resumes its recorded attempt, then yields at the next dispatch', () => {
  const { graph, store, next, finish, review, operation } = graphOf(definition(
    group('root', undefined, 'final_group'), group('final_group', 'root', 'seal'),
    leaf('prepare', 'final_group'), leaf('seal', 'final_group'), leaf('outside', 'root')
  ))
  const created = store.read()
  const prepare = created.state.plan.nodes.find(node => node.key === 'prepare')
  const attempt = { nodeId: prepare.id, attemptId: 'old_attempt', owner: graph.owner }
  const oldReceipt = { id: 'old_begin', seq: 2, operationId: 'old_op', type: 'BEGUN',
    data: attempt, previousHash: created.events[0].hash }
  function appendReceipt(history, receipt) {
    return documentOf([...history, { ...receipt, hash: digest(receipt) }])
  }
  assert.deepEqual(next(), ['outside'])
  assert.throws(() => appendReceipt(created.events, { ...oldReceipt, data: { ...attempt, selectionPolicy: 'terminal-last' } }),
    { code: 'BEGIN_NOT_LEGAL' })
  assert.throws(() => appendReceipt(created.events, { ...oldReceipt, data: { ...attempt, selectionPolicy: 'unknown' } }),
    { code: 'BEGIN_SELECTION_POLICY_INVALID' })
  store.compareAndSwap(created.revision, () => appendReceipt(created.events, oldReceipt))
  const evidence = [{ kind: 'artifact', ref: 'old-attempt.txt' }]
  graph.suspend({ ...operation(), evidence, note: 'Pause the recorded attempt.' })
  assert.ok(validateDocument(JSON.parse(JSON.stringify(store.read()))))
  graph.resolveSuspension({ ...operation(), mode: 'resume', attemptId: attempt.attemptId })
  assert.deepEqual(store.read().state.active, attempt)
  graph.finish({ ...operation(), outcome: 'complete', evidence, note: 'Finish the recorded attempt.' })
  review()
  assert.deepEqual(next(), ['outside'])
  finish('outside')
  review()
  assert.deepEqual(next(), ['seal'])
  finish('seal')
  review('PASS')
  review('PASS')
  const { events } = store.read()
  assert.deepEqual(events.filter(event => event.type === 'BEGUN').map(event => event.data.selectionPolicy),
    [undefined, 'terminal-last', 'terminal-last'])
  const lastBegin = events.findLastIndex(event => event.type === 'BEGUN')
  const { hash, ...downgraded } = events[lastBegin]
  delete downgraded.data.selectionPolicy
  assert.throws(() => appendReceipt(events.slice(0, lastBegin), downgraded), { code: 'BEGIN_SELECTION_POLICY_INVALID' })
  assert.ok(validateDocument(store.read()))
  assert.equal(graph.read().goalReached, true)
})

test('adding an ordinary sibling during suspension does not preempt an already dispatched terminal', () => {
  const original = definition(group('root', undefined, 'terminal'), leaf('terminal', 'root'))
  const { graph, store, operation, next, finish, review } = graphOf(original)
  const active = graph.begin({ ...operation(), choice: 0 }).active
  graph.suspend({ ...operation(), evidence: [{ kind: 'artifact', ref: 'checkpoint.txt' }], note: 'Review the new sibling.' })
  const changed = structuredClone(original)
  changed.nodes.push(leaf('added', 'root'))
  const before = store.read(), plan = revisedPlan(before, changed)
  graph.revise({ ...operation(), plan, review: { verdict: 'APPROVE', baseRevision: before.revision,
    planChecksum: digest(plan), proposalHash: digest(changed), updaterRunId: 'updater', reviewerRunId: 'reviewer' } })
  assert.deepEqual(next(), [])
  graph.resolveSuspension({ ...operation(), mode: 'resume', attemptId: active.attemptId })
  assert.equal(graph.read().active.attemptId, active.attemptId)
  graph.finish({ ...operation(), outcome: 'complete', note: 'Finish the held terminal.',
    evidence: [{ kind: 'artifact', ref: 'terminal-result.txt' }] })
  review()
  assert.deepEqual(next(), ['added'])
  finish('added')
  review('PASS')
  assert.ok(validateDocument(store.read()))
})
