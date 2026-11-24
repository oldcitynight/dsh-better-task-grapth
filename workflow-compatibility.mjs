// SPDX-License-Identifier: GPL-3.0-only
import fs from 'node:fs'
import semver from 'semver'

function reject(code, message, details) {
  throw Object.assign(new Error(code + ': ' + message), { code, details })
}

const validEpoch = value => Number.isSafeInteger(value) && value > 0
const validVersion = value => typeof value === 'string' && /^[0-9]/.test(value)
  && value.trim() === value && semver.valid(value) !== null

export function releaseFromManifests(entries) {
  const pluginVersions = {}
  let workflowCompatibilityEpoch
  for (const [name, manifest] of entries) {
    if (manifest?.name !== name || !validVersion(manifest.version))
      reject('DIRECT_INVALID_PLUGIN_VERSION', 'Invalid installed package version for ' + name)
    if (!validEpoch(manifest.workflowCompatibilityEpoch))
      reject('WORKFLOW_INVALID_COMPATIBILITY_EPOCH', 'Invalid installed compatibility epoch for ' + name)
    if (workflowCompatibilityEpoch !== undefined && workflowCompatibilityEpoch !== manifest.workflowCompatibilityEpoch)
      reject('WORKFLOW_COMPATIBILITY_EPOCH_MISMATCH', 'Installed plugins declare different compatibility epochs', { name, expected: workflowCompatibilityEpoch, observed: manifest.workflowCompatibilityEpoch })
    workflowCompatibilityEpoch = manifest.workflowCompatibilityEpoch
    pluginVersions[name] = manifest.version
  }
  return { workflowCompatibilityEpoch, pluginVersions }
}

export function installedGraphRelease() {
  return releaseFromManifests([['dsh-better-task-grapth', JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'))]])
}

export function validateFrozenRelease(saved, names) {
  const expected = saved?.pluginVersions
  if (!validEpoch(saved?.workflowCompatibilityEpoch) || !expected || typeof expected !== 'object'
      || Array.isArray(expected) || Object.keys(expected).length !== names.length
      || names.some(name => !Object.hasOwn(expected, name) || !validVersion(expected[name])))
    reject('WORKFLOW_INVALID_FROZEN_RELEASE', 'Invalid frozen plugin identity')
}

// Compare each package independently. Build metadata has no precedence in SemVer.
export function needsReleaseUpdate(saved, installed) {
  if (saved === undefined) return true
  const observed = installed.pluginVersions
  validateFrozenRelease(saved, Object.keys(observed))
  const expected = saved.pluginVersions
  if (saved.workflowCompatibilityEpoch !== installed.workflowCompatibilityEpoch)
    reject('WORKFLOW_COMPATIBILITY_EPOCH_MISMATCH', 'The workflow and installed plugins have different compatibility epochs', { expected: saved, observed: installed })
  let newer = false
  for (const name of Object.keys(observed)) {
    const order = semver.compare(observed[name], expected[name])
    if (order < 0)
      reject('WORKFLOW_PLUGIN_DOWNGRADE', name + ' requires at least ' + expected[name] + ', installed ' + observed[name], { name, expected: saved, observed: installed })
    if (order > 0) newer = true
  }
  return newer
}
