import test from 'node:test'
import assert from 'node:assert/strict'
import { installGraphCommand } from '../commands.mjs'
import { SessionPolicies } from '../extensions.mjs'

function fixture() {
  let definition
  const messages = [], agent = { id: 'root', session: {}, steer: message => messages.push(message) }
  const ctx = { agents: { get: () => agent, roots: () => [agent] },
    inject: (_names, setup) => setup({ commands: { register: value => { definition = value } } }) }
  const host = { inProject: () => true, presence: () => ({ state: 'NEVER_CREATED' }) }
  const policies = new SessionPolicies()
  installGraphCommand(ctx, host, policies)
  const invoke = rawInput => definition.handler({ agent, rawInput, commandId: 'cmd-1', signal: new AbortController().signal })
  return { ctx, agent, host, policies, messages, invoke, get definition() { return definition } }
}

test('standalone command requests a graph without an extension or a task-size decision', async () => {
  const f = fixture()
  assert.equal(f.definition.name, 'task-graph')
  assert.equal((await f.invoke(' fix a single config')).kind, 'success')
  assert.equal(f.messages.length, 1)
  assert.equal(f.messages[0].source.kind, 'user')
  assert.match(f.messages[0].content[0].text, /fix a single config/)
  assert.match(f.messages[0].content[0].text, /不受任务规模判断限制/)
  assert.match(f.messages[0].content[0].text, /遵守当前规划模式/)
})

test('missing historical graphs and unsupported agents do not enqueue execution', async () => {
  const f = fixture()
  f.host.presence = () => ({ state: 'LOST_AFTER_COMMIT' })
  assert.equal((await f.invoke('')).kind, 'error')
  f.ctx.agents.roots = () => []
  assert.equal((await f.invoke('')).kind, 'error')
  assert.deepEqual(f.messages, [])
})

test('the sole optional extension owns the command and unregistering restores standalone behavior', async () => {
  const f = fixture()
  const dispose = f.policies.register({ id: 'extension', allowClassic: () => false,
    onRequestGraph: () => ({ kind: 'success', text: 'extension-owned' }) })
  assert.equal((await f.invoke('')).text, 'extension-owned')
  assert.deepEqual(f.messages, [])
  assert.throws(() => f.policies.register({ id: 'other', allowClassic: () => true,
    onRequestGraph() {} }), /SESSION_GRAPH_REQUEST_PROVIDER_ALREADY_REGISTERED/)
  dispose()
  assert.equal((await f.invoke('')).kind, 'success')
  assert.equal(f.messages.length, 1)
})

test('an extension failure or ambiguous result cannot fall through to standalone', async () => {
  const f = fixture()
  const dispose = f.policies.register({ id: 'bad', allowClassic: () => true, onRequestGraph: () => undefined })
  await assert.rejects(f.invoke(''), /SESSION_GRAPH_REQUEST_RESULT_REQUIRED/)
  dispose()
  f.policies.register({ id: 'failure', allowClassic: () => true, onRequestGraph: () => { throw new Error('selection failed') } })
  await assert.rejects(f.invoke(''), /selection failed/)
  assert.deepEqual(f.messages, [])
})
