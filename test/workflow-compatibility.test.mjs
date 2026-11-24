// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installedGraphRelease, needsReleaseUpdate, releaseFromManifests } from '../workflow-compatibility.mjs'
import { HostJournal } from '../journal.mjs'

const graph = 'dsh-better-task-grapth', dynamic = 'dsh-dynamic-context'
const release = (a, b, epoch = 1) => ({ workflowCompatibilityEpoch: epoch, pluginVersions: { [dynamic]: a, [graph]: b } })

test('each package compares by SemVer precedence within exactly one common epoch', () => {
  const saved = release('1.0.0-rc.9', '0.3.1-rc.62+one')
  assert.equal(needsReleaseUpdate(saved, saved), false)
  assert.equal(needsReleaseUpdate(saved, release('1.0.0-rc.9', '0.3.1-rc.62+two')), false)
  assert.equal(needsReleaseUpdate(saved, release('1.0.0-rc.10', '0.3.1-rc.62')), true)
  assert.equal(needsReleaseUpdate(saved, release('1.0.0', '0.3.1')), true)
  assert.throws(() => needsReleaseUpdate(saved, release('2.0.0', '0.3.1-rc.8')), { code: 'WORKFLOW_PLUGIN_DOWNGRADE' })
  assert.throws(() => needsReleaseUpdate(saved, { ...saved, workflowCompatibilityEpoch: 2 }), { code: 'WORKFLOW_COMPATIBILITY_EPOCH_MISMATCH' })
  for (const broken of [null, {}, { ...saved, pluginVersions: { [graph]: '0.3.1' } }, release('invalid', '0.3.1')])
    assert.throws(() => needsReleaseUpdate(broken, saved), { code: 'WORKFLOW_INVALID_FROZEN_RELEASE' })
})

test('both package declarations must have matching positive integer epochs and valid versions', () => {
  const manifest = { name: graph, version: '1.0.0', workflowCompatibilityEpoch: 1 }
  for (const value of [undefined, '1', 0, -1, 1.5])
    assert.throws(() => releaseFromManifests([[graph, { ...manifest, workflowCompatibilityEpoch: value }]]), { code: 'WORKFLOW_INVALID_COMPATIBILITY_EPOCH' })
  for (const value of ['v1.2.3', 'local', '1.00.1', '1.2.3 '])
    assert.throws(() => releaseFromManifests([[graph, { ...manifest, version: value }]]), { code: 'DIRECT_INVALID_PLUGIN_VERSION' })
  assert.throws(() => releaseFromManifests([[graph, manifest], [dynamic, { ...manifest, name: dynamic, workflowCompatibilityEpoch: 2 }]]),
    { code: 'WORKFLOW_COMPATIBILITY_EPOCH_MISMATCH' })
})

test('a standalone graph freezes on entry, advances without a graph mutation and fences stale writers after reopening', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'standalone-release-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const options = { projectRoot: root, directory: path.join(root, 'journal'), binding: { sessionId: 'one' } }
  const first = new HostJournal(options)
  assert.equal(first.read().revision, 0)
  const previous = installedGraphRelease()
  const frozen = first.admitRelease(first.read())
  assert.deepEqual(frozen.workflowRelease, previous)
  assert.equal(first.admitRelease(frozen).revision, frozen.revision)
  const manifestUrl = new URL('../package.json', import.meta.url).href
  const original = fs.readFileSync.bind(fs), newer = '99.0.0-rc.10'
  const mock = t.mock.method(fs, 'readFileSync', (file, ...args) => file?.href === manifestUrl
    ? JSON.stringify({ name: graph, version: newer, workflowCompatibilityEpoch: 1 }) : original(file, ...args))
  const next = new HostJournal(options), upgraded = next.admitRelease(next.read())
  assert.equal(upgraded.workflowRelease.pluginVersions[graph], newer)
  assert.equal(upgraded.document, null)
  mock.mock.restore()
  const restarted = new HostJournal(options)
  assert.throws(() => restarted.admitRelease(restarted.read()), { code: 'WORKFLOW_PLUGIN_DOWNGRADE' })
  assert.throws(() => first.change(upgraded.revision, v => v), { code: 'WORKFLOW_PLUGIN_DOWNGRADE' })
  assert.deepEqual(restarted.read(), upgraded)
})
