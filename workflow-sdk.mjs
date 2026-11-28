// SPDX-License-Identifier: GPL-3.0-only
import { workflowScript } from './workflow-script.mjs'
export { createWorkflowScriptArchive } from './workflow-script.mjs'
import { digest } from './core.mjs'
export const hooks = Object.freeze(['runUnit', 'betweenUnits', 'onBlockage', 'onUserInput'])
export const stages = Object.freeze([
  'UPDATE',
  'UPDATE_AUDIT',
  'BASELINE_WRITE',
  'BASELINE_REVIEW',
  'BASELINE_AUDIT',
  'REPAIR_RESULT',
  'FINAL_REPORT'
])
const providerKey = (hook, stage, row) => JSON.stringify([hook, stage ?? null, keyOf(row)])
export function flowError(code, detail) {
  return Object.assign(new Error(code + (detail ? ' — ' + detail : '')), { code })
}
export function immutable(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(immutable)
    Object.freeze(value)
  }
  return value
}
export function jsonValue(value) {
  const copy = JSON.stringify(value, (_key, v) => {
    if (
      typeof v === 'function' ||
      typeof v === 'symbol' ||
      typeof v === 'undefined' ||
      (typeof v === 'number' && !Number.isFinite(v))
    )
      throw flowError('FLOW_JSON_REQUIRED')
    return v
  })
  if (copy === undefined) throw flowError('FLOW_JSON_REQUIRED')
  return JSON.parse(copy)
}
const validId = (v) => typeof v === 'string' && v.trim() === v && v.length > 0
const keyOf = (r) => JSON.stringify([r.pluginId, r.id, r.version])
const compare = (a, b) => b.priority - a.priority || (keyOf(a) < keyOf(b) ? -1 : 1)
const callable = (value) =>
  typeof value === 'function' ? { run: value } : value && typeof value.run === 'function' ? value : null
