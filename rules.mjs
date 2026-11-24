// SPDX-License-Identifier: GPL-3.0-only
// Node keys are stable across plan revisions. Outcomes belong to a single graph history.
export const outcomes = Object.freeze(['PASS', 'FAILED', 'BLOCK'])
const keyPattern = /^[a-z][a-z0-9_-]{0,79}$/
export function ruleError(code, path, reason, detail = {}) {
  const error = new Error(code + ' ' + path + ': ' + reason)
  error.code = code
  error.detail = { path, reason, ...detail }
  throw error
}
const isObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const owns = (value, key) => Object.hasOwn(value, key)
export function expression(raw, { holes = false, path = '/when' } = {}) {
  const seenHoles = new Set()
  function visit(value, at) {
    if (!isObject(value))
      ruleError('RULE_EXPRESSION', at, 'Provide an atom, an all/any group, or a unary not expression.')
    const fields = Object.keys(value)
    if (
      holes &&
      fields.length === 1 &&
      owns(value, 'hole') &&
      typeof value.hole === 'string' &&
      keyPattern.test(value.hole)
    ) {
      if (seenHoles.has(value.hole)) ruleError('RULE_DUPLICATE_HOLE', at, 'Each open slot needs a distinct ID.')
      seenHoles.add(value.hole)
      return { hole: value.hole }
    }
    if (
      fields.length === 2 &&
      owns(value, 'node') &&
      owns(value, 'in') &&
      typeof value.node === 'string' &&
      keyPattern.test(value.node)
    ) {
      if (!Array.isArray(value.in) || !value.in.length || value.in.some((v) => !outcomes.includes(v)))
        ruleError('RULE_OUTCOME_SET', at + '/in', 'Choose at least one of PASS, FAILED, BLOCK.')
      return { node: value.node, in: outcomes.filter((v) => value.in.includes(v)) }
    }
    const kind = fields[0]
    if (fields.length === 1 && kind === 'not') return { not: visit(value.not, at + '/not') }
    if (fields.length !== 1 || !['all', 'any'].includes(kind) || !Array.isArray(value[kind]) || !value[kind].length)
      ruleError('RULE_EXPRESSION', at, 'Use a nonempty all/any array, one expression inside not, or {node,in}.')
    return { [kind]: value[kind].map((child, i) => visit(child, at + '/' + kind + '/' + i)) }
  }
  return visit(raw, path)
}
export function atoms(expr) {
  if (expr.node) return [expr.node]
  if (expr.hole) return []
  if (expr.not) return atoms(expr.not)
  return (expr.all ?? expr.any).flatMap(atoms)
}
export function describe(expr, labels = {}) {
  if (expr.not) return '取反（' + describe(expr.not, labels) + '）'
  if (expr.hole) return '【待填 ' + expr.hole + '】'
  if (expr.node) {
    const name = Object.hasOwn(labels, expr.node) ? labels[expr.node] + ' [' + expr.node + ']' : expr.node
    return name + ' ' + expr.in.map((o) => ({ PASS: '通过', FAILED: '已失败', BLOCK: '路线关闭' })[o]).join('或')
  }
  return (
    (expr.all ? '全部成立' : '任一成立') +
    '（' +
    (expr.all ?? expr.any).map((e) => describe(e, labels)).join('，') +
    '）'
  )
}
export function evaluate(expr, outcome) {
  if (expr.not) {
    const value = evaluate(expr.not, outcome)
    return value === null ? null : !value
  }
  if (expr.node) {
    const value = outcome(expr.node)
    return value == null ? null : expr.in.includes(value)
  }
  const all = Boolean(expr.all)
  let waiting = false
  for (const child of expr.all ?? expr.any) {
    const value = evaluate(child, outcome)
    if (value === !all) return !all
    if (value === null) waiting = true
  }
  return waiting ? null : all
}
export function validateRows(raw, options = {}) {
  if (!Array.isArray(raw)) ruleError('RULE_LIST', '/rules', 'Supply an array of {id,when}.')
  const ids = new Set()
  return raw.map((row, i) => {
    if (
      !isObject(row) ||
      Object.keys(row).length !== 2 ||
      typeof row.id !== 'string' ||
      !keyPattern.test(row.id) ||
      ids.has(row.id)
    )
      ruleError('RULE_ID', '/rules/' + i, 'Use a unique stable rule ID and a when expression.')
    ids.add(row.id)
    return { id: row.id, when: expression(row.when, { ...options, path: '/rules/' + i + '/when' }) }
  })
}

