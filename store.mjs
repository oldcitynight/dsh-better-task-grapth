// SPDX-License-Identifier: GPL-3.0-only
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { GraphError, canonical, copy, validateDocument } from './core.mjs'

const reject = (code, message = code) => { throw new GraphError(code, message) }
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino
function checkRevision(expectedRevision, previous) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) reject('INVALID_REVISION')
  if ((previous?.revision ?? 0) !== expectedRevision) reject('CAS_CONFLICT')
}
function checkNext(previous, next) {
  validateDocument(next)
  if (next.revision !== (previous?.revision ?? 0) + 1 || next.events.length !== (previous?.events.length ?? 0) + 1)
    reject('ONE_EVENT_PER_CAS_REQUIRED')
  if (previous && canonical(next.events.slice(0, -1)) !== canonical(previous.events)) reject('HISTORY_IMMUTABLE')
}
function syncDirectory(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY)
  try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}
function regularBytes(file) {
  let fd
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
  try {
    const before = fs.fstatSync(fd)
    if (!before.isFile() || before.size < 1) reject('INVALID_STORE_FILE')
    const buffer = Buffer.alloc(before.size + 1)
    let count = 0
    while (count < buffer.length) {
      const read = fs.readSync(fd, buffer, count, buffer.length - count, null)
      if (!read) break
      count += read
    }
    const after = fs.fstatSync(fd)
    if (!sameFile(before, after) || count !== before.size || after.size !== count || before.mtimeMs !== after.mtimeMs)
      reject('STORE_CHANGED_DURING_READ')
    return buffer.subarray(0, count)
  } finally { fs.closeSync(fd) }
}
function regularJson(file) {
  const bytes = regularBytes(file)
  return bytes && JSON.parse(bytes.toString('utf8'))
}

export class MemoryGraphStore {
  constructor(document = null) { if (document) validateDocument(document); this.document = document ? copy(document) : null }
  read() { return this.document ? copy(this.document) : null }
  compareAndSwap(expectedRevision, update) {
    const previous = this.read()
    checkRevision(expectedRevision, previous)
    const next = update(previous ? copy(previous) : null)
    checkNext(previous, next)
    this.document = copy(next)
    return this.read()
  }
}

