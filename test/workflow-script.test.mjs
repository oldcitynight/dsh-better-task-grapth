// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { FlowRegistry } from '../workflow-sdk.mjs'

test('static stage discovery and cancellation cover module evaluation', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-esm-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'program.mjs')
  const entered = Promise.withResolvers(),
    resume = Promise.withResolvers()
  const marker = Symbol.for('dsh.test.static-stage-evaluation')
  globalThis[marker] = { entered, resume }
  t.after(() => {
    resume.resolve()
    delete globalThis[marker]
  })
  await fs.writeFile(
    file,
    `const gate = globalThis[Symbol.for('dsh.test.static-stage-evaluation')]
gate.entered.resolve()
await gate.resume.promise
export const stages = { UPDATE() {} }
`
  )
  const registry = new FlowRegistry({
    defaults: { betweenUnits() {}, version: 'test' },
    scripts: { betweenUnits: file }
  })
  const ac = new AbortController()
  const checking = registry.hasStage('UPDATE', {}, ac.signal)
  await entered.promise
  const error = Error('User interrupted')
  ac.abort(error)
  await assert.rejects(checking, (e) => e === error)
  resume.resolve()
  assert.equal(await registry.hasStage('UPDATE'), true)
  assert.equal(await registry.hasStage('FINAL_REPORT'), false)
})
test('a bound lazy import reads its original helper after another selection', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-lazy-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const root = path.join(dir, 'main.mjs'),
    helper = path.join(dir, 'helper.mjs')
  await fs.writeFile(root, "export async function runUnit(){return (await import('./helper.mjs')).value}")
  await fs.writeFile(helper, 'export const value = true')
  const registry = new FlowRegistry({ defaults: {}, scripts: { runUnit: root } })
  const old = await registry.select('runUnit', { roles: [] })
  await fs.writeFile(helper, 'export const value = false')
  const current = await registry.select('runUnit', { roles: [] })
  assert.equal(await old.instance.run(), true)
  assert.equal(await current.instance.run(), false)
  await assert.rejects(registry.restore(old.binding), { code: 'FLOW_BOUND_SCRIPT_CHANGED' })
})