// Reduced ordered decision diagrams. A shared variable represents the same predecessor
// in every clause. Partial assignments retain the difference between true and settled.
class Decisions {
  constructor(domain) {
    this.domain = domain
    this.nodes = [null, null]
    this.unique = new Map()
    this.cache = new Map()
  }
  make(key, choices) {
    if (choices.every((n) => n === choices[0])) return choices[0]
    const signature = key + ':' + choices.join(',')
    if (!this.unique.has(signature)) {
      this.unique.set(signature, this.nodes.length)
      this.nodes.push({ key, choices })
    }
    return this.unique.get(signature)
  }
  atom(key, allowed) {
    return this.make(
      key,
      this.domain.map((o) => Number(allowed.includes(o)))
    )
  }
  apply(op, a, b) {
    if (a > b) return this.apply(op, b, a)
    if (a === b) return a
    if (!a) return op === 'and' ? 0 : b
    if (a === 1) return op === 'and' ? b : 1
    const tag = op + ':' + a + ':' + b
    if (this.cache.has(tag)) return this.cache.get(tag)
    const x = this.nodes[a],
      y = this.nodes[b],
      key = x.key < y.key ? x.key : y.key
    const id = this.make(
      key,
      this.domain.map((_, i) => this.apply(op, x.key === key ? x.choices[i] : a, y.key === key ? y.choices[i] : b))
    )
    this.cache.set(tag, id)
    return id
  }
  not(id) {
    if (id < 2) return 1 - id
    if (!this.cache.has(-id)) {
      const n = this.nodes[id]
      this.cache.set(
        -id,
        this.make(
          n.key,
          n.choices.map((v) => this.not(v))
        )
      )
    }
    return this.cache.get(-id)
  }
  witness(id) {
    if (!id) return null
    const result = {}
    while (id > 1) {
      const n = this.nodes[id],
        i = n.choices.findIndex((v) => v !== 0)
      result[n.key] = this.domain[i]
      id = n.choices[i]
    }
    return result
  }
  compile(expr, atom, inverted = false) {
    if (expr.not) return this.compile(expr.not, atom, !inverted)
    if (expr.node) return atom(expr, inverted)
    const all = Boolean(expr.all) !== inverted
    return (expr.all ?? expr.any).reduce(
      (a, e) => this.apply(all ? 'and' : 'or', a, this.compile(e, atom, inverted)),
      all ? 1 : 0
    )
  }
}
export function inspectRules(rows) {
  const d = new Decisions([...outcomes, 'WAITING']),
    warnings = [],
    merges = new Map(),
    overlaps = []
  const atom = (e, negative) => d.atom(e.node, negative ? outcomes.filter((o) => !e.in.includes(o)) : e.in)
  function inspectChildren(expr, path, inverted) {
    if (expr.node) return
    if (expr.not) return inspectChildren(expr.not, path + '/not', !inverted)
    const written = expr.all ? 'all' : 'any'
    const combined = inverted ? (written === 'all' ? 'any' : 'all') : written
    inspect(expr[written], path + '/' + written, combined, inverted)
  }
  function inspect(items, at, kind, inverted = false) {
    const terms = items.map((e, i) => {
      inspectChildren(e, at + '/' + i, inverted)
      const yes = d.compile(e, atom, inverted),
        no = d.compile(e, atom, !inverted)
      if (!yes)
        ruleError('RULE_CONTRADICTION', at + '/' + i, 'No assignment satisfies this condition.', {
          expression: describe(e)
        })
      return { yes, no }
    })
    const removed = new Set()
    for (let i = 0; i < terms.length; i++)
      for (let j = i + 1; j < terms.length; j++) {
        const a = terms[i],
          b = terms[j],
          same = a.yes === b.yes && a.no === b.no
        const overlap = d.apply('and', a.yes, b.yes)
        const refs = new Set(atoms(items[i]))
        if (!atoms(items[j]).some((k) => refs.has(k))) continue
        const op = kind === 'all' ? 'and' : 'or',
          dual = kind === 'all' ? 'or' : 'and'
        const yes = d.apply(op, a.yes, b.yes),
          no = d.apply(dual, a.no, b.no)
        const redundant = yes === a.yes && no === a.no ? j : yes === b.yes && no === b.no ? i : null
        if (!overlap && !same) continue
        if (at === '/rules' && !same && redundant === null) overlaps.push([i, j])
        const example = d.witness(d.apply('and', d.apply('or', a.yes, b.yes), d.not(d.apply('and', a.yes, b.yes))))
        warnings.push({
          kind: same ? 'duplicate' : redundant !== null ? 'covered' : 'overlap',
          path: at,
          first: i,
          second: j,
          witness: d.witness(overlap),
          ...(example ? { operatorChangeWitness: example } : {}),
          before: [describe(items[i]), describe(items[j])],
          merge: redundant === null ? '保留完整分组与关联条件' : '可删除被覆盖项 ' + redundant,
          risk: same
            ? '等价合并会移除重复项的标识或位置。'
            : '更换 AND/OR 会改变放行范围；遇到 NOT 必须保留取反范围。删除全终态检查可能在前序尚未结束时提前放行。'
        })
        if (redundant !== null && !removed.has(i) && !removed.has(j)) removed.add(redundant)
      }
    merges.set(at, removed)
  }
  inspect(
    rows.map((r) => r.when),
    '/rules',
    'any'
  )
  function simplify(e, path) {
    if (e.node) return e
    if (e.not) return { not: simplify(e.not, path + '/not') }
    const kind = e.all ? 'all' : 'any',
      at = path + '/' + kind
    const items = e[kind].flatMap((c, i) => (merges.get(at)?.has(i) ? [] : [simplify(c, at + '/' + i)]))
    return items.length === 1 ? items[0] : { [kind]: items }
  }
  const survivors = rows.map((row, i) =>
    merges.get('/rules')?.has(i) ? null : { ...row, when: simplify(row.when, '/rules/' + i) }
  )
  const components = new Map(survivors.flatMap((row, i) => (row ? [[i, new Set([i])]] : [])))
  for (const [first, second] of overlaps) {
    const left = components.get(first),
      right = components.get(second)
    if (!left || !right || left === right) continue
    for (const i of right) {
      left.add(i)
      components.set(i, left)
    }
  }
  const merged = []
  for (const members of new Set(components.values())) {
    const selected = [...members].sort((a, b) => a - b).map((i) => survivors[i])
    const first = selected[0]
    if (selected.length === 1) {
      merged.push(first)
      continue
    }
    const oneSource = first.when.node && selected.every((row) => row.when.node === first.when.node)
    const when = oneSource
      ? { node: first.when.node, in: outcomes.filter((v) => selected.some((row) => row.when.in.includes(v))) }
      : { any: selected.map((row) => row.when) }
    merged.push({ id: first.id, when })
  }
  return { warnings, merged, witness: rows.length ? d.witness(d.compile({ any: rows.map((r) => r.when) }, atom)) : {} }
}