// Explicit projectRoot and a new/private directory are mandatory. No default DB.
// All components below projectRoot must be real directories, never symlinks.
// This is application path validation, not isolation from a hostile same-user OS.
export class FileGraphStore {
  #validatedRead = null
  constructor({ projectRoot, directory, fileName = 'transaction-graph.json',
    codec, validator = validateDocument, updateValidator = checkNext, readOnly = false, reuseValidatedReads = false }) {
    if (!/^[a-z][a-z0-9.-]{0,63}$/.test(fileName) || typeof validator !== 'function' || typeof updateValidator !== 'function') reject('INVALID_STORE_POLICY')
    this.validator = validator; this.updateValidator = updateValidator
    this.codec = codec
    this.readOnly = readOnly
    this.reuseValidatedReads = reuseValidatedReads
    if (typeof projectRoot !== 'string' || typeof directory !== 'string'
        || !path.isAbsolute(projectRoot) || !path.isAbsolute(directory)) reject('EXPLICIT_ABSOLUTE_STORE_ROOT_REQUIRED')
    this.projectRoot = path.resolve(projectRoot)
    this.directory = path.resolve(directory)
    if (fs.realpathSync(this.projectRoot) !== this.projectRoot || !fs.lstatSync(this.projectRoot).isDirectory()) reject('INVALID_PROJECT_ROOT')
    const relative = path.relative(this.projectRoot, this.directory)
    if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) reject('STORE_OUTSIDE_PROJECT')
    let cursor = this.projectRoot
    for (const component of relative.split(path.sep)) {
      cursor = path.join(cursor, component)
      if (!readOnly) {
        try { fs.mkdirSync(cursor, { mode: 0o700 }); syncDirectory(path.dirname(cursor)) }
        catch (error) { if (error.code !== 'EEXIST') throw error }
      }
      const info = fs.lstatSync(cursor)
      if (info.isSymbolicLink() || !info.isDirectory()) reject('STORE_SYMLINK_OR_NOT_DIRECTORY')
    }
    this.rootIdentity = fs.lstatSync(this.projectRoot)
    this.directoryIdentity = fs.lstatSync(this.directory)
    this.file = path.join(this.directory, fileName)
    this.lock = path.join(this.directory, '.transaction-graph.lock')
    this.checkDirectory()
  }
  checkDirectory() {
    const root = fs.lstatSync(this.projectRoot), directory = fs.lstatSync(this.directory)
    if (!sameFile(root, this.rootIdentity) || !sameFile(directory, this.directoryIdentity)
        || !root.isDirectory() || !directory.isDirectory() || directory.isSymbolicLink()
        || fs.realpathSync(this.projectRoot) !== this.projectRoot || fs.realpathSync(this.directory) !== this.directory)
      reject('STORE_DIRECTORY_IDENTITY_CHANGED')
    let cursor = this.projectRoot
    for (const part of path.relative(this.projectRoot, this.directory).split(path.sep)) {
      cursor = path.join(cursor, part)
      const info = fs.lstatSync(cursor)
      if (info.isSymbolicLink() || !info.isDirectory()) reject('STORE_SYMLINK_OR_NOT_DIRECTORY')
    }
  }
  read() {
    this.checkDirectory()
    const bytes = regularBytes(this.file)
    this.checkDirectory()
    if (!bytes) { this.#validatedRead = null; return null }
    const stored = JSON.parse(bytes.toString('utf8'))
    const document = this.codec ? this.codec.decode(stored) : stored
    if (document) {
      // Only content-dependent validators may opt in. Always read the current
      // bytes through the secure store, and never return a shared parsed object.
      const hash = this.reuseValidatedReads ? createHash('sha256').update(bytes).digest('hex') : null
      if (!hash || this.#validatedRead?.hash !== hash || this.#validatedRead.validator !== this.validator) {
        this.validator(document)
        this.#validatedRead = hash ? { hash, validator: this.validator } : null
      }
    }
    return document
  }
  compareAndSwap(expectedRevision, update) {
    return this.#commit(expectedRevision, update)
  }
  // An extension can durably prepare its own commit record after the generic
  // compare-and-swap has checked both the candidate and its transition.
  compareAndSwapPrepared(expectedRevision, update, prepare) {
    if (typeof prepare !== 'function') reject('INVALID_STORE_COMMIT_PREPARATION')
    return this.#commit(expectedRevision, update, prepare)
  }
  #commit(expectedRevision, update, prepare) {
    if (this.readOnly) reject('READ_ONLY_TRANSACTION_STORE')
    this.checkDirectory()
    try { fs.mkdirSync(this.lock, { mode: 0o700 }) }
    catch (error) { if (error.code === 'EEXIST') reject('CAS_LOCK_BUSY_NO_AUTOMATIC_STEAL'); throw error }
    const lockIdentity = fs.lstatSync(this.lock), token = randomUUID()
    const ownerFile = path.join(this.lock, 'owner.json')
    let temporary = null, temporaryIdentity = null, ownerWritten = false
    try {
      const ownerFd = fs.openSync(ownerFile, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
      try { fs.writeFileSync(ownerFd, JSON.stringify({ token })); fs.fsyncSync(ownerFd); ownerWritten = true } finally { fs.closeSync(ownerFd) }
      syncDirectory(this.lock)
      const previous = this.read()
      checkRevision(expectedRevision, previous)
      const next = update(previous ? copy(previous) : null)
      if (next && typeof next.then === 'function') reject('ASYNC_STORE_UPDATE_FORBIDDEN')
      this.validator(next)
      this.updateValidator(previous, next)
      const content = JSON.stringify(this.codec ? this.codec.encode(next) : next) + '\n'
      if (prepare && prepare(copy(previous), copy(next))?.then) reject('ASYNC_STORE_COMMIT_PREPARATION')
      temporary = path.join(this.directory, '.transaction-graph-' + randomUUID() + '.tmp')
      const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
      try { temporaryIdentity = fs.fstatSync(fd); fs.writeFileSync(fd, content); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      this.checkDirectory()
      if (!sameFile(lockIdentity, fs.lstatSync(this.lock)) || regularJson(ownerFile)?.token !== token) reject('LOCK_OWNERSHIP_CHANGED')
      // One rename commits plan, state and events together; no separate stale snapshot.
      fs.renameSync(temporary, this.file); temporary = null
      syncDirectory(this.directory)
      return copy(next)
    } finally {
      if (temporary && temporaryIdentity) {
        try { if (sameFile(temporaryIdentity, fs.lstatSync(temporary))) fs.unlinkSync(temporary) }
        catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      // Never recursively remove a lock or infer that a previous owner is dead.
      if (!sameFile(lockIdentity, fs.lstatSync(this.lock)) || (ownerWritten && regularJson(ownerFile)?.token !== token))
        reject('LOCK_OWNERSHIP_CHANGED')
      if (ownerWritten) fs.unlinkSync(ownerFile)
      fs.rmdirSync(this.lock)
      syncDirectory(this.directory)
    }
  }
}
