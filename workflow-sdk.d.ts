export type Hook = 'runUnit' | 'betweenUnits' | 'onBlockage' | 'onUserInput'
export type Stage =
  | 'UPDATE'
  | 'UPDATE_AUDIT'
  | 'BASELINE_WRITE'
  | 'BASELINE_REVIEW'
  | 'BASELINE_AUDIT'
  | 'REPAIR_RESULT'
  | 'FINAL_REPORT'
export const stages: readonly Stage[]
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export interface PageRequest {
  cursor?: number
  through?: number
  limit?: number
  kinds?: string[]
}
export interface Entry {
  seq: number
  id: string
  scope: string
  kind: string
  preview?: string
  value?: Json
}
export interface Page {
  rows: Entry[]
  cursor: number
  through: number
}
export interface Event {
  kind: string
  scopeId?: string
  activeScopeId?: string | null
  guidanceId?: string
  stage?: Stage
  boundary?: string
  role?: string
  input?: Json
  unitId?: string
  proposal?: string
  outcome?: string | null
  request?: 'Require_PASS' | 'Require_Failed' | null
  gate?: string | null
  proposed?: string
  message?: Json
}
export interface OfferView {
  readonly workflowId: string
  readonly scopeId: string
  readonly version: string | null
  readonly hook: Hook
  readonly event: Event
  readonly roles: readonly string[]
  readonly units: readonly string[]
  list(options?: PageRequest): Page
  events(options?: PageRequest): Page
  read(id: string): Json
}
export type Instance<S = unknown> =
  | ((scope: S, event: Event) => unknown)
  | { run(scope: S, event: Event): unknown }
export interface Provider<S = unknown> {
  pluginId: string
  id: string
  version: string
  hook: Hook
  stage?: Stage
  priority?: number
  scope?: { workflowId?: string; scopeId?: string }
  enabled?: boolean
  offer(
    view: OfferView,
    signal: AbortSignal
  ):
    | null
    | { instance: Instance<S>; binding?: Json; requiredRoles?: string[] }
    | Promise<null | { instance: Instance<S>; binding?: Json; requiredRoles?: string[] }>
  restore(binding: Json, signal?: AbortSignal): Instance<S> | Promise<Instance<S>>
}
export type Binding =
  | { kind: 'bundle'; hook: Hook; stage?: Stage; version: string }
  | {
      kind: 'script'
      hook: Hook
      stage?: Stage
      file: string
      hash: string
      dependencies?: Record<string, string>
    }
  | {
      kind: 'provider'
      hook: Hook
      stage?: Stage
      pluginId: string
      id: string
      version: string
      params: Json
    }
export interface Program<S = unknown> {
  run(scope: S, event: Event): unknown
}
export interface Channel {
  pluginId: string
  id: string
  version: string
}
export interface Delivery {
  readonly id: string
  readonly workflowId: string
  readonly scope: string
  readonly payload: Json
}
export function createWorkflowScriptArchive(options: {
  sourceRoot: string
  originalRoot?: string
  entry: string
  include?: string[]
}): Promise<{ bytes: Uint8Array; sha256: string; file: string; entryHash: string; files: number }>
export interface LegacyScriptArchive {
  bytes: Uint8Array
  sha256: string
  previous?: { bytes: Uint8Array; sha256: string }
  onVerified?(files: number): void
}
export class FlowRegistry {
  constructor(options: {
    defaults: Record<Hook, Function> & { version: string; compatibleVersions?: readonly string[] }
    scripts?: Partial<Record<Hook, string>>
    deadlineMs?: number
  })
  hasStage(
    stage: Stage,
    scope?: { workflowId?: string; scopeId?: string },
    signal?: AbortSignal
  ): Promise<boolean>
  select<S = unknown>(
    hook: Hook,
    input: Omit<OfferView, 'list' | 'events' | 'read'>,
    signal?: AbortSignal,
    reader?: Pick<OfferView, 'list' | 'events' | 'read'>
  ): Promise<{
    instance: Program<S>
    binding: Binding
    roles?: string[]
    diagnostics: { id: string; code: string }[]
  }>
  restore<S = unknown>(
    binding: Binding,
    signal?: AbortSignal,
    recovery?: LegacyScriptArchive
  ): Promise<Program<S>>
  register<S>(provider: Provider<S>): { dispose(): void; setEnabled(value: boolean): void }
  registerExternal(
    channel: Channel & {
      idempotent?: boolean
      send(request: Delivery, signal?: AbortSignal): Json | Promise<Json>
      reconcile?(
        request: Delivery,
        signal?: AbortSignal
      ): Promise<{ state: 'complete'; value: Json } | { state: 'absent' | 'unknown' }>
    }
  ): () => void
}
export const hooks: readonly Hook[]
export function flowError(code: string, detail?: string): Error & { code: string }
export function jsonValue(value: unknown): Json
export function immutable<T>(value: T): Readonly<T>
