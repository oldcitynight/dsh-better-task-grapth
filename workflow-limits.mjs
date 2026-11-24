// SPDX-License-Identifier: GPL-3.0-only
import defaults from './workflow-limits.json' with { type: 'json' }

export const defaultWorkflowLimits = Object.freeze(defaults)

export function resolveWorkflowLimits(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))
    throw new TypeError('INVALID_WORKFLOW_LIMITS')
  const limits = { ...defaults }
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(defaults, key) || !Number.isSafeInteger(value) || value < (key === 'maxUnits' ? 1 : 0))
      throw new TypeError('INVALID_WORKFLOW_LIMIT: ' + key)
    limits[key] = value
  }
  return Object.freeze(limits)
}
