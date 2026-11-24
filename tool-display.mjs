// SPDX-License-Identifier: GPL-3.0-only
export const graphToolNames = {
  transaction_graph_read: ['读取事务图', 'Read transaction graph'],
  transaction_graph_create: ['创建事务图', 'Create transaction graph'],
  transaction_graph_begin: ['开始事务', 'Begin transaction'],
  transaction_graph_finish: ['结束事务', 'Finish transaction'],
  transaction_graph_skip: ['跳过事务', 'Skip transaction'],
}

function resultText(block) {
  const parts = block.content.map(part => part.type === 'text' ? part.text : JSON.stringify(part, null, 2))
  if (!parts.length && block.error) return block.error.message || [block.error.name, block.error.code].filter(Boolean).join(': ')
  return parts.join('\n')
}

function argumentPreview(raw) {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    const first = parsed && typeof parsed === 'object' && Object.values(parsed).find(value => typeof value === 'string' && value)
    return { parsed, summary: first || raw }
  } catch {
    return { summary: raw }
  }
}

// Both captured Direct calls and native calls arrive through the DSH toolview slot.
export function createWorkflowToolDisplay(React, primitives) {
  const translations = new Map()
  const label = toolId => translations.get(toolId)?.(toolId) ?? toolId
  const h = React.createElement
  function ToolView({ toolName, phase, block, useDisclosure, inspect, t }) {
    const { expanded, toggle } = useDisclosure()
    const settled = phase === 'result'
    let state = phase === 'start' ? 'running' : 'preparing'
    if (settled) state = block.error?.code === 'interrupted' ? 'stopped' : block.isError ? 'error' : 'ok'
    const args = settled ? block.call?.argsRaw : block.argsRaw
    const preview = React.useMemo(() => argumentPreview(args), [args])
    const open = expanded && phase !== 'preparing'
    const output = React.useMemo(() => settled && (open || state === 'error') ? resultText(block) : '', [block, open, settled, state])
    const description = block.args?.text('description') || preview.summary || (phase !== 'preparing' && block.callId)
    const summary = String((state === 'error' && output) || description || '').split('\n', 1)[0]
    const code = (value, lang) => h(primitives.CodeBlock, { code: value, lang, copyLabel: t('copy'), copiedLabel: t('copied'), wrap: true })
    const status = { preparing: 'row.preparing', running: 'row.running', error: 'row.failed', stopped: 'row.stopped' }[state]
    return h('div', { 'data-tool': toolName, 'data-state': state, 'data-variant': 'others' },
      h(primitives.DisclosureRow, {
        title: label(toolName), open, onToggle: toggle, expandable: phase !== 'preparing', expandOnRowClick: true,
        keepContentWhenOpen: true,
        running: !settled, icon: h(primitives.IconSparkleRegular, { size: 14 }),
        collapsedContent: h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          [status && t(status), summary].filter(Boolean).join(' · ')),
      }, open && h('div', { style: { paddingInlineStart: 20 } },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
          h('code', { translate: 'no', dir: 'ltr', style: { userSelect: 'all', overflowWrap: 'anywhere' } }, toolName),
          h('button', { type: 'button', onClick: () => primitives.writeClipboard(toolName), 'aria-label': t('copy') + ' ' + toolName }, t('copy'))),
        args && h('div', null, t('row.input'), code(preview.parsed === undefined ? args : JSON.stringify(preview.parsed, null, 2), 'json')),
        output && h('div', null, t('row.output'), code(output, 'text')),
        inspect && h('button', { type: 'button', onClick: inspect }, t('row.inspect')))))
  }
  return {
    label,
    register(ctx, namespace, names) {
      const ids = Object.keys(names)
      const zh = {}, en = {}
      for (const id of ids) [zh[id], en[id]] = names[id]
      ctx.effect(() => {
        const unregister = ctx.locale.register(namespace, { zh, en })
        const translate = ctx.locale.bind(namespace)
        for (const id of ids) translations.set(id, translate)
        return () => {
          for (const id of ids) if (translations.get(id) === translate) translations.delete(id)
          unregister()
        }
      })
      ctx.slots.inject('tool.call.toolview', function* () {
        // A specialized view at the DSH default priority (0) takes precedence.
        for (const key of ids)
          yield ctx.slots.register({ name: 'tool.call.toolview', key, locale: 'conversation', priority: 100 }, ToolView)
      })
    },
  }
}
