// SPDX-License-Identifier: GPL-3.0-only
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'acorn'

const checksum = (source) => createHash('sha256').update(source).digest('hex')
const local = (s) => /^(?:\.\.?\/|\/|file:)/.test(s)
const tag = '__dsh_workflow_binding'
const snapshots = new Map()
let hooks
function fail(code, detail) {
  throw Object.assign(new Error(code + ': ' + detail), { code })
}

// Parse real ESM syntax, including re-exports, cycles and literal lazy imports.
function dependencies(source) {
  const stack = [parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true })]
  const found = new Set()
  let computed = false
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    if (node.type === 'ImportExpression' && node.source.type !== 'Literal') computed = true
    if (
      node.source?.type === 'Literal' &&
      typeof node.source.value === 'string' &&
      ['ImportDeclaration', 'ImportExpression', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(
        node.type
      )
    )
      found.add(node.source.value)
    for (const value of Object.values(node))
      if (value && typeof value === 'object') Array.isArray(value) ? stack.push(...value) : stack.push(value)
  }
  return { localImports: [...found].filter(local), computed }
}
function tagged(href, key) {
  const hash = href.indexOf('#')
  const address = hash < 0 ? href : href.slice(0, hash)
  return address + (address.includes('?') ? '&' : '?') + tag + '=' + key + (hash < 0 ? '' : href.slice(hash))
}
// Keep the query and fragment byte-for-byte: URLSearchParams would re-encode
// valid module identities such as ?name=two%20words when removing our tag.
function boundUrl(url) {
  if (!url?.startsWith('file:')) return
  const hash = url.indexOf('#')
  const address = hash < 0 ? url : url.slice(0, hash)
  const match = /[?&]__dsh_workflow_binding=([a-f0-9]{64})$/.exec(address)
  const records = match && snapshots.get(match[1])
  if (records)
    return { key: match[1], href: address.slice(0, match.index) + (hash < 0 ? '' : url.slice(hash)), records }
}
function installHooks() {
  hooks ??= registerHooks({
    resolve(specifier, context, next) {
      const bound = boundUrl(specifier)
      if (bound?.records.has(bound.href)) return { url: specifier, shortCircuit: true }
      if (!local(specifier)) return next(specifier, context)
      const parent = boundUrl(context.parentURL)
      if (!parent) return next(specifier, context)
      const href = new URL(specifier, parent.href).href
      if (!parent.records.has(href)) fail('FLOW_SCRIPT_DEPENDENCY_UNBOUND', href)
      return { url: tagged(href, parent.key), shortCircuit: true }
    },
    load(url, context, next) {
      const bound = boundUrl(url)
      if (!bound) return next(url, context)
      const item = bound.records.get(bound.href)
      if (!item) fail('FLOW_SCRIPT_DEPENDENCY_UNBOUND', bound.href)
      return { format: item.format, source: item.source, shortCircuit: true }
    }
  })
}
// The logical URLs used by Node remain those of the original deployment. The
// reader may instead supply bytes from a relocated release or a sealed archive.
async function collect(entry, read, expected, archived = false, signal, include = []) {
  const pending = [entry, ...include],
    records = new Map()
  for (const href of pending) {
    signal?.throwIfAborted()
    if (records.has(href)) continue
    const url = new URL(href)
    if (url.searchParams.has(tag)) fail('FLOW_SCRIPT_RESERVED_PARAMETER', href)
    const format = url.pathname.endsWith('.json') ? 'json' : 'module'
    const source = await read(url)
    const hash = checksum(source)
    if (
      expected &&
      (href === entry ? expected.hash !== hash : !archived && expected.dependencies?.[href] !== hash)
    )
      fail('FLOW_BOUND_SCRIPT_CHANGED', href)
    records.set(href, { source, hash, format })
    if (format === 'module') {
      const { localImports, computed } = dependencies(source.toString('utf8'))
      if (
        (localImports.length || computed) &&
        expected &&
        !Object.hasOwn(expected, 'dependencies') &&
        !archived
      )
        fail('FLOW_LEGACY_SCRIPT_ARCHIVE_REQUIRED', entry)
      for (const specifier of localImports) pending.push(new URL(specifier, href).href)
    }
  }
  signal?.throwIfAborted()
  return records
}

const archiveFormat = 'dsh-workflow-script-archive-v1'
function relativeFile(root, file) {
  const relative = path.relative(root, file)
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
    fail('FLOW_SCRIPT_ARCHIVE_OUTSIDE_ROOT', file)
  return relative
}

