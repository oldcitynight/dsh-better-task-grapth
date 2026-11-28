// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test'
import assert from 'node:assert/strict'
import { FlowRegistry } from '../workflow-sdk.mjs'

test('aborting inside the provider offer releases selection even when the offer stays pending', async () => {
  const ac = new AbortController()
  const error = new Error('operator cancelled')
  const registry = new FlowRegistry({ defaults: { runUnit: () => true, version: 'v1' }, deadlineMs: 10 })
  const slow = Promise.withResolvers()
  registry.register({
    pluginId: 'test',
    id: 'slow',
    version: '1',
    hook: 'runUnit',
    enabled: true,
    offer() {
      ac.abort(error)
      return slow.promise
    },
    restore() {
      return () => true
    }
  })
  let lateOffers = 0
  registry.register({
    pluginId: 'test',
    id: 'tail',
    version: '1',
    hook: 'runUnit',
    enabled: true,
    offer() {
      lateOffers++
      return null
    },
    restore: () => () => true
  })
  let timer
  try {
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('selection is still waiting')), 200)
    })
    await assert.rejects(
      Promise.race([registry.select('runUnit', { roles: [] }, ac.signal), deadline]),
      (e) => e === error
    )
  } finally {
    clearTimeout(timer)
    slow.resolve(null)
  }
  assert.equal(lateOffers, 0)
})

test('direct SDK selection without a host material reader has the declared empty page surface', async () => {
  const registry = new FlowRegistry({ defaults: { runUnit: () => false, version: '1' } })
  registry.register({
    pluginId: 'test',
    id: 'inspector',
    version: '1',
    hook: 'runUnit',
    enabled: true,
    offer(view) {
      assert.deepEqual(view.list(), { rows: [], cursor: 0, through: 0 })
      assert.deepEqual(view.events(), { rows: [], cursor: 0, through: 0 })
      assert.throws(() => view.read('missing'), { code: 'FLOW_MATERIAL_NOT_VISIBLE' })
      return { instance: () => true }
    },
    restore: () => () => true
  })
  const choice = await registry.select('runUnit', { roles: [] })
  assert.equal(choice.binding.kind, 'provider')
  assert.deepEqual(choice.diagnostics, [])
})

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createWorkflowScriptArchive } from '../workflow-sdk.mjs'

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function archivedFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'frozen-script-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const sourceRoot = path.join(directory, 'old source'),
    originalRoot = path.join(directory, 'original deployment')
  await fs.mkdir(sourceRoot)
  const entry = 'program.mjs',
    file = path.join(originalRoot, entry)
  const text =
    "import {result} from './helper.mjs?label=two%20words#test'\nexport function runUnit(){return result()}"
  await fs.writeFile(path.join(sourceRoot, entry), text)
  await fs.writeFile(
    path.join(sourceRoot, 'helper.mjs'),
    "import settings from './mode.json' with {type:'json'}\nexport function result(){return settings.pass}"
  )
  await fs.writeFile(path.join(sourceRoot, 'mode.json'), '{"pass":true}')
  return {
    sourceRoot,
    originalRoot,
    entry,
    file,
    directory,
    binding: { kind: 'script', hook: 'runUnit', file, hash: sha(text) }
  }
}

test('restore a true legacy entry from a relocated release, with three modules and no original deployment', async (t) => {
  const f = await archivedFixture(t)
  const sealed = await createWorkflowScriptArchive(f)
  assert.equal(sealed.files, 3)
  assert.equal(sealed.sha256, sha(sealed.bytes))
  const copied = path.join(f.directory, 'another copy')
  await fs.rename(f.sourceRoot, copied)
  assert.deepEqual(await createWorkflowScriptArchive({ ...f, sourceRoot: copied }), sealed)
  let count = 0
  const r = new FlowRegistry({ defaults: {} })
  const old = await r.restore(f.binding, undefined, {
    ...sealed,
    onVerified: (n) => {
      count = n
    }
  })
  assert.equal(count, 3)
  assert.equal(old.run(), true)
  await assert.rejects(r.restore(f.binding), { code: 'FLOW_LEGACY_SCRIPT_ARCHIVE_REQUIRED' })
})

