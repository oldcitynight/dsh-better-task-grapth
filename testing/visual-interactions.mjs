import assert from 'node:assert/strict'
import path from 'node:path'
import { TransactionGraph } from '../core.mjs'
import { MemoryGraphStore } from '../store.mjs'
import { base, commitRevision, inserted, screen } from './unit-order-fixture.mjs'

const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const snapshot = page => page.evaluate(() => {
  const scroll = document.querySelector('.tg-canvas-scroll'), canvas = scroll.querySelector('.tg-canvas')
  return { left: scroll.scrollLeft, top: scroll.scrollTop, scale: canvas.style.transform,
    selected: document.querySelector('.tg-task-select').value }
})
async function cardVisible(page, id) {
  return page.evaluate(id => {
    const bounds = document.querySelector('.tg-canvas-scroll').getBoundingClientRect()
    const card = [...document.querySelectorAll('.tg-card')].find(card => card.dataset.nodeId === id).getBoundingClientRect()
    return card.left >= bounds.left && card.right <= bounds.right && card.top >= bounds.top && card.bottom <= bounds.bottom
  }, id)
}

export async function prepareUnitInsertion(page) {
  const graph = new TransactionGraph(new MemoryGraphStore())
  graph.create({ operationId: 'create', definition: base() })
  await page.addInitScript(snapshot => { window.visualInitialGraph = snapshot }, screen(graph))
  commitRevision(graph, inserted())
  return screen(graph)
}

