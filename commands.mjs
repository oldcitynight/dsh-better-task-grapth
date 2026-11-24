// SPDX-License-Identifier: GPL-3.0-only
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { scopeChainOf } from '@deepseek-ai/dsh-scope'
const controller = (ctx, agent) => agent.session.header.origin !== 'subagent'
  && !(agent.session.header.delegationDepth > 0)
  && !scopeChainOf(agent).slice(1).some(key => key.id !== undefined && ctx.agents.get(key.id) === key)

/** A human entry point. Extensions own their choices and orchestration. */
export function installGraphCommand(ctx, host, policies) {
  ctx.inject(['commands'], commandCtx => {
    commandCtx.commands.register({
      definitionId: 'dsh-better-task-grapth:task-graph', name: 'task-graph',
      description: '主动要求使用任务图；安装联动扩展时进入执行方式选择。',
      input: { hint: '任务说明（可留空，沿用当前任务）' },
      handler: async invocation => {
        const { agent, signal, rawInput } = invocation
        signal.throwIfAborted()
        if (host.closed || ctx.agents.get(agent.id) !== agent || !controller(ctx, agent)
            || !host.inProject(agent.session))
          return { kind: 'error', text: '请在受支持项目的主会话内使用 /task-graph。' }
        const extended = await policies.requestGraph(invocation)
        if (extended !== undefined) return extended
        signal.throwIfAborted()
        if (!policies.allowClassic(agent)) return { kind: 'error', text: '当前扩展未开放独立任务图入口，请先核对会话状态。' }
        const presence = host.presence(agent.session)
        if (!['PRESENT', 'NEVER_CREATED'].includes(presence.state))
          return { kind: 'error', text: `任务图状态为 ${presence.state}，请先处理待提交记录或恢复历史图；本指令不会重建或重放。` }
        host.journal(agent.session, { start: true })
        agent.steer(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text:
          `请使用任务图处理${rawInput.trim() ? '以下任务：\n' + rawInput.trim() : '当前任务。'}\n这是通过 /task-graph 主动提出的要求，不受任务规模判断限制。先读取已有图；无图时规划任务图，不用原生清单替代。已有图时沿用其进度，不重新创建。仍遵守当前规划模式和具体操作权限；只有用户实际要求暂停或等候时才停在相应边界，不推定本指令要求等待批准。若尚无具体任务，先询问任务内容。` }] }))
        return { kind: 'success', text: '已向当前 Agent 提交任务图要求，沿用独立任务图流程。' }
      },
    })
  })
}