// An executed node may PASS or FAILED. BLOCK is derived from the entry condition
// and the group's terminal. It is never an independent symbolic choice.
export function graphWitnesses(plan) {
  const d = new Decisions(['FAILED', 'PASS']),
    nodes = new Map(plan.nodes.map((n) => [n.key, n]))
  const byId = new Map(plan.nodes.map((n) => [n.id, n])),
    entries = new Map(),
    results = new Map(),
    stack = new Set()
  const memo = (cache, n, kind, build) => {
    if (cache.has(n.key)) return cache.get(n.key)
    const id = kind + ':' + n.key
    if (stack.has(id))
      ruleError('RULE_CYCLE', '/rules', 'Rule dependencies must form an acyclic graph.', { node: n.key })
    stack.add(id)
    const value = build()
    stack.delete(id)
    cache.set(n.key, value)
    return value
  }
  const allowedResult = (expr, inverted) => {
    const accepted = inverted ? outcomes.filter((value) => !expr.in.includes(value)) : expr.in
    return accepted.reduce((value, outcome) => d.apply('or', value, result(nodes.get(expr.node))[outcome]), 0)
  }
  const entry = (n) =>
    memo(entries, n, 'entry', () => {
      const parent = n.parent ? entry(byId.get(n.parent)) : 1
      return d.apply('and', parent, n.rules?.length ? d.compile({ any: n.rules.map((r) => r.when) }, allowedResult) : 1)
    })
  const result = (n) =>
    memo(results, n, 'result', () => {
      let available = entry(n)
      if (n.terminal && plan.hierarchy?.version !== 2) available = d.apply('and', available, d.not(result(byId.get(n.terminal)).BLOCK))
      return {
        PASS: d.apply('and', available, d.atom(n.key, ['PASS'])),
        FAILED: d.apply('and', available, d.atom(n.key, ['FAILED'])),
        BLOCK: d.not(available)
      }
    })
  const witnesses = Object.create(null)
  for (const n of nodes.values()) {
    for (const row of n.rules ?? []) {
      const proof = d.compile(row.when, allowedResult)
      if (!d.apply('and', proof, n.parent ? entry(byId.get(n.parent)) : 1))
        ruleError(
          'RULE_ROUTE_UNREACHABLE',
          '/nodes/' + n.key + '/rules/' + row.id,
          'No execution of the declared predecessor graph opens this route.',
          { rule: describe(row.when) }
        )
    }
    const proof = entry(n)
    if (!proof) ruleError('RULE_NODE_UNREACHABLE', '/nodes/' + n.key, 'No graph-consistent route opens this node.')
    witnesses[n.key] = d.witness(proof)
  }
  return witnesses
}

