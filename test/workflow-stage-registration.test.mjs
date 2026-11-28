// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict'
import test from 'node:test'
import { FlowRegistry } from '../workflow-sdk.mjs'
test('stage offers are opted in, scoped, prioritized and restore the exact registration', async () => {
  const events = []
  const registry = new FlowRegistry({ defaults: { betweenUnits: async () => {}, version: 'fixture' } })
  const provider = (stage, priority = 0, id = 'same') => ({
    pluginId: 'fixture',
    id,
    version: 'one',
    priority,
    hook: 'betweenUnits',
    stage,
    enabled: true,
    offer: () => {
      events.push(stage)
      return { instance: async () => {}, binding: { selected: stage ?? null } }
    },
    restore: (p) => async () => p.selected
  })
  registry.register(provider(undefined))
  registry.register(provider('UPDATE'))
  registry.register(provider('UPDATE', 2, 'alternate'))
  registry.register(provider('UPDATE_AUDIT'))
  assert.throws(() => registry.register(provider('missing')), { code: 'FLOW_PROVIDER_INVALID' })
  assert.throws(() => registry.register({ ...provider('UPDATE'), hook: 'runUnit' }), {
    code: 'FLOW_PROVIDER_INVALID'
  })
  const view = { workflowId: 'one', scopeId: 'root', roles: [] }
  const pick = await registry.select('betweenUnits', { ...view, event: { kind: 'stage', stage: 'UPDATE' } })
  assert.equal(pick.binding.id, 'alternate')
  assert.deepEqual(events, ['UPDATE', 'UPDATE'])
  const replay = await registry.restore(pick.binding)
  assert.equal(await replay.run(), 'UPDATE')
  events.length = 0
  await registry.select('betweenUnits', { ...view, event: { kind: 'proposal' } })
  assert.deepEqual(events, [undefined])
})
