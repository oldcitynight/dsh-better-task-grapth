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
  if (source !== patched) {
    const tmp = file + '.' + randomUUID() + '.tmp'
    fs.writeFileSync(tmp, patched); fs.renameSync(tmp, file)
  }
  return { version: pkg.version, file, upstreamSHA256: digest(restored), patchedSHA256: digest(patched), changed: source !== patched }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw Error('Usage: node patch-native-host.mjs /path/to/runtime/node_modules')
  process.stdout.write(JSON.stringify(patchNativeHost(path.resolve(process.argv[2]))) + '\n')
}