export async function checkInteractions(page, row, output, revisedGraph) {
  const checks = []
  if (row.id === 'unit-insertion') {
    const tree = page.locator('.tg-tree .tg-node-name')
    const toggle = page.locator('.tg-header')
    assert.deepEqual(await tree.allTextContents(), ['root', 'a', 'c', 'd', 'end'])
    await toggle.click()
    await page.evaluate(snapshot => window.visual.setGraph(snapshot), revisedGraph)
    await tree.filter({ hasText: /^b$/ }).waitFor({ state: 'attached', timeout: 10000 })
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
    await toggle.click()
    const expected = ['a', 'b', 'c', 'd', 'end']
    assert.deepEqual(await tree.allTextContents(), ['root', ...expected])
    await page.locator('.tg-top button[aria-haspopup=dialog]').click()
    await page.locator('.tg-canvas-stage[data-view=level]').waitFor()
    assert.deepEqual(await page.locator('.tg-task-select option:not([disabled])').allTextContents(),
      expected.map((label, index) => (index + 1) + '. ' + label))
    assert.deepEqual(await page.locator('.tg-card-title').allTextContents(), expected)
    return ['collapsed dock receives revised positions', 'level selector and cards follow the same sequence']
  }
  if (row.surface !== 'viewer') {
    if (row.id === 'nested-panel') {
      assert.equal(await page.evaluate(() => {
        const body = document.querySelector('.tg-body').getBoundingClientRect()
        const active = document.querySelector('.tg-node[aria-current=step]').getBoundingClientRect()
        return active.top >= body.top && active.bottom <= body.bottom
      }), true, 'opening a deep tree reveals the active leaf')
      checks.push('deep active leaf visible')
    }
    return checks
  }
  const dialog = page.locator('dialog[open]')
  const active = await page.evaluate(() => window.visual.graph.active?.nodeId)
  if (active) { assert.equal(await cardVisible(page, active), true, 'initial camera shows the active task'); checks.push('active task visible') }

  if (row.id === 'hierarchy-root') {
    const original = await page.evaluate(() => JSON.stringify(window.visual.graph))
    assert.equal(await dialog.locator('.tg-group-frame').count(), 2)
    assert.equal(await dialog.locator('.tg-card').count(), 3)
    assert.equal(await dialog.locator('.tg-wire[data-edge-from=g1][data-edge-to=g2]').count(), 1)
    await dialog.getByRole('button', { name: '折叠 数据准备与迁移', exact: true }).click(); await settle(page)
    assert.equal(await dialog.locator('.tg-card[data-node-id=g1_work]').count(), 0)
    assert.equal(await dialog.locator('.tg-card[data-node-id=g2_end]').count(), 1)
    assert.equal(await dialog.locator('.tg-wire').count(), 1)
    await page.screenshot({ path: path.join(output, 'hierarchy-partial-collapse.png'), animations: 'disabled' })
    const navigation = await snapshot(page)
    await dialog.getByRole('button', { name: '刷新', exact: true }).click(); await settle(page)
    assert.deepEqual(await snapshot(page), navigation)
    assert.equal(await dialog.locator('.tg-group-frame[data-node-id=g1]').count(), 0)
    await dialog.getByRole('combobox', { name: '查找任务' }).selectOption('g1_work'); await settle(page)
    assert.equal(await cardVisible(page, 'g1_work'), true)
    assert.equal(await dialog.locator('.tg-group-frame').count(), 2)
    await dialog.getByRole('button', { name: '聚焦 数据准备与迁移', exact: true }).click(); await settle(page)
    assert.deepEqual(await dialog.locator('.tg-card').evaluateAll(nodes => nodes.map(node => node.dataset.nodeId)), ['g1_work','g1_end'])
    assert.equal(await dialog.locator('.tg-wire[data-state=dispositionReady]').count(), 1)
    await page.screenshot({ path: path.join(output, 'hierarchy-drilldown.png'), animations: 'disabled' })
    await dialog.getByRole('button', { name: '返回上层', exact: true }).click(); await settle(page)
    assert.equal(await dialog.locator('.tg-card[data-node-id=g1]').count(), 1)
    assert.equal(await dialog.locator('.tg-wire').count(), 1)
    await dialog.getByRole('button', { name: '展开分组', exact: true }).click(); await settle(page)
    await dialog.getByRole('button', { name: '折叠分组', exact: true }).click(); await settle(page)
    assert.equal(await dialog.locator('.tg-card').count(), 2)
    assert.equal(await dialog.locator('.tg-group-frame').count(), 0)
    await dialog.getByRole('button', { name: '全部展开', exact: true }).click(); await settle(page)
    assert.equal(await dialog.locator('.tg-group-frame').count(), 2)
    assert.equal(await dialog.locator('.tg-wire').count(), 2)
    assert.equal(await page.evaluate(() => JSON.stringify(window.visual.graph)), original)
    checks.push('groups and tasks are visible together', 'collapse retains group edges and sibling tasks', 'refresh preserves collapse',
      'find reveals tasks in collapsed groups', 'drilldown retains disposition handoff', 'switch and expand all preserve graph state')
  }
  if (row.id === 'groups-many') {
    const original = await page.evaluate(() => JSON.stringify(window.visual.graph))
    assert.equal(await dialog.locator('.tg-group-frame').count(), 12)
    await dialog.getByRole('button', { name: '全图', exact: true }).click(); await settle(page)
    await page.screenshot({ path: path.join(output, 'groups-many-fit.png'), animations: 'disabled' })
    await dialog.getByRole('button', { name: '折叠分组', exact: true }).click(); await settle(page)
    assert.equal(await dialog.locator('.tg-group-frame').count(), 0)
    assert.equal(await dialog.locator('.tg-card').count(), 12)
    assert.equal(await dialog.locator('.tg-wire').count(), 12, 'independent long group edge survives collapse')
    await dialog.getByRole('combobox', { name: '查找任务' }).selectOption('batch11_task15'); await settle(page)
    assert.equal(await cardVisible(page, 'batch11_task15'), true)
    assert.equal(await dialog.locator('.tg-group-frame').count(), 1, 'find only unfolds the target group')
    assert.equal(await dialog.locator('.tg-wire').count(), 27)
    await page.screenshot({ path: path.join(output, 'groups-many-last-task.png'), animations: 'disabled' })
    const count = await page.evaluate(() => window.visual.requests.length), before = await snapshot(page)
    await page.waitForFunction(count => window.visual.requests.length > count, count, { timeout: 6000 }); await settle(page)
    assert.deepEqual(await snapshot(page), before, 'poll retains collapsed groups and camera')
    assert.equal(await page.evaluate(() => JSON.stringify(window.visual.graph)), original)
    checks.push('128 nodes render together', 'collapse keeps long group edge', 'find unfolds only target group', 'large graph polling preserves navigation')
  }
  if (row.id === 'hierarchy-deep') {
    await dialog.getByRole('button', { name: '折叠 数据准备与迁移', exact: true }).click(); await settle(page)
    await dialog.getByRole('combobox', { name: '查找任务' }).selectOption('g1_end'); await settle(page)
    assert.equal(await cardVisible(page, 'g1_end'), true)
    assert.equal(await dialog.locator('.tg-group-frame').count(), 3)
    await page.screenshot({ path: path.join(output, 'hierarchy-nested-find.png'), animations: 'disabled' })
    checks.push('find reveals collapsed ancestors across nesting levels')
  }
  if (row.id === 'hierarchy-mobile') {
    assert.equal(await dialog.locator('.tg-canvas-stage').getAttribute('data-view'), 'level')
    await dialog.getByRole('button', { name: '展开分组', exact: true }).click(); await settle(page)
    assert.equal(await dialog.locator('.tg-group-frame').count(), 2)
    const canvas = await dialog.locator('.tg-canvas-scroll').boundingBox()
    assert.ok(canvas.height >= 150)
    await page.screenshot({ path: path.join(output, 'hierarchy-mobile-expanded.png'), animations: 'disabled' })
    await dialog.getByRole('button', { name: '逐层查看', exact: true }).click(); await settle(page)
    checks.push('mobile defaults to level view and supports expanded groups')
  }
  if (['join-dark', 'dense-desktop', 'wide-desktop', 'chain-desktop', 'landscape'].includes(row.id)) {
    await dialog.getByRole('button', { name: '全图', exact: true }).click(); await settle(page)
    const fitted = await page.evaluate(() => {
      const scroll = document.querySelector('.tg-canvas-scroll'), bounds = scroll.getBoundingClientRect()
      const frame = scroll.querySelector('.tg-canvas-frame').getBoundingClientRect()
      return { inside: frame.left >= bounds.left && frame.right <= bounds.right && frame.top >= bounds.top && frame.bottom <= bounds.bottom,
        cards: scroll.querySelectorAll('.tg-card').length, wires: scroll.querySelectorAll('.tg-wire').length }
    })
    assert.equal(fitted.inside, true, 'fit mode includes the whole graph, including bypass lanes')
    assert.equal(fitted.wires, await page.evaluate(() => window.visual.layout().wires.length))
    await page.screenshot({ path: path.join(output, row.id + '-overview.png'), animations: 'disabled' })
    await dialog.getByRole('button', { name: '定位任务', exact: true }).click(); await settle(page)
    assert.equal((await snapshot(page)).scale, 'scale(1)')
    checks.push('fit graph keeps every wire', 'locate returns to readable scale')
  }
  if (row.id === 'chain-desktop') {
    await dialog.getByRole('combobox', { name: '查找任务' }).selectOption('step126'); await settle(page)
    assert.equal(await cardVisible(page, 'step126'), true)
    await page.screenshot({ path: path.join(output, 'chain-last-task.png'), animations: 'disabled' })
    const before = await snapshot(page), count = await page.evaluate(() => window.visual.requests.length)
    await page.waitForFunction(count => window.visual.requests.length > count, count, { timeout: 6000 })
    await settle(page); assert.deepEqual(await snapshot(page), before, 'automatic polling preserves navigation')
    await dialog.getByRole('button', { name: '刷新', exact: true }).click(); await settle(page)
    assert.deepEqual(await snapshot(page), before, 'explicit refresh preserves navigation')
    await dialog.getByRole('combobox', { name: '查找任务' }).selectOption('step63'); await settle(page)
    await dialog.getByRole('button', { name: '放大', exact: true }).click(); await settle(page)
    assert.equal((await snapshot(page)).scale, 'scale(1.25)'); assert.equal(await cardVisible(page, 'step63'), true)
    await dialog.getByRole('button', { name: '缩小', exact: true }).click(); await settle(page)
    assert.equal((await snapshot(page)).scale, 'scale(1)'); assert.equal(await cardVisible(page, 'step63'), true)
    checks.push('last task reachable', 'poll and refresh preserve viewport', 'zoom preserves the viewed task')
  }
  if (row.id === 'dense-desktop') {
    await dialog.getByRole('combobox', { name: '查找任务' }).selectOption('l3r9'); await settle(page)
    assert.equal(await cardVisible(page, 'l3r9'), true)
    const edges = await page.evaluate(() => ({
      focused: document.querySelectorAll('.tg-wire[data-emphasis=focused]').length,
      expected: window.visual.layout().wires.filter(w => w.edge.from === 'l3r9' || w.edge.to === 'l3r9').length,
      total: document.querySelectorAll('.tg-wire').length,
    }))
    assert.equal(edges.focused, edges.expected); assert.equal(edges.total, 512)
    await page.screenshot({ path: path.join(output, 'dense-selected-task.png'), animations: 'disabled' })
    checks.push('dense selection emphasizes all incident edges without removing others')
  }
  if (row.id === 'branches-dark') {
    await dialog.getByRole('combobox', { name: '查找任务' }).selectOption('case7'); await settle(page)
    const label = await page.evaluate(() => window.visual.graph.edges.find(e => e.to === 'case7').case)
    assert.ok((await dialog.locator('.tg-condition-kind').textContent()).includes(label), 'full condition text is accessible in the inspector')
    await page.screenshot({ path: path.join(output, 'branch-condition-detail.png'), animations: 'disabled' })
    checks.push('long condition retained in details')
  }
  if (row.id === 'join-dark') {
    const graphBefore = await page.evaluate(() => JSON.stringify(window.visual.graph))
    await dialog.getByRole('button', { name: '暂停', exact: true }).click()
    await dialog.getByRole('button', { name: '继续', exact: true }).waitFor()
    await dialog.getByRole('button', { name: '继续', exact: true }).click()
    await dialog.getByRole('button', { name: '暂停', exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.visual.controls), ['pause', 'resume'])
    assert.equal(await page.evaluate(() => JSON.stringify(window.visual.graph)), graphBefore)
    const scaleBefore = await snapshot(page)
    await page.keyboard.press('Escape'); await page.locator('dialog').waitFor({ state: 'hidden' })
    assert.equal(await page.locator('.tg-top button[aria-haspopup=dialog]').evaluate(e => e === document.activeElement), true)
    await page.keyboard.press('Enter'); await dialog.waitFor(); await settle(page)
    assert.deepEqual(await snapshot(page), scaleBefore)
    checks.push('pause/resume uses existing controls once each', 'Escape restores opener focus', 'Enter reopens with saved viewport')
  }
  if (row.id === 'minimal-mobile') {
    const before = await dialog.locator('.tg-canvas-scroll').boundingBox()
    await dialog.locator('.tg-inspector summary').click(); await settle(page)
    const after = await dialog.locator('.tg-canvas-scroll').boundingBox()
    assert.ok(after.height > before.height, 'details collapse frees canvas space')
    checks.push('collapsible details')
  }
  return checks
}