// Capture only the local import closure. Packing and verifying it execute no module.
export async function createWorkflowScriptArchive({
  sourceRoot,
  originalRoot = sourceRoot,
  entry,
  include = []
}) {
  const root = path.resolve(originalRoot),
    source = await realpath(sourceRoot)
  const file = path.resolve(root, entry),
    href = pathToFileURL(file).href
  const extras = [...new Set(include.map((name) => pathToFileURL(path.resolve(root, name)).href))].sort()
  const records = await collect(
    href,
    async (url) => {
      const relative = relativeFile(root, fileURLToPath(url))
      const physical = await realpath(path.join(source, relative))
      relativeFile(source, physical)
      return readFile(physical)
    },
    undefined,
    false,
    undefined,
    extras
  )
  const files = [...records.keys()].sort().map((url) => [url, records.get(url).source.toString('base64')])
  const bytes = Buffer.from(
    JSON.stringify({ format: archiveFormat, entry: href, include: extras, files }) + '\n'
  )
  return { bytes, sha256: checksum(bytes), file, entryHash: records.get(href).hash, files: files.length }
}

function unpackArchive(entry, recovery) {
  const { bytes, sha256 } = recovery
  if (!(bytes instanceof Uint8Array) || checksum(bytes) !== sha256)
    fail('FLOW_SCRIPT_ARCHIVE_HASH_MISMATCH', entry)
  let data
  try {
    data = JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch {
    fail('FLOW_SCRIPT_ARCHIVE_INVALID', entry)
  }
  if (data?.format !== archiveFormat || data.entry !== entry || !Array.isArray(data.files))
    fail('FLOW_SCRIPT_ARCHIVE_INVALID', entry)
  const files = new Map()
  for (const item of data.files) {
    if (
      !Array.isArray(item) ||
      item.length !== 2 ||
      typeof item[0] !== 'string' ||
      typeof item[1] !== 'string' ||
      files.has(item[0])
    )
      fail('FLOW_SCRIPT_ARCHIVE_INVALID', entry)
    const source = Buffer.from(item[1], 'base64')
    if (source.toString('base64') !== item[1]) fail('FLOW_SCRIPT_ARCHIVE_INVALID', item[0])
    files.set(item[0], source)
  }
  const include = data.include ?? []
  if (
    !Array.isArray(include) ||
    include.some((url) => typeof url !== 'string' || !url.startsWith('file:') || !files.has(url))
  )
    fail('FLOW_SCRIPT_ARCHIVE_INVALID', entry)
  return { files, include }
}

export async function workflowScript(file, expected, recovery, signal) {
  const entry = pathToFileURL(file).href
  if (recovery && (!expected || expected.kind !== 'script' || Object.hasOwn(expected, 'dependencies')))
    fail('FLOW_SCRIPT_ARCHIVE_NOT_APPLICABLE', entry)
  const archived = recovery && unpackArchive(entry, recovery)
  if (recovery?.previous) {
    const previous = unpackArchive(entry, recovery.previous)
    if (
      previous.files.size >= archived.files.size ||
      [...previous.files].some(([url, bytes]) => !archived.files.get(url)?.equals(bytes))
    )
      fail('FLOW_SCRIPT_ARCHIVE_NOT_EXTENSION', entry)
  }
  const records = await collect(
    entry,
    async (url) => {
      if (archived) {
        if (!archived.files.has(url.href)) fail('FLOW_SCRIPT_ARCHIVE_INCOMPLETE', url.href)
        return archived.files.get(url.href)
      }
      try {
        return await readFile(url)
      } catch (error) {
        if (!expected) throw error
        if (!Object.hasOwn(expected, 'dependencies') && error.code === 'ENOENT')
          fail('FLOW_LEGACY_SCRIPT_ARCHIVE_REQUIRED', file)
        fail('FLOW_BOUND_SCRIPT_CHANGED', url.href)
      }
    },
    expected,
    !!archived,
    signal,
    archived?.include
  )
  if (archived && archived.files.size !== records.size) fail('FLOW_SCRIPT_ARCHIVE_UNREFERENCED_MODULE', entry)
  const manifest = Object.fromEntries(
    [...records.keys()]
      .filter((k) => k !== entry)
      .sort()
      .map((k) => [k, records.get(k).hash])
  )
  if (
    expected &&
    !archived &&
    JSON.stringify(Object.entries(expected.dependencies ?? {}).sort()) !==
      JSON.stringify(Object.entries(manifest).sort())
  )
    fail('FLOW_BOUND_SCRIPT_CHANGED', file)
  const binding = { hash: records.get(entry).hash, dependencies: manifest }
  // For v1 bindings the operator's selection must be recorded before top-level
  // module evaluation, which can itself call external code or be interrupted.
  if (archived) recovery.onVerified?.(records.size)
  const key = checksum(JSON.stringify([entry, binding]))
  if (!snapshots.has(key)) snapshots.set(key, records)
  installHooks()
  return { module: await import(tagged(entry, key)), binding }
}