const compiledPlans = new WeakMap()
function compiledPlan(plan) {
  let compiled = compiledPlans.get(plan)
  if (!compiled) {
    const nodes = new Map(plan.nodes.map((node) => [node.key, node]))
    const byId = new Map(plan.nodes.map((node) => [node.id, node]))
    const predicates = new Map(
      plan.nodes
        .filter((node) => node.rules?.length)
        .map((node) => [node.id, { any: node.rules.map((rule) => rule.when) }])
    )
    compiled = { nodes, byId, predicates }
    compiledPlans.set(plan, compiled)
  }
  return compiled
}
export function runtimeRules(state) {
  const { nodes, byId, predicates } = compiledPlan(state.plan)
  const entries = new Map(),
    results = new Map()
  const entry = (n) => {
    if (entries.has(n.id)) return entries.get(n.id)
    const parent = n.parent ? entry(byId.get(n.parent)) : true
    let value = parent
    if (parent === true && predicates.has(n.id)) value = evaluate(predicates.get(n.id), (k) => outcome(nodes.get(k)))
    entries.set(n.id, value)
    return value
  }
  const outcome = (n) => {
    if (results.has(n.id)) return results.get(n.id)
    const leaf = state.leaves[n.id],
      group = state.hierarchy.groups[n.id]
    let value = null
    if (leaf?.status === 'COMPLETE' || group?.outcome === 'PASS') value = 'PASS'
    else if (leaf?.disposition === 'FAILED' || group?.outcome === 'FAILED') value = 'FAILED'
    else if (entry(n) === false || (state.plan.hierarchy?.version !== 2 && n.terminal && outcome(byId.get(n.terminal)) === 'BLOCK')) value = 'BLOCK'
    results.set(n.id, value)
    return value
  }
  function projectedOutcome(node) {
    const actual = outcome(node)
    if (actual !== null) return actual
    for (let ancestor = byId.get(node.parent); ancestor; ancestor = byId.get(ancestor.parent)) {
      if (outcome(ancestor) === 'BLOCK') return 'BLOCK'
    }
    return null
  }
  return {
    outcome: (id) => projectedOutcome(byId.get(id)),
    entry: (id) => entry(byId.get(id)),
    branch(id) {
      if (projectedOutcome(byId.get(id)) === 'BLOCK') return 'NOT_SELECTED'
      return entry(byId.get(id)) === null ? 'WAITING' : 'SELECTED'
    },
    unmet(id) {
      const n = byId.get(id)
      return entry(n) === true
        ? []
        : [...new Set((n.rules ?? []).flatMap((r) => atoms(r.when)))]
            .filter((k) => outcome(nodes.get(k)) == null)
            .map((k) => nodes.get(k).id)
    }
  }
}
