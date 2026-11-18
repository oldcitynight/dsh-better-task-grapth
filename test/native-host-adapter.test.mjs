import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { patchNativeHost } from '../scripts/patch-native-host.mjs'
const original = fs.readFileSync(fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-agent-preset-registry')), 'utf8')
  .replaceAll('(impl.fiber ?? impl.ctx?.fiber)', 'impl.fiber')
function fixture(t) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-preset-adapter-'))
 t.after(() => fs.rmSync(root, { recursive: true, force: true }))
 const dir = path.join(root, '@deepseek-ai/dsh-agent-preset-registry');fs.mkdirSync(path.join(dir, 'lib'), { recursive: true })
 fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '0.2.2-alpha.2' }))
 const file = path.join(dir, 'lib/index.js'); fs.writeFileSync(file, original)
 return { root, file, dir }
}
test('native preset preparation preserves both ownership checks and is idempotent', t => {
 const f=fixture(t);const first=patchNativeHost(f.root);assert.equal(first.changed,true)
 const body=fs.readFileSync(f.file,'utf8');assert.equal(body.split('(impl.fiber ?? impl.ctx?.fiber)').length,3)
 assert.equal(body.replaceAll('(impl.fiber ?? impl.ctx?.fiber)', 'impl.fiber'),original)
 assert.equal(patchNativeHost(f.root).changed,false)
})
test('native preset preparation refuses unknown versions, source changes and partial application', t => {
 const f=fixture(t);fs.writeFileSync(f.file,original.replace('impl.fiber','(impl.fiber ?? impl.ctx?.fiber)'))
 assert.throws(()=>patchNativeHost(f.root),/PARTIAL_PATCH/)
 fs.writeFileSync(f.file,original+'\n// local change');assert.throws(()=>patchNativeHost(f.root),/SOURCE_CHANGED/)
 fs.writeFileSync(path.join(f.dir,'package.json'),JSON.stringify({version:'0.2.2-alpha.3'}));assert.throws(()=>patchNativeHost(f.root),/VERSION_UNSUPPORTED/)
})
