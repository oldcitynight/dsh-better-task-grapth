// SPDX-License-Identifier: GPL-3.0-only
import { GraphError } from './core.mjs'

export const EXTENSION_CONTRACT = 'dsh-taskgraph-session-extension-v1'

/** Optional host extensions may suppress the classic interface per session.
 * Policy, interaction and extension data belong to the registering plugin.
 * With no provider, the original classic interface is unchanged.
 */
export class SessionPolicies {
  constructor() { this.providers = new Map(); this.closed = false }
  register({ id, allowClassic, onRequestGraph }) {
    if (this.closed || typeof id !== 'string' || !/^[a-z][a-z0-9_-]{0,79}$/.test(id)
        || typeof allowClassic !== 'function' || this.providers.has(id)
        || onRequestGraph !== undefined && typeof onRequestGraph !== 'function') throw new GraphError('SESSION_EXTENSION_CONTRACT_REQUIRED')
    if (onRequestGraph && [...this.providers.values()].some(entry => entry.onRequestGraph))
      throw new GraphError('SESSION_GRAPH_REQUEST_PROVIDER_ALREADY_REGISTERED')
    const entry = { allowClassic, onRequestGraph }; this.providers.set(id, entry)
    return () => { if (this.providers.get(id) === entry) this.providers.delete(id) }
  }
  allowClassic(agent) {
    if (this.closed) return false
    for (const provider of this.providers.values()) if (provider.allowClassic(agent) !== true) return false
    return true
  }
  async requestGraph(invocation) {
    if (this.closed) throw new GraphError('SESSION_EXTENSION_CLOSED')
    invocation.signal?.throwIfAborted()
    const provider = [...this.providers.values()].find(entry => entry.onRequestGraph)
    if (!provider) return undefined
    const result = await provider.onRequestGraph(invocation)
    invocation.signal?.throwIfAborted()
    if (this.closed || ![...this.providers.values()].includes(provider)) throw new GraphError('SESSION_EXTENSION_CLOSED')
    // Once an extension owns the request, failure cannot fall through and
    // silently select the classic graph mode.
    if (!result || !['success', 'error'].includes(result.kind)) throw new GraphError('SESSION_GRAPH_REQUEST_RESULT_REQUIRED')
    return result
  }
  close() { this.closed = true; this.providers.clear() }
}
