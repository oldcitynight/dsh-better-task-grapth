// SPDX-License-Identifier: GPL-3.0-only
// The native staged form addresses flat field names. Keep nested profile operations
// on their individual paths so a save cannot replace an unrelated sibling.
export function configFormScope(scope, fields) {
  const paths = new Map(fields.map(f => [f.key, f.key.split('.')]))
  const project = values => {
    if (values === undefined) return undefined
    const result = {}
    for (const [key, path] of paths) {
      let node = values
      for (const part of path) node = node && typeof node === 'object' && Object.hasOwn(node, part) ? node[part] : undefined
      if (node !== undefined) result[key] = node
    }
    return result
  }
  return {
    subscribe: listener => scope.subscribe(listener),
    getSnapshot() {
      const snapshot = scope.getSnapshot()
      const value = project(snapshot.value), user = project(snapshot.user)
      // Some optional sections normalize an explicit null to a missing effective value.
      for (const [key, entry] of Object.entries(user ?? {}))
        if (value && value[key] === undefined && entry === null) value[key] = null
      return { ...snapshot, value, base: project(snapshot.base), user }
    },
    mutate(ops, revision) {
      // Apply whole-section edits first so an explicitly edited child wins in the same save.
      const changes = ops.map(op => ({ ...op, path: paths.get(op.path[0]) }))
      return scope.mutate(changes.sort((a, b) => a.path.length - b.path.length), revision)
    },
  }
}

export function fieldSpec(field) {
  return {
    field: field.key,
    format(value) {
      if (value === undefined) return ''
      return field.type === 'json' ? JSON.stringify(value, null, 2) : String(value)
    },
    parse(text) {
      if (!text.trim()) return { kind: 'clear' }
      let value = text.trim()
      if (field.type === 'json') {
        try { value = JSON.parse(text) } catch { return undefined }
      } else if (field.type === 'boolean') {
        if (!['true', 'false'].includes(value)) return undefined
        value = value === 'true'
      } else if (field.type === 'integer' || field.type === 'number') {
        if (field.nullable && value === 'null') value = null
        else {
          value = Number(value)
          if (!Number.isFinite(value) || (field.type === 'integer' && !Number.isSafeInteger(value))) return undefined
          if (field.min !== undefined && value < field.min || field.max !== undefined && value > field.max) return undefined
        }
      } else if (field.choices && !field.choices.includes(value)) return undefined
      else if (field.type === 'multiline') value = text
      return { kind: 'set', value }
    },
  }
}

export function installConfigCard(ctx, React, primitives, options) {
  const { SettingsForm, SettingsFormModel, Button } = primitives ?? {}
  if (!ctx.inject || !SettingsFormModel) return
  const { id, title, en, description, groups, order } = options
  ctx.inject(['configForms', 'locale'], scoped => {
    const h = React.createElement, locale = 'settings.' + id
    scoped.effect(() => scoped.locale.register(locale, { zh: { title }, en: { title: en } }))
    const fields = groups.flatMap(group => group.fields)
    const form = new SettingsFormModel(configFormScope(scoped.configForms.get(id), fields), fields.map(fieldSpec))
    const store = form.bind(() => ({ ...form.shell(), fields: Object.fromEntries(fields.map(f => [f.key, form.field(f.key)])) }))
    scoped.effect(() => () => form.dispose())
    function Card(props) {
      const state = props.usePluginConfig(snapshot => snapshot)
      if (props.view === 'summary') return description
      function control(field) {
        const { text, invalid, overridden } = state.fields[field.key]
        const inputId = id + '-' + field.key
        const common = { id: inputId, value: text, disabled: !state.writable, 'aria-invalid': invalid,
          onChange: event => props.edit(field.key, event.target.value),
          style: { width: '100%', boxSizing: 'border-box', color: 'inherit', background: 'var(--dsw-alias-bg-base, transparent)',
            border: '1px solid var(--dsw-alias-border-primary, #8888)', borderRadius: 6, padding: 8 } }
        const choices = field.choices ?? (field.type === 'boolean' ? ['true', 'false'] : null)
        const input = choices ? h('select', common,
          h('option', { value: '' }, '沿用默认'),
          ...choices.map((value, i) => h('option', { key: value, value }, field.labels?.[i] ?? ({ true: '开启', false: '关闭' }[value] ?? value))))
          : ['json', 'multiline'].includes(field.type) ? h('textarea', { ...common, rows: 4, spellCheck: false })
          : h('input', { ...common, type: 'text', inputMode: field.type === 'integer' && !field.nullable ? 'numeric' : undefined })
        return h('div', { key: field.key, style: { margin: '12px 0' } },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
            h('label', { htmlFor: inputId }, field.label),
            h('small', { style: { opacity: 0.7, overflowWrap: 'anywhere' } }, field.key),
            overridden && h(Button, { size: 'small', variant: 'ghost', disabled: !state.writable, onClick: () => props.resetField(field.key) }, '恢复默认')),
          input, field.hint && h('small', null, field.hint), invalid && h('p', { role: 'alert' }, '请检查输入格式。'))
      }
      return h(SettingsForm, { state, onSave: props.save, onDiscard: props.discard,
        labels: { unavailable: '插件尚未加载。', readOnly: '当前部署只读。', saveFailed: '保存失败，请检查配置组合或重新加载最新设置。',
          save: '保存', saving: '保存中…' } }, h('p', null, description), ...groups.map((group, i) =>
          h('details', { key: group.title, open: i === 0 ? true : undefined, style: { margin: '12px 0' } },
            h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, group.title), ...group.fields.map(control))))
    }
    scoped.effect(() => scoped.configForms.whileServed([id], () => scoped.slots.inject('plugins.item', () => scoped.slots.register({
      name: 'plugins.item', id, order, label: () => scoped.locale.bind(locale)('title'), locale,
      inject: () => ({ hooks: { pluginConfig: store }, ...form.actions() }),
    }, Card))))
  })
}

export function configField(key, label, type = 'text', options = {}) {
  return { key, label, type, ...options }
}
export const unitLimitFields = [
  configField('workflowLimits.maxUnits', '全图单元总数（含根）', 'integer', { min: 1 }),
  configField('workflowLimits.maxDepth', '递归深度', 'integer', { min: 0 }),
  configField('workflowLimits.preloadBytes', '预装上下文合计字节数', 'integer', { min: 0 }),
  configField('workflowLimits.dynamicMaterialBytes', '动态材料转摘要的字节数', 'integer', { min: 0 }),
]