async function interruptible(start, signal) {
  signal?.throwIfAborted()
  if (!signal) return start()
  let abort
  try {
    const stopped = new Promise((_, reject) => {
      abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
    })
    return await Promise.race([
      stopped,
      Promise.resolve().then(() => {
        signal.throwIfAborted()
        return start()
      })
    ])
  } finally {
    signal.removeEventListener('abort', abort)
  }
}
export class FlowRegistry {
  #providers = new Map()
  #channels = new Map()
  registerExternal({ pluginId, id, version, send, reconcile, idempotent = false }) {
    if (
      ![pluginId, id, version].every(validId) ||
      typeof send !== 'function' ||
      (reconcile !== undefined && typeof reconcile !== 'function') ||
      typeof idempotent !== 'boolean'
    )
      throw flowError('FLOW_EXTERNAL_INVALID')
    const key = keyOf({ pluginId, id, version })
    if (this.#channels.has(key)) throw flowError('FLOW_EXTERNAL_DUPLICATE')
    const entry = Object.freeze({ pluginId, id, version, send, reconcile, idempotent })
    this.#channels.set(key, entry)
    return () => {
      if (this.#channels.get(key) === entry) this.#channels.delete(key)
    }
  }
  external(target) {
    const entry = this.#channels.get(keyOf(target))
    if (!entry) throw flowError('FLOW_BOUND_EXTERNAL_UNAVAILABLE')
    return entry
  }

  constructor({ defaults, scripts = {}, deadlineMs = 1000 }) {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) throw flowError('FLOW_DEADLINE_INVALID')
    this.defaults = defaults
    this.scripts = scripts
    this.deadlineMs = deadlineMs
  }
  register({
    pluginId,
    id,
    version,
    hook,
    stage,
    priority = 0,
    scope = {},
    enabled = false,
    offer,
    restore
  }) {
    if (
      ![pluginId, id, version].every(validId) ||
      !hooks.includes(hook) ||
      (stage !== undefined && (hook !== 'betweenUnits' || !stages.includes(stage))) ||
      !Number.isSafeInteger(priority) ||
      typeof enabled !== 'boolean' ||
      typeof offer !== 'function' ||
      typeof restore !== 'function' ||
      !scope ||
      Object.entries(scope).some(([k, v]) => !['workflowId', 'scopeId'].includes(k) || !validId(v))
    )
      throw flowError('FLOW_PROVIDER_INVALID')
    const row = { pluginId, id, version, hook, stage, priority, scope: { ...scope }, enabled, offer, restore }
    const key = providerKey(hook, stage, row)
    if (this.#providers.has(key)) throw flowError('FLOW_PROVIDER_DUPLICATE')
    this.#providers.set(key, row)
    return {
      setEnabled: (value) => {
        if (typeof value !== 'boolean') throw flowError('FLOW_BOOLEAN_REQUIRED')
        row.enabled = value
      },
      dispose: () => {
        if (this.#providers.get(key) === row) this.#providers.delete(key)
      }
    }
  }
  async hasStage(stage, scope = {}, signal) {
    signal?.throwIfAborted()
    if (
      [...this.#providers.values()].some(
        (row) =>
          row.enabled &&
          row.stage === stage &&
          Object.entries(row.scope).every(([key, value]) => scope[key] === value)
      )
    )
      return true
    if (!this.scripts.betweenUnits) return false
    return (
      (
        await interruptible(
          () => this.#script('betweenUnits', this.scripts.betweenUnits, stage, undefined, undefined, signal),
          signal
        )
      ).binding.kind === 'script'
    )
  }
  async #script(hook, file, stage, expected, recovery, signal) {
    if (!file) {
      const fn = this.defaults[hook]
      if (typeof fn !== 'function') throw flowError('FLOW_DEFAULT_MISSING', hook)
      return {
        instance: { run: fn },
        binding: { kind: 'bundle', hook, ...(stage ? { stage } : {}), version: this.defaults.version }
      }
    }
    const loaded = await workflowScript(file, expected, recovery, signal)
    const mod = loaded.module,
      fn = stage ? mod.stages?.[stage] : mod[hook]
    if (
      fn === undefined &&
      (stage || (hook === 'betweenUnits' && mod.stages && typeof mod.stages === 'object'))
    )
      return this.#script(hook, undefined, stage)
    if (typeof fn !== 'function') throw flowError('FLOW_EXPORT_MISSING', hook)
    const roles = (stage ? mod.requiredStageRoles?.[stage] : mod.requiredRoles?.[hook]) ?? []
    if (!Array.isArray(roles) || roles.some((id) => !validId(id)))
      throw flowError('FLOW_ROLE_MANIFEST_INVALID')
    const choice = {
      instance: { run: fn },
      roles,
      binding: { kind: 'script', hook, ...(stage ? { stage } : {}), file, ...loaded.binding }
    }
    return choice
  }
  async select(hook, input, signal, reader = {}) {
    if (!hooks.includes(hook)) throw flowError('FLOW_HOOK_UNKNOWN')
    signal?.throwIfAborted()
    const base = immutable(structuredClone(input))
    const stage = base.event?.kind === 'stage' ? base.event.stage : undefined
    if (stage !== undefined && (hook !== 'betweenUnits' || !stages.includes(stage)))
      throw flowError('FLOW_STAGE_UNKNOWN')
    const rows = [...this.#providers.values()]
      .filter(
        (r) =>
          r.enabled &&
          r.hook === hook &&
          r.stage === stage &&
          Object.entries(r.scope).every(([k, v]) => v === base[k])
      )
      .sort(compare)
    const controller = new AbortController(),
      abort = () => controller.abort(signal.reason)
    signal?.addEventListener('abort', abort, { once: true })
    const emptyPage = ({ cursor = 0, through = 0 } = {}) => ({ rows: [], cursor, through })
    const readers = {
      list: emptyPage,
      events: emptyPage,
      read: () => {
        throw flowError('FLOW_MATERIAL_NOT_VISIBLE')
      },
      ...reader
    }
    const view = Object.freeze({
      ...base,
      ...Object.fromEntries(
        Object.entries(readers).map(([name, fn]) => [
          name,
          (...args) => {
            controller.signal.throwIfAborted()
            return immutable(structuredClone(fn(...args)))
          }
        ])
      )
    })
    const errors = []
    let timer
    try {
      const results = new Map()
      const offers = rows.map(async (row) => {
        if (controller.signal.aborted) return
        try {
          const value = await row.offer(view, controller.signal)
          if (value == null || controller.signal.aborted) return
          const instance = callable(value.instance)
          if (!instance) throw flowError('FLOW_INSTANCE_INVALID')
          const binding = {
            kind: 'provider',
            hook,
            ...(stage ? { stage } : {}),
            pluginId: row.pluginId,
            id: row.id,
            version: row.version,
            params: jsonValue(value.binding ?? null)
          }
          const roles = value.requiredRoles ?? []
          if (!Array.isArray(roles) || roles.some((id) => !view.roles?.includes(id)))
            throw flowError('FLOW_PROFILE_ROLE_UNKNOWN')
          results.set(row, { instance, binding, roles })
        } catch (error) {
          if (!controller.signal.aborted) errors.push({ id: row.id, code: error.code ?? 'FLOW_OFFER_FAILED' })
        }
      })
      if (rows.length && !controller.signal.aborted)
        await Promise.race([
          Promise.all(offers),
          new Promise((resolve) => {
            controller.signal.addEventListener('abort', resolve, { once: true })
            timer = setTimeout(() => controller.abort('FLOW_SELECTION_DEADLINE'), this.deadlineMs)
          })
        ])
      signal?.throwIfAborted()
      const chosen = rows.find((row) => results.has(row))
      return {
        ...(chosen
          ? results.get(chosen)
          : await interruptible(
              () => this.#script(hook, this.scripts[hook], stage, undefined, undefined, signal),
              signal
            )),
        diagnostics: errors
      }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      controller.abort()
    }
  }
  async restore(binding, signal, recovery) {
    signal?.throwIfAborted()
    const { hook, kind } = binding
    if (recovery && (kind !== 'script' || Object.hasOwn(binding, 'dependencies')))
      throw flowError('FLOW_SCRIPT_ARCHIVE_NOT_APPLICABLE')
    if (kind === 'provider') {
      const row = this.#providers.get(providerKey(hook, binding.stage, binding))
      if (!row) throw flowError('FLOW_BOUND_PROVIDER_UNAVAILABLE', binding.id)
      const instance = callable(
        await interruptible(() => row.restore(immutable(structuredClone(binding.params)), signal), signal)
      )
      if (!instance) throw flowError('FLOW_BOUND_PROVIDER_UNAVAILABLE', binding.id)
      return instance
    }
    const choice = await interruptible(
      () =>
        this.#script(
          hook,
          kind === 'script' ? binding.file : undefined,
          binding.stage,
          kind === 'script' ? binding : undefined,
          recovery,
          signal
        ),
      signal
    )
    if (
      kind === 'bundle' &&
      this.defaults.compatibleVersions?.includes(binding.version) &&
      digest({ ...binding, version: choice.binding.version }) === digest(choice.binding)
    )
      return choice.instance
    // An old single-file script has no manifest. A verified recovery archive
    // can also supply the missing manifest of a legacy multi-file binding.
    const saved =
      kind === 'script' && !Object.hasOwn(binding, 'dependencies') && choice.binding.kind === 'script'
        ? { ...binding, dependencies: recovery ? choice.binding.dependencies : {} }
        : binding
    if (digest(choice.binding) !== digest(saved)) throw flowError('FLOW_BOUND_SCRIPT_CHANGED', hook)
    return choice.instance
  }
}
// A program re-enters at its first statement. Only calls through this object
// cross the checkpoint boundary. The store atomically commits each receipt.
export class ManagedSteps {
  #position = 0
  #busy = false
  constructor(store, invocationId) {
    this.store = store
    this.id = invocationId
  }
  async perform(op, args, action, { key, managed = false, atomic = false } = {}) {
    if (this.#busy) throw flowError('FLOW_CONCURRENT_STEPS')
    this.#busy = true
    try {
      const index = this.#position++,
        stepId = key ?? String(index)
      const hash = digest([index, op, jsonValue(args)]),
        requestId = digest([this.id, stepId])
      const previous = this.store.step(this.id, stepId)
      if (previous && previous.hash !== hash) throw flowError('FLOW_REPLAY_DIVERGED', stepId)
      if (previous?.phase === 'done') return structuredClone(previous.value)
      if (previous && !managed && !atomic) throw flowError('FLOW_EFFECT_UNKNOWN', requestId)
      // A file-backed graph can commit before its separate journal transaction. Keep
      // the operation identity durable so recovery can find the graph's own receipt.
      if (!previous) this.store.start(this.id, stepId, hash)
      if (atomic)
        return this.store.atomic(this.id, stepId, hash, (transaction) => action(requestId, transaction))
      const result = await action(requestId)
      const value = jsonValue(result ?? null)
      this.store.finish(this.id, stepId, hash, value)
      return structuredClone(value)
    } finally {
      this.#busy = false
    }
  }
  get count() {
    return this.#position
  }
}
