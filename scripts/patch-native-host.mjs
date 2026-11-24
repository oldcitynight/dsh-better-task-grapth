// SPDX-License-Identifier: GPL-3.0-only
// DSH alpha.2 predates Cordis' service-owner field move. Preserve the native
// ownership audit and support both layouts; never bypass or catch its rejection.
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
export const nativeHostHash = '915beda32ca891954505d8a5425e53893ce0579305fe9fb6dd3be921976b182c'
const digest = data => createHash('sha256').update(data).digest('hex')
const original = 'impl.fiber', replacement = '(impl.fiber ?? impl.ctx?.fiber)'
const bootHash = 'dbe13b8cbfe6a183efab4cb363bbcbc35e4ee171b5f8c798390d0371ca9ea4ff'
const bootChanges = [
  ['ctx.on("internal/update", (config, _, next) => {', 'ctx.on("internal/update", (config, next) => {'],
  ['ctx.on("internal/update", (_config, _noSave, next) => {', 'ctx.on("internal/update", (_config, next) => {'],
  ['Promise.resolve(next()).catch((error) => {', 'return Promise.resolve(next()).catch((error) => {'],
  ['this.root.update(this.applyPatches(this.data, config.patches)).catch((error) => {',
    'return this.root.update(this.applyPatches(this.data, config.patches)).catch((error) => {'],
]
function prepareBoot(modules) {
  const dir = path.join(modules, '@deepseek-ai/dsh-app-boot')
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  if (meta.version !== '0.2.2-alpha.2') throw Error('NATIVE_HOST_ADAPTER_VERSION_UNSUPPORTED:' + meta.version)
  const file = path.join(dir, 'lib/index.js'), source = fs.readFileSync(file, 'utf8')
  const restored = bootChanges.reduce((text, [from, to]) => text.replace(to, from), source)
  if (digest(restored) !== bootHash) throw Error('NATIVE_HOST_ADAPTER_SOURCE_CHANGED:app-boot')
  const patched = bootChanges.reduce((text, [from, to]) => text.replace(from, to), restored)
  if (source !== restored && source !== patched) throw Error('NATIVE_HOST_ADAPTER_PARTIAL_PATCH:app-boot')
  return { file, restored, patched, source }
}
function replacePrepared(file, patched) {
  const tmp = file + '.' + randomUUID() + '.tmp'
  fs.writeFileSync(tmp, patched)
  fs.renameSync(tmp, file)
}
export function patchNativeHost(modules) {
  const dir = path.join(modules, '@deepseek-ai/dsh-agent-preset-registry')
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  if (pkg.version !== '0.2.2-alpha.2') throw Error('NATIVE_HOST_ADAPTER_VERSION_UNSUPPORTED:' + pkg.version)
  const file = path.join(dir, 'lib/index.js'), source = fs.readFileSync(file, 'utf8')
  const restored = source.replaceAll(replacement, original)
  if (digest(restored) !== nativeHostHash) throw Error('NATIVE_HOST_ADAPTER_SOURCE_CHANGED')
  if (restored.split(original).length !== 3) throw Error('NATIVE_HOST_ADAPTER_LAYOUT_CHANGED')
  const patched = restored.replaceAll(original, replacement)
  if (source !== restored && source !== patched) throw Error('NATIVE_HOST_ADAPTER_PARTIAL_PATCH')
  const boot = prepareBoot(modules)
  if (boot.source !== boot.patched) replacePrepared(boot.file, boot.patched)
  if (source !== patched) replacePrepared(file, patched)
  return { version: pkg.version, file, upstreamSHA256: digest(restored), patchedSHA256: digest(patched),
    boot: { file: boot.file, upstreamSHA256: bootHash, patchedSHA256: digest(boot.patched) },
    changed: source !== patched || boot.source !== boot.patched }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw Error('Usage: node patch-native-host.mjs /path/to/runtime/node_modules')
  process.stdout.write(JSON.stringify(patchNativeHost(path.resolve(process.argv[2]))) + '\n')
}