test('old single-file bindings resume normally; modern empty manifests are ineligible for legacy adoption', async (t) => {
  const f = await archivedFixture(t)
  await fs.mkdir(f.originalRoot)
  const text = 'export function runUnit(){return true}'
  await fs.writeFile(f.file, text)
  const r = new FlowRegistry({ defaults: {}, scripts: { runUnit: f.file } })
  const fresh = (await r.select('runUnit', { roles: [] })).binding
  assert.deepEqual(fresh.dependencies, {})
  const { dependencies, ...legacy } = fresh
  assert.equal((await r.restore(legacy)).run(), true)
  const input = await createWorkflowScriptArchive({ ...f, sourceRoot: f.originalRoot })
  await assert.rejects(r.restore(fresh, undefined, input), { code: 'FLOW_SCRIPT_ARCHIVE_NOT_APPLICABLE' })
})

test('legacy recovery rejects wrong digests, entry identities, missing or extra files before recording', async (t) => {
  const f = await archivedFixture(t),
    sealed = await createWorkflowScriptArchive(f),
    r = new FlowRegistry({ defaults: {} })
  let persisted = 0
  const input = (change, wrongHash = false) => {
    const content = JSON.parse(sealed.bytes)
    change(content)
    const bytes = Buffer.from(JSON.stringify(content))
    return { bytes, sha256: wrongHash ? sealed.sha256 : sha(bytes), onVerified: () => persisted++ }
  }
  const cases = [
    [input(() => {}, true), 'FLOW_SCRIPT_ARCHIVE_HASH_MISMATCH'],
    [input((a) => (a.entry = pathToFileURL(f.directory).href)), 'FLOW_SCRIPT_ARCHIVE_INVALID'],
    [
      input((a) => (a.files = a.files.filter(([url]) => !url.endsWith('mode.json')))),
      'FLOW_SCRIPT_ARCHIVE_INCOMPLETE'
    ],
    [
      input((a) => a.files.push(['file:///outside-unused.mjs', ''])),
      'FLOW_SCRIPT_ARCHIVE_UNREFERENCED_MODULE'
    ],
    [input((a) => a.files.push(a.files[0])), 'FLOW_SCRIPT_ARCHIVE_INVALID'],
    [
      input(
        (a) =>
          (a.files.find(([url]) => url === a.entry)[1] = Buffer.from(
            'export const runUnit=()=>false'
          ).toString('base64'))
      ),
      'FLOW_BOUND_SCRIPT_CHANGED'
    ]
  ]
  for (const [recovery, code] of cases)
    await assert.rejects(r.restore(f.binding, undefined, recovery), { code })
  assert.equal(persisted, 0)
})

test('packing reads only the operator-selected tree and never evaluates top-level module code', async (t) => {
  const f = await archivedFixture(t)
  const entry = path.join(f.sourceRoot, f.entry),
    outside = path.join(f.directory, 'unrelated.mjs')
  await fs.writeFile(outside, 'export const value=1')
  await fs.symlink(outside, path.join(f.sourceRoot, 'dependency.mjs'))
  await fs.writeFile(entry, "import './dependency.mjs'; throw Error('never run during packing')")
  await assert.rejects(createWorkflowScriptArchive(f), { code: 'FLOW_SCRIPT_ARCHIVE_OUTSIDE_ROOT' })
  await fs.unlink(path.join(f.sourceRoot, 'dependency.mjs'))
  await fs.writeFile(path.join(f.sourceRoot, 'dependency.mjs'), 'export const value=1')
  assert.equal((await createWorkflowScriptArchive(f)).files, 2)
})

test('a computed local import can be restored from an explicitly listed original module', async (t) => {
  const f = await archivedFixture(t)
  const text =
    "export async function runUnit(){const name='helper';return (await import('./'+name+'.mjs')).result()}"
  await fs.writeFile(path.join(f.sourceRoot, f.entry), text)
  const binding = { ...f.binding, hash: sha(text) }
  const r = new FlowRegistry({ defaults: {} })
  const full = await createWorkflowScriptArchive({ ...f, include: ['helper.mjs'] })
  assert.equal(full.files, 3)
  assert.equal(await (await r.restore(binding, undefined, full)).run(), true)
  const incomplete = await createWorkflowScriptArchive(f)
  assert.equal(incomplete.files, 1)
  const standalone = await r.restore(binding, undefined, incomplete)
  await assert.rejects(standalone.run(), { code: 'FLOW_SCRIPT_DEPENDENCY_UNBOUND' })
})
