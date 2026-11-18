// SPDX-License-Identifier: GPL-3.0-only
// Loaded in the existing DSH browser seat, without a separate React root.
export function createClientPlugin(React, z, createRemoteContribution, graphPresentation, branchLayout) {
  const { createElement: h, useEffect, useId, useMemo, useRef, useState } = React
  const locale = {
    zh: {
      title: '事务图', progress: '任务成功 {done}/{total}', active: '当前事务', ready: '可开始', noReady: '暂无可开始事务',
      retry: '刷新', loading: '正在读取事务图…', unavailable: '暂时无法读取事务图', stale: '显示上次读取的状态', recovering: '当前事务等待恢复对账',
      pending: '状态更新待对账', waiting: '暂时没有可执行步骤，等待当前状态核对',
      tree: '事务层级', details: '事务关系', incoming: '进入条件：', conditionSeparator: '：',
      noEdges: '无进入条件',
      complete: '完成', inProgress: '执行中', pendingNode: '待执行', inactive: '分支尚未激活', incomplete: '未完成',
      branchWaiting: '等待分支选择', branchExcluded: '未选分支', branchChosen: '已选路径', graphComplete: '选中路径已完成',
      skipped: '跳过，未执行', failed: '失败', blocked: '受阻', unsatisfied: '未满足', grouped: '组内尚有未完成',
      fullscreen: '全屏', exitFullscreen: '退出全屏', branchGraph: '事务分支图',
      prerequisiteMet: '前置已满足', edgeWaiting: '等待条件',
      additionalPrerequisites: '另有 {count} 项前置',
      scopeLevel: '当前层', enterGroup: '进入分组', parentGroup: '返回上层', terminal: '终点', groupReview: '组级终审', scopeReview: '本层计划复查', dispositionReady: '处置报告已提交', group_audit: '组级终审', scope_plan: '本层计划复查', scope_update: '本层蓝图更新', scope_audit: '修改审计', scope_blockage: '分层阻塞处理', scope_pause: '中断审核', task_reporter: '任务报告',
      expandedView: '展开分组', levelView: '逐层查看', graphView: '显示方式', collapseGroup: '折叠 {name}', expandGroup: '展开 {name}', focusGroup: '聚焦 {name}', expandAll: '全部展开', collapseAll: '折叠分组', groupTasks: '{count} 个任务', groupFlow: '组间关系从上到下 · 组内任务从左到右',
      fitGraph: '全图', actualSize: '100%', zoomIn: '放大', zoomOut: '缩小', zoomLevel: '缩放比例', locateTask: '定位任务',
      locateHelp: '以原始大小查看所选任务；未选择时定位当前任务', findTask: '查找任务', selectTask: '选择任务…',
      canvasCount: '{nodes} 个节点 · {edges} 条关系', selectedTask: '所选任务', entryCount: '{count} 项进入条件', taskCard: '任务', groupCard: '分组',
      requires: '前置完成后', onComplete: '完成时', onIncomplete: '未完成时', onCase: '分支 {value}',
      totalIncomplete: '{count} 项未完成', totalSkipped: '{count} 项跳过', totalInactive: '{count} 项分支未激活',
      totalExcluded: '{count} 项属于未选分支',
      revision: '版本 {revision}',
      pause: '暂停', resume: '继续', pausing: '正在暂停：当前步骤结束后不再请求模型',
      paused: '已正常暂停', interrupted: '执行中断，可从保存状态接续', running: '后台运行中',
      controlFailed: '操作未确认，请刷新后重试', planning: '正在准备任务图',
      requestStep: '模型请求 · 第 {step} 步', toolStep: '工具执行 · {tool}', resultStep: '已收到步骤结果',
      pauseHelp: '完成当前请求和工具步骤后暂停，不再发送下一次模型请求。',
      resumeHelp: '正常暂停继续下一步；意外中断根据保存的请求与工具记录恢复。',
      workflowWaiting: '等待用户选择或原生 Plan 模式解除', workflowComplete: '任务图流程已结束',
      workflowBlocked: '需要核对保存状态', workflowIdle: '流程待继续',
      PREPLANNING: '预规划', EXECUTING: '叶任务', result_check: '结果验收', result_repair: '报告补正',
      plan_check: '计划复查', updater: '图更新', reviewer: '修改审计',
    },
    en: {
      title: 'Transaction graph', progress: '{done}/{total} tasks successful', active: 'Current transaction', ready: 'Ready to start',
      noReady: 'No transaction ready to start', retry: 'Refresh', loading: 'Loading transaction graph…', unavailable: 'Transaction graph is unavailable', stale: 'Showing last known state',
      recovering: 'Current transaction awaits reconciliation', pending: 'Status update awaits reconciliation',
      waiting: 'Execution is on hold until the current state is reconciled',
      tree: 'Transaction hierarchy', details: 'Transaction relationships', incoming: 'Entry conditions:', conditionSeparator: ': ',
      noEdges: 'No entry conditions',
      complete: 'Complete', inProgress: 'In progress', pendingNode: 'Pending', inactive: 'Branch not activated',
      incomplete: 'Incomplete', skipped: 'Skipped', failed: 'Failed', blocked: 'Blocked', unsatisfied: 'Unsatisfied', grouped: 'Group incomplete',
      fullscreen: 'Full screen', exitFullscreen: 'Exit full screen', branchGraph: 'Transaction branch graph',
      prerequisiteMet: 'Prerequisite met', edgeWaiting: 'Awaiting condition',
      additionalPrerequisites: '+{count} prerequisites',
      scopeLevel: 'Current level', enterGroup: 'Enter group', parentGroup: 'Parent group', terminal: 'Terminal', groupReview: 'Group final review', scopeReview: 'Scope plan review', dispositionReady: 'Disposition available', group_audit: 'Group final review', scope_plan: 'Scope plan review', scope_update: 'Scope update', scope_audit: 'Change audit', scope_blockage: 'Scoped blockage', scope_pause: 'Pause review', task_reporter: 'Task report',
      expandedView: 'Expanded groups', levelView: 'One level', graphView: 'View mode', collapseGroup: 'Collapse {name}', expandGroup: 'Expand {name}', focusGroup: 'Focus {name}', expandAll: 'Expand all', collapseAll: 'Collapse groups', groupTasks: '{count} tasks', groupFlow: 'Groups flow down · Tasks flow right',
      fitGraph: 'Fit graph', actualSize: '100%', zoomIn: 'Zoom in', zoomOut: 'Zoom out', zoomLevel: 'Zoom level', locateTask: 'Locate task',
      locateHelp: 'Show the selected task at actual size; otherwise locate the current task', findTask: 'Find task', selectTask: 'Select a task…',
      canvasCount: '{nodes} nodes · {edges} edges', selectedTask: 'Selected task', entryCount: '{count} entry conditions', taskCard: 'Task', groupCard: 'Group',
      branchWaiting: 'Awaiting branch selection', branchExcluded: 'Branch not selected',
      branchChosen: 'Selected path', graphComplete: 'Selected paths complete',
      requires: 'After prerequisite', onComplete: 'On completion', onIncomplete: 'On incomplete', onCase: 'Case {value}',
      totalIncomplete: '{count} incomplete', totalSkipped: '{count} skipped', totalInactive: '{count} inactive branches',
      totalExcluded: '{count} on unselected paths',
      revision: 'Revision {revision}',
      pause: 'Pause', resume: 'Continue', pausing: 'Pausing after the current step; no further model requests',
      paused: 'Paused normally', interrupted: 'Interrupted; saved state can be continued', running: 'Running in background',
      controlFailed: 'Action not confirmed. Refresh and retry.', planning: 'Preparing the task graph',
      requestStep: 'Model request · step {step}', toolStep: 'Tool execution · {tool}', resultStep: 'Step result received',
      pauseHelp: 'Finish the current request and tool step, then stop before the next model request.',
      resumeHelp: 'Continue after a normal pause, or recover an interruption using saved requests and tool receipts.',
      workflowWaiting: 'Waiting for user choice or native Plan mode', workflowComplete: 'Graph workflow ended',
      workflowBlocked: 'Saved state needs inspection', workflowIdle: 'Workflow awaiting continuation',
      PREPLANNING: 'Planning', EXECUTING: 'Leaf task', result_check: 'Acceptance', result_repair: 'Report repair',
      plan_check: 'Plan review', updater: 'Graph update', reviewer: 'Change audit',
    },
  }
  const statusLabels = {
    ACTIVE: 'inProgress', COMPLETE: 'complete', CONTAINER_INCOMPLETE: 'grouped', INACTIVE: 'inactive',
    INCOMPLETE: 'incomplete', PENDING: 'pendingNode', SKIPPED: 'skipped',
  }
  const dispositions = { FAILED: 'failed', UNSATISFIED: 'unsatisfied', SKIPPED_NOT_RUN: 'skipped' }
  const styles = `
    .tg-dock{--tg-border:var(--dsw-alias-border-l1,#8885);--tg-panel:var(--dsw-specific-menu,Canvas);--tg-muted:var(--dsw-alias-label-secondary,inherit);container-type:inline-size;box-sizing:border-box;width:calc(100% - 24px);max-width:var(--dsh-composer-card-max-width,860px);margin:0 auto;border:1px solid var(--tg-border);border-radius:var(--dsw-radius-lg,12px);background:var(--tg-panel);color:var(--dsw-alias-label-primary,CanvasText);font:inherit}
    .tg-dock button{font:inherit;color:inherit;cursor:pointer}
    .tg-dock button:focus-visible,.tg-canvas-scroll:focus-visible{outline:2px solid #4f91ed;outline-offset:-2px}
    .tg-top{display:flex;align-items:center;gap:3px;padding-inline-end:8px}
    .tg-header{display:flex;align-items:center;gap:10px;flex:1 1 auto;padding:7px 10px;border:0;border-radius:8px;background:transparent;text-align:left;font-size:13px!important;min-width:0}
    .tg-heading{font-weight:600;flex:none}.tg-summary{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--tg-muted)}.tg-count{flex:none;font-size:12px;color:var(--tg-muted)}
    .tg-chevron{display:inline-block;flex:none;transition:transform 180ms ease}.tg-header[aria-expanded=true] .tg-chevron{transform:rotate(180deg)}
    .tg-fold{display:grid;grid-template-rows:0fr;opacity:0;transition:grid-template-rows 180ms ease,opacity 150ms ease}
    .tg-fold[data-expanded=true]{grid-template-rows:1fr;opacity:1}.tg-fold-clip{min-height:0;overflow:hidden}
    .tg-body{padding:0 12px 10px;max-height:min(46vh,440px);overflow:auto;overscroll-behavior:contain}.tg-overview{display:flex;align-items:center;gap:8px;justify-content:space-between;margin:4px 0 7px;overflow-wrap:anywhere}
    .tg-overview h3,.tg-area h4,.tg-condition-heading{font-size:13px;margin:0;font-weight:600}
    .tg-overview h3{min-width:0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
    .tg-overview{position:sticky;top:0;z-index:1;background:var(--tg-panel);padding-block:4px}
    .tg-actions{display:flex;align-items:center;gap:7px;flex:none;font-size:11px}
    .tg-dock .tg-control{border:1px solid var(--tg-border);padding:3px 7px;border-radius:6px;background:transparent;font-size:12px;flex:none}
    .tg-control:disabled{cursor:default;opacity:.6}
    .tg-notice{padding:6px 8px;background:#d78c0c20;border-radius:6px;margin:4px 0;font-size:12px;overflow-wrap:anywhere}
    .tg-progress,.tg-ready{display:flex;flex-wrap:wrap;gap:5px 12px;margin:5px 0;font-size:12px;align-items:baseline}.tg-progress{color:var(--tg-muted)}
    .tg-execution{padding:4px 10px 8px}.tg-execution .tg-actions{margin-top:5px}
    .tg-ready button,.tg-link-button{border:0;background:transparent;padding:0;text-align:left;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2px;overflow-wrap:anywhere;max-width:100%}
    .tg-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:8px;margin-top:8px}
    .tg-area{min-width:0;padding:8px;border:1px solid var(--tg-border);border-radius:8px;overflow-wrap:anywhere}
    .tg-area h4{margin-bottom:6px}
    .tg-tree,.tg-tree ol{list-style:none;margin:0;padding:0}.tg-tree ol{margin-inline-start:8px;padding-inline-start:8px;border-inline-start:1px solid var(--tg-border)}
    .tg-node{display:flex;align-items:baseline;gap:5px;flex-wrap:wrap;width:100%;text-align:left;border:0;border-radius:5px;background:transparent;padding:4px 3px;font-size:12px!important;overflow-wrap:anywhere;transition:background-color 140ms ease}
    .tg-node:hover,.tg-node[aria-pressed=true]{background:#4f91ed21}.tg-node[aria-current=step]{outline:1px solid #4f91ed;outline-offset:-1px}.tg-node-name{min-width:0;max-width:100%;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.tg-node[data-kind=container] .tg-node-name{font-weight:650}
    .tg-badge{padding:0 4px;border-radius:4px;background:#8882;font-size:10px;line-height:16px}
    .tg-badge[data-state=complete]{background:#3399682c}.tg-badge[data-state=inProgress]{background:#4f91ed35}
    .tg-badge:is([data-state=blocked],[data-state=incomplete],[data-state=unsatisfied]){background:#d78c0c2c}
    .tg-badge[data-state=failed]{background:#d452522f}
    .tg-current,.tg-conditions{font-size:12px;line-height:1.4;overflow-wrap:anywhere}.tg-current{margin-bottom:7px}.tg-current .tg-badge{margin-inline-start:6px}
    .tg-conditions{list-style:decimal;margin:4px 0 0;padding-inline-start:1.7em}.tg-conditions li+li{margin-top:4px}.tg-no-conditions{margin:4px 0 0;color:var(--tg-muted);font-size:12px}

    .tg-viewer{
      --tg-panel:var(--dsw-alias-bg-base,Canvas);
      --tg-card-fill:light-dark(#fff,#292e38);
      --tg-card-border:light-dark(#cbd2dd,#4d5665);
      --tg-complete:light-dark(#287552,#6acda0);
      --tg-active:light-dark(#296ac4,#80b2ff);
      --tg-blocked:light-dark(#a36119,#edab5b);
      --tg-failed:light-dark(#aa4242,#fa8585);
      --tg-review:light-dark(#7855a5,#b9a0e7);
      box-sizing:border-box;position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;padding:18px 22px;border:0;overflow:hidden;background:var(--tg-panel);color:inherit;display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;gap:12px;opacity:0;transform:translateY(8px) scale(.995);transition:opacity 180ms ease,transform 180ms ease,display 180ms allow-discrete,overlay 180ms allow-discrete
    }
    .tg-viewer:not([open]){display:none}.tg-viewer[open]{opacity:1;transform:none}
    @starting-style{.tg-viewer[open]{opacity:0;transform:translateY(8px) scale(.995)}}
    .tg-viewer-header{display:flex;align-items:center;justify-content:space-between;gap:10px 20px;flex-wrap:wrap}
    .tg-viewer-heading{min-width:0;flex:1 1 320px}.tg-viewer-header h2{margin:3px 0;font-size:20px;line-height:1.35;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.tg-viewer-eyebrow{color:var(--tg-muted);font-size:11px;letter-spacing:.04em}
    .tg-viewer-header .tg-actions{flex:0 1 auto;flex-wrap:wrap}.tg-viewer .tg-area{max-height:min(22vh,190px);overflow:auto}
    .tg-viewer .tg-control{min-height:30px;padding:4px 9px;border-radius:7px;background:var(--tg-card-fill)}
    .tg-viewer .tg-execution{padding:0;display:flex;align-items:center;flex-wrap:wrap;gap:4px 12px}.tg-viewer .tg-execution .tg-actions{margin:0}.tg-viewer .tg-execution .tg-progress{margin:3px 0}.tg-viewer .tg-notice{flex-basis:100%;margin:4px 0;max-height:12vh;overflow:auto}
    .tg-inspector{min-width:0;border:1px solid var(--tg-border);border-radius:10px;background:color-mix(in srgb,var(--tg-panel),currentColor 2%);overflow:hidden}
    .tg-inspector summary{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;font-size:12px;list-style:none;min-width:0}.tg-inspector summary::-webkit-details-marker{display:none}.tg-inspector summary:before{content:'›';font-size:18px;line-height:1;transition:transform 120ms}.tg-inspector[open] summary:before{transform:rotate(90deg)}
    .tg-inspector summary>strong{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tg-inspector-label,.tg-inspector-count{flex:none;color:var(--tg-muted)}
    .tg-inspector .tg-area{border:0;border-top:1px solid var(--tg-border);border-radius:0;padding:10px 12px}.tg-inspector .tg-area>h4{display:none}.tg-inspector summary:focus-visible{outline:2px solid var(--tg-active);outline-offset:-3px}
    .tg-legend{display:flex;flex-wrap:wrap;gap:5px 16px;margin:0;padding:0;list-style:none;color:var(--tg-muted);font-size:12px}
    .tg-legend li{display:flex;align-items:center;gap:5px}
    .tg-wire,.tg-legend-mark{--tg-line:light-dark(#676d76,#b0b8c6);--tg-line-opacity:.78}
    :is(.tg-wire,.tg-legend-mark)[data-state=branchChosen]{--tg-line:var(--tg-active);--tg-line-opacity:1}
    :is(.tg-wire,.tg-legend-mark)[data-state=prerequisiteMet]{--tg-line:var(--tg-complete);--tg-line-opacity:1}
    :is(.tg-wire,.tg-legend-mark)[data-state=blocked]{--tg-line:var(--tg-blocked);--tg-line-opacity:1}
    :is(.tg-wire,.tg-legend-mark)[data-state=branchExcluded]{--tg-line-opacity:.62}
    .tg-legend-mark{width:16px;border-top:2px solid var(--tg-line);opacity:var(--tg-line-opacity)}
    .tg-legend-mark[data-state=dispositionReady]{--tg-line:var(--tg-review);border-top-style:dashed}
    .tg-legend-mark[data-state=branchExcluded]{border-top-style:dashed}
    .tg-canvas-stage[data-hierarchy=true]{grid-template-rows:auto auto minmax(0,1fr)}
    .tg-canvas-stage{display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0;min-width:0;gap:8px}
    .tg-scope-nav{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap;font-size:12px}.tg-scope-nav strong{flex:1;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tg-wire[data-state=dispositionReady]{stroke:var(--tg-review);stroke-dasharray:5 3}.tg-badge[data-state=groupReview],.tg-badge[data-state=scopeReview]{color:var(--tg-review,#b9a0e7)}
    .tg-view-mode{display:flex;gap:2px;padding:2px;border:1px solid var(--tg-border);border-radius:9px;flex:none}.tg-view-mode .tg-control{border:0;background:transparent}.tg-view-mode .tg-control[aria-pressed=true]{background:color-mix(in srgb,var(--tg-card-fill),var(--tg-active) 18%);color:var(--tg-active)}
    .tg-group-hint{color:var(--tg-muted);font-size:11px;flex:1;min-width:100px}
    .tg-group-frame{box-sizing:border-box;position:absolute;border:1px solid var(--tg-card-border);border-radius:14px;background:color-mix(in srgb,var(--tg-panel),var(--tg-active) 4%);pointer-events:none;overflow:hidden}
    .tg-group-frame[data-selected=true],.tg-group-frame[data-active=true]{border-color:var(--tg-active)}.tg-group-frame[data-selected=true]{box-shadow:0 0 0 1px var(--tg-active)}
    .tg-group-header{display:flex;align-items:center;gap:8px;height:58px;padding:8px 12px;border-bottom:1px solid var(--tg-border);background:color-mix(in srgb,var(--tg-panel),var(--tg-active) 8%);pointer-events:auto}
    .tg-group-select{flex:1;min-width:0;display:flex;align-items:center;gap:8px;text-align:left;border:0;background:transparent;padding:0}.tg-group-select strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}.tg-group-select .tg-badge{flex:none}.tg-group-count{font-size:11px;color:var(--tg-muted);white-space:nowrap}
    .tg-group-select:focus-visible,.tg-group-header button:focus-visible{outline:2px solid var(--tg-active);outline-offset:2px}.tg-collapsed-group{position:absolute;pointer-events:none}.tg-collapsed-group .tg-card{inset:0;width:100%;height:100%;pointer-events:auto;padding-right:48px}.tg-collapsed-group>.tg-control{position:absolute;right:8px;top:8px;pointer-events:auto}
    .tg-canvas-toolbar{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:7px 12px}.tg-canvas-tools{display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-width:0}.tg-canvas-count{font-size:11px;color:var(--tg-muted);white-space:nowrap}.tg-zoom-value{font-size:11px;min-width:38px;text-align:center;font-variant-numeric:tabular-nums;color:var(--tg-muted)}
    .tg-task-select{font:inherit;font-size:12px;color:inherit;background:var(--tg-card-fill);border:1px solid var(--tg-border);border-radius:7px;min-width:0;max-width:250px;width:210px;min-height:30px;padding:4px 7px}
    .tg-canvas-scroll{display:flex;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;border:1px solid var(--tg-border);border-radius:12px;background-color:color-mix(in srgb,var(--tg-panel),currentColor 1%);background-image:radial-gradient(color-mix(in srgb,var(--tg-border),transparent 28%) .7px,transparent .7px);background-size:20px 20px;scrollbar-width:thin;scrollbar-color:var(--tg-border) transparent}
    .tg-canvas-frame{flex:none;position:relative;margin:auto;overflow:hidden}.tg-canvas{position:absolute;inset:0;transform-origin:0 0}.tg-wires{position:absolute;inset:0;pointer-events:none}
    .tg-wire{fill:none;stroke:var(--tg-line);stroke-width:2;stroke-linecap:round;stroke-linejoin:round;opacity:var(--tg-line-opacity);pointer-events:stroke}
    .tg-wire[data-state=branchExcluded]{stroke-dasharray:5 5}.tg-wire[data-state=branchChosen]{stroke-width:2.6}
    .tg-wire[data-emphasis=muted]{opacity:.44}.tg-wire[data-emphasis=focused]{opacity:1;stroke-width:2.8}.tg-wire:hover{opacity:1;stroke-width:3.5}
    .tg-wire-caption{pointer-events:none;overflow:visible}.tg-wire-label{display:block;box-sizing:border-box;padding:3px 5px;border:1px solid var(--tg-border);border-radius:5px;background:var(--tg-panel);color:inherit;font-size:10px;line-height:16px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;text-align:center}
    .tg-dock .tg-card{--tg-card-accent:var(--tg-card-border);box-sizing:border-box;position:absolute;display:flex;flex-direction:column;align-items:stretch;justify-content:center;gap:7px;padding:11px 13px;overflow:hidden;text-align:left;border:1px solid var(--tg-card-border);border-inline-start:4px solid var(--tg-card-accent);border-radius:11px;background:var(--tg-card-fill);box-shadow:0 3px 9px #00000010;transition:background-color 140ms ease,border-color 140ms ease}
    .tg-dock .tg-card[data-state=complete]{--tg-card-accent:var(--tg-complete)}
    .tg-dock .tg-card[data-state=failed]{--tg-card-accent:var(--tg-failed)}
    .tg-dock .tg-card:is([data-state=blocked],[data-state=incomplete],[data-state=unsatisfied]){--tg-card-accent:var(--tg-blocked)}
    .tg-dock .tg-card[data-state=inProgress]{--tg-card-accent:var(--tg-active)}
    .tg-dock .tg-card:is([data-state=branchExcluded],[data-state=branchWaiting]){border-style:dashed;box-shadow:none}.tg-dock .tg-card[data-state=branchExcluded]{background:color-mix(in srgb,var(--tg-panel),var(--tg-card-fill) 55%);color:var(--tg-muted)}
    .tg-dock .tg-card:hover{background:color-mix(in srgb,var(--tg-card-fill),var(--tg-active) 8%)}
    .tg-dock .tg-card[aria-pressed=true]{background:color-mix(in srgb,var(--tg-card-fill),var(--tg-active) 15%);border-color:var(--tg-active);border-inline-start-color:var(--tg-card-accent);box-shadow:0 0 0 1px var(--tg-active)}
    .tg-card-title{font-size:14px;line-height:1.4;font-weight:650;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;flex-shrink:0}
    .tg-card-group{font-size:10px;line-height:1.3;color:var(--tg-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;flex-shrink:0}
    .tg-card-states{display:flex;gap:5px;max-width:100%;white-space:nowrap}.tg-card-states .tg-badge{min-width:0;overflow:hidden;text-overflow:ellipsis}
    .tg-card-states .tg-badge[data-state]{font-size:11px;line-height:18px;background:color-mix(in srgb,var(--tg-card-fill),var(--tg-card-accent) 20%)}
    @container (max-width:580px){.tg-grid{grid-template-columns:minmax(0,1fr)}.tg-tree ol{margin-inline-start:3px;padding-inline-start:4px}}
    @container (max-width:250px){.tg-top,.tg-header,.tg-overview,.tg-actions{flex-wrap:wrap}.tg-top{padding:4px;gap:3px}.tg-header{padding:3px;gap:4px}.tg-summary{flex-basis:100%;order:1}.tg-count{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}.tg-body{padding-inline:4px}.tg-area{padding:4px}.tg-tree ol{margin-inline-start:1px;padding-inline-start:2px}.tg-actions{flex:0 1 auto;min-width:0}}
    @media(max-width:580px){.tg-viewer{padding:10px;gap:9px}.tg-viewer-header{gap:7px}.tg-viewer-header h2{font-size:16px}.tg-viewer-header .tg-actions{gap:5px}.tg-canvas-toolbar{gap:6px}.tg-task-select{width:180px;max-width:100%}.tg-inspector-count{display:none}.tg-inspector summary{padding:8px}.tg-inspector-label{font-size:11px}.tg-viewer .tg-area{max-height:20vh}}
    @media(max-height:520px){.tg-viewer{padding:8px 12px;gap:6px}.tg-viewer-header{gap:4px}.tg-viewer-header h2{font-size:16px;-webkit-line-clamp:1}.tg-viewer-eyebrow{display:none}.tg-viewer .tg-area{max-height:24vh}.tg-viewer .tg-execution .tg-progress{font-size:11px}.tg-viewer .tg-notice{max-height:42px}.tg-legend{font-size:10px;gap:3px 10px}.tg-inspector summary{padding:6px 10px}}
    @media(prefers-reduced-motion:reduce){.tg-viewer,.tg-fold,.tg-chevron,.tg-node,.tg-dock .tg-card{transition:none}}
  `

  const contribution = createRemoteContribution(z)
  const statusResult = contribution.descriptors[0].result.create()
  function nodeState(node) {
    if (node.gate) return { GROUP_REVIEW: 'groupReview', PLAN_REVIEW: 'scopeReview', GRAPH_UPDATE: 'scope_update', GRAPH_AUDIT: 'scope_audit', PAUSE_REVIEW: 'scope_pause', WAITING_USER: 'paused', BLOCKAGE: 'scope_blockage' }[node.gate]
    if (node.branchState === 'NOT_SELECTED') return 'branchExcluded'
    if (node.branchState === 'WAITING' && !node.disposition) return 'branchWaiting'
    return dispositions[node.disposition] ?? (node.blocked ? 'blocked' : statusLabels[node.status])
  }
  function badge(node, t) {
    const state = nodeState(node)
    return h('span', { className: 'tg-badge', 'data-state': state }, t(state))
  }
  function edgeText(edge, t) {
    if (edge.kind === 'prerequisite') return t('requires')
    if (edge.kind === 'case') return t('onCase', { value: edge.case })
    return t(edge.outcome === 'complete' ? 'onComplete' : 'onIncomplete')
  }
  function Conditions({ selected, conditions, entryEdges = [], t, onSelect }) {
    if (!selected) return null
    return h('section', { className: 'tg-area', 'aria-label': t('details') },
      h('h4', null, t('details')),
      h('div', { className: 'tg-current' }, h('strong', null, selected.label), badge(selected, t)),
      selected.acceptance && h('p', { className: 'tg-acceptance' }, selected.acceptance),
      h('h5', { className: 'tg-condition-heading' }, t('incoming')),
      conditions.length ? h('ol', { className: 'tg-conditions' }, conditions.map(node =>
        h('li', { key: node.id },
          h('button', { type: 'button', className: 'tg-link-button', onClick: () => onSelect(node.id) }, node.label),
          t('conditionSeparator'), t(nodeState(node)),
          entryEdges.some(edge => edge.from === node.id && edge.kind !== 'prerequisite') &&
            h('div', { className: 'tg-condition-kind' }, entryEdges.filter(edge => edge.from === node.id).map(edge => edgeText(edge, t)).join(' / '))))) :
        h('p', { className: 'tg-no-conditions' }, t('noEdges')))
  }
  function BranchCanvas({ graph, selected, active, t, onSelect }) {
    const [scopeId, setScope] = useState(graph.hierarchy?.focusScopeId)
    const [mode, setMode] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1000 ? 'expanded' : 'level')
    const [collapsedIds, setCollapsed] = useState([])
    const revealTarget = useRef(null)
    const expanded = Boolean(graph.hierarchy && mode === 'expanded')
    const byId = useMemo(() => new Map(graph.nodes.map(node => [node.id, node])), [graph])
    function ancestorsOf(id) {
      const seen = new Set()
      for (let parent = byId.get(id)?.parent; parent && !seen.has(parent); parent = byId.get(parent)?.parent) seen.add(parent)
      return seen
    }
    const scope = graph.nodes.find(node => node.id === scopeId && node.kind === 'container')
      ?? graph.nodes.find(node => node.parent === null)
    const layout = useMemo(() => branchLayout(graph, scope?.id, { expandedGroups: expanded, collapsedIds }), [graph, scope?.id, expanded, collapsedIds])
    const groups = layout.groups ?? [], visibleItems = [...layout.cards, ...groups]
    useEffect(() => {
      if (!expanded && graph.hierarchy && selected?.kind === 'leaf' && selected.parent !== scope?.id) {
        setScope(selected.parent); setZoom({ scale: 1, mode: 'initial' })
      }
      if (expanded && selected && !visibleItems.some(item => item.node.id === selected.id)) {
        const ancestors = ancestorsOf(selected.id)
        if (collapsedIds.some(id => ancestors.has(id))) {
          revealTarget.current = selected.id
          setCollapsed(old => old.filter(id => !ancestors.has(id)))
        }
      }
    }, [selected?.id, expanded])
    const enter = id => { setMode('level'); setScope(id); onSelect(id); setZoom({ scale: 1, mode: 'initial' }) }
    const changeMode = value => { setMode(value); setZoom({ scale: 1, mode: 'initial' }) }
    const toggleGroup = id => { setCollapsed(old => old.includes(id) ? old.filter(value => value !== id) : [...old, id]); onSelect(id); setZoom({ scale: 1, mode: 'initial' }) }

    const arrowId = useId()
    const scroller = useRef(null), pendingCenter = useRef(null)
    const [size, setSize] = useState({ width: 0, height: 0 })
    const [zoom, setZoom] = useState({ scale: 1, mode: 'initial' })
    const visibleId = id => [id, ...(expanded ? ancestorsOf(id) : [])].find(value => visibleItems.some(card => card.node.id === value))
    const focusId = visibleId(selected?.id) ?? visibleId(active?.id)
    const locateId = focusId ?? layout.cards[0]?.node.id
    const fitScale = () => Math.min(1, Math.max(.001, (size.width - 24) / layout.width), Math.max(.001, (size.height - 24) / layout.height))
    useEffect(() => {
      const node = scroller.current
      const resize = () => setSize(old => old.width === node.clientWidth && old.height === node.clientHeight ? old
        : { width: node.clientWidth, height: node.clientHeight })
      const observer = new ResizeObserver(resize); observer.observe(node); resize()
      return () => observer.disconnect()
    }, [])
    function zoomTo(scale, { target, mode = 'manual' } = {}) {
      const node = scroller.current, card = visibleItems.find(card => card.node.id === target)
      if (!node) return
      pendingCenter.current = card ? { x: card.x + (card.width ?? layout.cardWidth) / 2, y: card.y + (groups.includes(card) ? 58 : card.height ?? layout.cardHeight) / 2 }
        : { x: (node.scrollLeft + node.clientWidth / 2 - Math.max(0, (node.clientWidth - layout.width * zoom.scale) / 2)) / zoom.scale,
          y: (node.scrollTop + node.clientHeight / 2 - Math.max(0, (node.clientHeight - layout.height * zoom.scale) / 2)) / zoom.scale }
      setZoom({ scale, mode })
    }
    useEffect(() => {
      if (!revealTarget.current || !visibleItems.some(item => item.node.id === revealTarget.current)) return
      const target = revealTarget.current; revealTarget.current = null
      zoomTo(1, { target })
    }, [layout])
    useEffect(() => {
      if (!size.width || !size.height || zoom.mode === 'manual') return
      const scale = fitScale()
      if (zoom.mode === 'initial' && scale < (expanded ? .6 : .7)) zoomTo(.9, { target: locateId })
      else setZoom(old => old.scale === scale && old.mode === 'fit' ? old : { scale, mode: 'fit' })
    }, [size.width, size.height, layout.width, layout.height, zoom.mode])
    useEffect(() => {
      const center = pendingCenter.current
      if (!center || !scroller.current) return
      pendingCenter.current = null
      const node = scroller.current
      node.scrollTo({ left: center.x * zoom.scale - node.clientWidth / 2, top: center.y * zoom.scale - node.clientHeight / 2 })
    }, [zoom])
    const wires = layout.wires.map(wire => {
      const focusAncestors = expanded ? ancestorsOf(focusId) : new Set()
      const emphasis = !focusId ? 'normal' : wire.edge.from === focusId || wire.edge.to === focusId
        || focusAncestors.has(wire.edge.from) || focusAncestors.has(wire.edge.to) ? 'focused' : 'muted'
      const label = wire.state === 'dispositionReady' ? t('dispositionReady') : edgeText(wire.edge, t)
      return h('g', { key: wire.key, transform: `translate(${wire.offsetX ?? 0} ${wire.offsetY ?? 0})` },
        h('path', { className: 'tg-wire', 'data-state': wire.state, 'data-emphasis': emphasis, 'data-edge-from': wire.edge.from, 'data-edge-to': wire.edge.to, 'data-edge-scope': wire.scopeId, d: wire.path, markerEnd: `url(#${arrowId})` },
          h('title', null, `${wire.from.label} → ${wire.to.label} · ${label} · ${t(wire.state)}`)),
        wire.showLabel && h('foreignObject', { className: 'tg-wire-caption', x: wire.labelX - wire.labelWidth / 2, y: wire.labelY - 18,
          width: wire.labelWidth, height: 24 }, h('span', { xmlns: 'http://www.w3.org/1999/xhtml', className: 'tg-wire-label', title: label }, label)))
    })
    const cards = layout.cards.map(({ node, group, ordinal, x, y, width, height, additionalPrerequisites }) => {
      const collapsible = expanded && node.kind === 'container'
      const card = h('button', {
      key: node.id, type: 'button', className: 'tg-card', 'data-state': nodeState(node),
      'data-node-id': node.id,
      'aria-pressed': selected?.id === node.id, 'aria-current': active?.id === node.id ? 'step' : undefined,
      style: collapsible ? undefined : { left: x, top: y, width: width ?? layout.cardWidth, height: height ?? layout.cardHeight },
      onClick: () => onSelect(node.id), onDoubleClick: () => { if (graph.hierarchy && node.kind === 'container') enter(node.id) }, title: node.label,
    }, h('span', { className: 'tg-card-group', title: group ?? undefined }, `${t(node.kind === 'container' ? 'groupCard' : 'taskCard')} ${String(ordinal).padStart(2, '0')}`, group && ` · ${group}`),
    h('strong', { className: 'tg-card-title' }, node.label),
    h('span', { className: 'tg-card-states' }, badge(node, t), node.isTerminal && h('span', { className: 'tg-badge' }, t('terminal')),
      additionalPrerequisites > 0 && h('span', { className: 'tg-badge' },
        t('additionalPrerequisites', { count: additionalPrerequisites }))))
      return collapsible ? h('div', { key: node.id, className: 'tg-collapsed-group', style: { left: x, top: y, width, height } }, card,
        h('button', { type: 'button', className: 'tg-control', 'aria-expanded': false, 'aria-label': t('expandGroup', { name: node.label }), onClick: () => toggleGroup(node.id) }, '+')) : card
    })
    const frames = groups.map(group => h('section', { key: group.node.id, className: 'tg-group-frame', 'data-node-id': group.node.id,
      'data-selected': selected?.id === group.node.id, 'data-active': ancestorsOf(active?.id).has(group.node.id), 'aria-label': group.node.label,
      style: { left: group.x, top: group.y, width: group.width, height: group.height } },
      h('div', { className: 'tg-group-header' },
        h('button', { type: 'button', className: 'tg-group-select', 'aria-pressed': selected?.id === group.node.id, onClick: () => onSelect(group.node.id), title: group.node.label },
          h('strong', null, group.node.label), badge(group.node, t), group.node.isTerminal && h('span', { className: 'tg-badge' }, t('terminal'))),
        h('span', { className: 'tg-group-count' }, t('groupTasks', { count: group.taskCount })),
        h('button', { type: 'button', className: 'tg-control', 'aria-label': t('focusGroup', { name: group.node.label }), onClick: () => enter(group.node.id) }, '↗'),
        h('button', { type: 'button', className: 'tg-control', 'aria-expanded': true, 'aria-label': t('collapseGroup', { name: group.node.label }), onClick: () => toggleGroup(group.node.id) }, '−'))))
    return h('div', { className: 'tg-canvas-stage', 'data-hierarchy': Boolean(graph.hierarchy), 'data-view': expanded ? 'expanded' : 'level', 'data-scope-id': scope?.id },
      graph.hierarchy && h('nav', { className: 'tg-scope-nav', 'aria-label': t('scopeLevel') },
        h('div', { className: 'tg-view-mode', role: 'group', 'aria-label': t('graphView') }, ['expanded', 'level'].map(value =>
          h('button', { key: value, type: 'button', className: 'tg-control', 'aria-pressed': mode === value, onClick: () => changeMode(value) }, t(value === 'expanded' ? 'expandedView' : 'levelView')))),
        expanded ? h(React.Fragment, null, h('span', { className: 'tg-group-hint' }, t('groupFlow')),
          h('button', { type: 'button', className: 'tg-control', onClick: () => { setCollapsed([]); setZoom({ scale: 1, mode: 'initial' }) } }, t('expandAll')),
          h('button', { type: 'button', className: 'tg-control', onClick: () => { setCollapsed(graph.nodes.filter(node => node.kind === 'container' && node.parent).map(node => node.id)); setZoom({ scale: 1, mode: 'initial' }) } }, t('collapseAll')))
          : h(React.Fragment, null, h('button', { type: 'button', className: 'tg-control', disabled: !scope.parent, onClick: () => enter(scope.parent) }, t('parentGroup')),
            h('strong', { title: scope.label }, scope.label), badge(scope, t),
            selected?.kind === 'container' && selected.parent === scope.id && h('button', { type: 'button', className: 'tg-control', onClick: () => enter(selected.id) }, t('enterGroup')))),
      h('div', { className: 'tg-canvas-toolbar' },
        h('div', { className: 'tg-canvas-tools' }, h('span', { className: 'tg-canvas-count' }, t('canvasCount', { nodes: visibleItems.length, edges: layout.wires.length })),
          h('select', { className: 'tg-task-select', 'aria-label': t('findTask'), value: focusId ?? '', onChange: event => {
            const id = event.target.value
            if (id) {
              onSelect(id)
              if (visibleItems.some(item => item.node.id === id)) zoomTo(1, { target: id })
              else { revealTarget.current = id; const parents = ancestorsOf(id); setCollapsed(old => old.filter(value => !parents.has(value))) }
            }
          } }, h('option', { value: '', disabled: true }, t('selectTask')), (expanded ? graph.nodes.filter(node => node.parent) : layout.cards.map(card => card.node)).map((node, index) =>
            h('option', { key: node.id, value: node.id }, `${index + 1}. ${expanded && byId.get(node.parent)?.parent ? byId.get(node.parent).label + ' / ' : ''}${node.label}`)))),
        h('div', { className: 'tg-canvas-tools' },
          h('button', { type: 'button', className: 'tg-control', onClick: () => setZoom({ scale: fitScale(), mode: 'fit' }) }, t('fitGraph')),
          h('button', { type: 'button', className: 'tg-control', 'aria-label': t('zoomOut'), title: t('zoomOut'), disabled: zoom.scale <= .08,
            onClick: () => zoomTo(Math.max(.08, zoom.scale / 1.25)) }, '−'),
          h('output', { className: 'tg-zoom-value', 'aria-label': t('zoomLevel') }, `${Math.round(zoom.scale * 100)}%`),
          h('button', { type: 'button', className: 'tg-control', 'aria-label': t('zoomIn'), title: t('zoomIn'), disabled: zoom.scale >= 2,
            onClick: () => zoomTo(Math.min(2, Math.max(.1, zoom.scale * 1.25))) }, '+'),
          h('button', { type: 'button', className: 'tg-control', onClick: () => zoomTo(1) }, t('actualSize')),
          h('button', { type: 'button', className: 'tg-control', disabled: !locateId, title: t('locateHelp'), onClick: () => zoomTo(1, { target: locateId }) }, t('locateTask')))),
      h('div', { className: 'tg-canvas-scroll', ref: scroller, 'data-ready': zoom.mode !== 'initial', tabIndex: 0, role: 'region', 'aria-label': t('branchGraph') },
      h('div', { className: 'tg-canvas-frame', style: { width: layout.width * zoom.scale, height: layout.height * zoom.scale } },
      h('div', { className: 'tg-canvas', style: { width: layout.width, height: layout.height, transform: `scale(${zoom.scale})` } },
        frames,
        h('svg', { className: 'tg-wires', 'aria-hidden': true, width: layout.width, height: layout.height },
          h('defs', null, h('marker', { id: arrowId, viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 5, markerHeight: 5, orient: 'auto' },
            h('path', { d: 'M 0 0 L 8 4 L 0 8 Z', fill: 'context-stroke' }))),
          wires),
        cards))))
  }
  function ExecutionControls({ execution, t, pending, failed, allowed, control }) {
    if (!execution) return null
    const labels = { running: 'running', pausing: 'pausing', paused: execution.pauseKind === 'normal' ? 'paused' : 'interrupted',
      interrupted: 'interrupted', waiting: 'workflowWaiting', complete: 'workflowComplete', blocked: 'workflowBlocked', idle: 'workflowIdle' }
    const activity = execution.activity
    const stage = activity && (locale.en[activity.stage] ? t(activity.stage) : activity.stage)
    return h('div', { className: 'tg-execution' },
      h('div', { className: 'tg-progress', role: 'status', 'aria-live': 'polite' },
        h('strong', null, t(labels[execution.state])),
        activity && h('span', null, stage, ' · ', activity.kind === 'model' ? t('requestStep', { step: activity.step })
          : activity.kind === 'tool' ? t('toolStep', { tool: activity.tool }) : t('resultStep')),
        activity && h('time', { dateTime: activity.at }, new Date(activity.at).toLocaleTimeString())),
      h('div', { className: 'tg-actions' },
        execution.canPause && h('button', { type: 'button', className: 'tg-control', disabled: !allowed || pending || failed,
          title: t('pauseHelp'), onClick: () => control('pause') }, t('pause')),
        execution.canResume && h('button', { type: 'button', className: 'tg-control', disabled: !allowed || pending || failed,
          title: t('resumeHelp'), onClick: () => control('resume') }, t('resume'))),
      execution.reason && ['interrupted', 'blocked'].includes(execution.state) && h('p', { className: 'tg-notice' }, execution.reason))
  }
  function GraphPanel({ graph, t, busy, failed, refresh, executionProps, controlError }) {
    const [expanded, setExpanded] = useState(false)
    const [selectedId, setSelected] = useState(null)
    const [viewerVisited, setViewerVisited] = useState(false)
    const [detailsOpen, setDetailsOpen] = useState(() => !graph.hierarchy && typeof window !== 'undefined' && window.matchMedia('(min-height: 600px)').matches)
    const viewer = useRef(null)
    const panelBody = useRef(null)
    const bodyId = useId()
    const viewerId = useId()
    const viewerTitleId = useId()
    const model = graphPresentation(graph, selectedId)
    const { active, selected, progress } = model
    useEffect(() => {
      if (!expanded) return
      const body = panelBody.current, current = body?.querySelector('[aria-current=step]')
      if (!current) return
      const bounds = body.getBoundingClientRect(), task = current.getBoundingClientRect()
      if (task.top < bounds.top || task.bottom > bounds.bottom)
        body.scrollTop += task.top - bounds.top - (body.clientHeight - task.height) / 2
    }, [expanded])
    let current = t('noReady')
    if (active) current = `${t(graph.active.recoveryRequired ? 'recovering' : 'active')} · ${active.label}`
    else if (graph.pending) current = t('pending')
    else if (graph.hierarchy?.pending) current = t(graph.hierarchy.pending.kind === 'GROUP_REVIEW' ? 'groupReview' : 'scopeReview')
    else if (model.children.get(null)?.[0]?.status === 'COMPLETE') current = t('graphComplete')
    else if (progress.ready) current = `${t('ready')} · ${progress.ready}`
    const title = failed ? `${t('stale')} · ${current}` : current
    const progressText = t('progress', { done: progress.complete, total: progress.total })
    const conditionProps = { selected, conditions: model.conditions, entryEdges: model.entryEdges, t, onSelect: setSelected }
    const refreshButton = () => h('button', { className: 'tg-control', type: 'button', disabled: busy, onClick: refresh }, t('retry'))
    const notices = () => h(React.Fragment, null,
      controlError && h('p', { className: 'tg-notice', role: 'alert' }, t('controlFailed')),
      failed && h('p', { className: 'tg-notice', role: 'status' }, t('unavailable')),
      graph.pending && h('p', { className: 'tg-notice', role: 'status' }, t('waiting')))
    function openViewer() {
      const dialog = viewer.current
      if (dialog.open) return
      setViewerVisited(true)
      dialog.showModal()
      dialog.querySelector('[data-tg-close]').focus()
    }
    function branch(parent, depth = 0) {
      const rows = model.children.get(parent)
      if (!rows || depth >= (graph.hierarchy ? 17 : 16)) return null
      return h('ol', { className: parent === null ? 'tg-tree' : undefined }, rows.map(node =>
        h('li', { key: node.id },
          h('button', { className: 'tg-node', type: 'button', 'data-kind': node.kind,
            'aria-pressed': selected?.id === node.id,
            'aria-current': active?.id === node.id ? 'step' : undefined,
            onClick: () => setSelected(node.id) },
          h('span', { className: 'tg-node-name', title: node.label }, node.label), badge(node, t),
          model.legal.has(node.id) && h('span', { className: 'tg-badge' }, t('ready'))),
          branch(node.id, depth + 1))))
    }
    return h('section', { className: 'tg-dock', 'data-testid': 'transaction-graph-dock', 'aria-label': t('title') },
      h('style', null, styles),
      h('div', { className: 'tg-top' },
        h('button', { type: 'button', className: 'tg-header', 'aria-expanded': expanded, 'aria-controls': bodyId,
          onClick: () => setExpanded(value => !value) },
          h('span', { className: 'tg-heading' }, t('title')),
          h('span', { className: 'tg-summary', title, role: 'status' }, title),
          h('span', { className: 'tg-count' }, progressText),
          h('span', { className: 'tg-chevron', 'aria-hidden': true }, '⌄')),
        h('button', { type: 'button', className: 'tg-control', 'aria-haspopup': 'dialog', 'aria-controls': viewerId,
          onClick: openViewer }, t('fullscreen'))),
      h(ExecutionControls, executionProps),
      h('div', { id: bodyId, className: 'tg-fold', 'data-expanded': expanded, 'aria-hidden': !expanded,
        ref: element => { if (element) element.inert = !expanded } },
        h('div', { className: 'tg-fold-clip' }, h('div', { className: 'tg-body', ref: panelBody },
          h('div', { className: 'tg-overview' }, h('h3', { title: graph.title }, graph.title),
            h('div', { className: 'tg-actions' }, h('span', null, t('revision', { revision: graph.revision })), refreshButton())),
          notices(),
          (progress.incomplete > 0 || progress.skipped > 0 || progress.inactive > 0 || progress.excluded > 0) &&
            h('p', { className: 'tg-progress' },
              progress.incomplete > 0 && h('span', null, t('totalIncomplete', { count: progress.incomplete })),
              progress.skipped > 0 && h('span', null, t('totalSkipped', { count: progress.skipped })),
              progress.inactive > 0 && h('span', null, t('totalInactive', { count: progress.inactive })),
              progress.excluded > 0 && h('span', null, t('totalExcluded', { count: progress.excluded }))),
          graph.legalNext.length > 0 && h('div', { className: 'tg-ready' }, h('strong', null, t('ready')),
            graph.legalNext.map(choice => h('button', { type: 'button', className: 'tg-link-button', key: choice.id,
              onClick: () => setSelected(choice.id) }, model.nodes.get(choice.id)?.label))),
          h('div', { className: 'tg-grid' },
            h('section', { className: 'tg-area', 'aria-label': t('tree') }, h('h4', null, t('tree')), branch(null)),
            h(Conditions, conditionProps))))),
      h('dialog', { id: viewerId, ref: viewer, className: 'tg-viewer', 'aria-labelledby': viewerTitleId },
        h('div', { className: 'tg-viewer-header' },
          h('div', { className: 'tg-viewer-heading' }, h('div', { className: 'tg-viewer-eyebrow' }, t('branchGraph')), h('h2', { id: viewerTitleId, title: graph.title }, graph.title)),
          h('div', { className: 'tg-actions' },
            h('span', null, progressText), h('span', null, t('revision', { revision: graph.revision })), refreshButton(),
            h('button', { className: 'tg-control', type: 'button', 'data-tg-close': true,
              onClick: () => viewer.current.close() }, t('exitFullscreen')))),
        h('div', null, h(ExecutionControls, executionProps), notices(),
          h('ul', { className: 'tg-legend' }, ['branchChosen', 'prerequisiteMet', ...(graph.hierarchy ? ['dispositionReady'] : []), 'blocked', 'edgeWaiting', 'branchExcluded'].map(state =>
            h('li', { key: state }, h('span', { className: 'tg-legend-mark', 'data-state': state, 'aria-hidden': true }), t(state))))),
        viewerVisited && h(BranchCanvas, { graph, selected, active, t, onSelect: setSelected }),
        h('details', { className: 'tg-inspector', open: detailsOpen, onToggle: event => setDetailsOpen(event.currentTarget.open) },
          h('summary', null, h('span', { className: 'tg-inspector-label' }, t('selectedTask')),
            h('strong', { title: selected?.label }, selected?.label), selected && badge(selected, t),
            h('span', { className: 'tg-inspector-count' }, t('entryCount', { count: model.conditions.length }))),
          h(Conditions, conditionProps))))
  }

  function makeDock(api) {
    return function TransactionGraphDock({ sessionId, useSession, useAccess, t }) {
      const canRead = useAccess('transactionGraphView/status')
      const canControl = useAccess('transactionGraphView/control')
      const opened = useSession(session => session.openState === 'open' && !session.removed)
      const running = useSession(session => session.running)
      const [result, setResult] = useState(null)
      const [refreshCount, requestRefresh] = useState(0)
      const [controlPending, setControlPending] = useState(false)
      const [controlError, setControlError] = useState(false)
      const requestEpoch = useRef(0), actionRequest = useRef(null)
      const refresh = () => requestRefresh(value => value + 1)
      useEffect(() => {
        setControlPending(false); setControlError(false)
        return () => { actionRequest.current?.abort(); actionRequest.current = null; requestEpoch.current++ }
      }, [sessionId])
      async function control(action) {
        if (!canControl || actionRequest.current || !result?.execution || result.sessionId !== sessionId) return
        const abort = new AbortController(); actionRequest.current = abort
        requestEpoch.current++; setControlPending(true); setControlError(false)
        try {
          const response = await api.control({ sessionId, workflowId: result.execution.workflowId, action },
            AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]))
          if (abort.signal.aborted) return
          const parsed = response?.ok ? statusResult.safeParse(response.value) : null
          if (!parsed?.success || parsed.data.sessionId !== sessionId) throw new Error('Control failed')
          setResult({ ...parsed.data, busy: false, failed: false })
        } catch { if (!abort.signal.aborted) setControlError(true) }
        finally {
          if (actionRequest.current === abort) actionRequest.current = null
          if (!abort.signal.aborted) { setControlPending(false); refresh() }
        }
      }
      useEffect(() => {
        if (!canRead || !opened) return
        const controller = new AbortController()
        let timer
        async function refreshStatus() {
          if (actionRequest.current) { timer = setTimeout(refreshStatus, 500); return }
          const epoch = requestEpoch.current
          let keepPolling = running
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])
          setResult(value => ({
            ...(value?.sessionId === sessionId ? value : {}),
            sessionId, graph: value?.sessionId === sessionId ? value.graph : null,
            execution: value?.sessionId === sessionId ? value.execution : null,
            busy: true, failed: value?.sessionId === sessionId && value.failed, showLoading: false,
          }))
          // A quick empty lookup should never mount the dock. Keep a confirmed
          // absence through background polls, but still expose genuine failures.
          const reveal = setTimeout(() => {
            if (controller.signal.aborted || epoch !== requestEpoch.current) return
            setResult(value => value?.sessionId === sessionId && value.busy ? { ...value, showLoading: true } : value)
          }, 300)
          try {
            const response = await api.status({ sessionId }, signal)
            if (controller.signal.aborted || epoch !== requestEpoch.current) return
            const parsed = response?.ok ? statusResult.safeParse(response.value) : null
            if (!parsed?.success || parsed.data.sessionId !== sessionId || parsed.data.status === 'unavailable' && !parsed.data.execution) throw new Error('Unavailable')
            keepPolling ||= Boolean(parsed.data.execution)
            setResult({ sessionId, status: parsed.data.status, graph: parsed.data.graph, execution: parsed.data.execution, busy: false, failed: parsed.data.status === 'unavailable' })
          } catch {
            if (controller.signal.aborted || epoch !== requestEpoch.current) return
            keepPolling = true
            setResult(value => ({ sessionId, graph: value?.sessionId === sessionId ? value.graph : null,
              execution: value?.sessionId === sessionId ? value.execution : null, busy: false, failed: true }))
          } finally {
            clearTimeout(reveal)
            if (keepPolling && !controller.signal.aborted) timer = setTimeout(refreshStatus, 2500)
          }
        }
        void refreshStatus()
        return () => { controller.abort(); clearTimeout(timer) }
      }, [canRead, opened, running, sessionId, refreshCount])
      if (!canRead || !opened) return null
      // Unknown initial state waits briefly; a known empty state remains hidden
      // while refreshing. A failed read is never treated as evidence of absence.
      if (result?.sessionId !== sessionId || !result.graph && !result.execution) {
        const current = result?.sessionId === sessionId ? result : null
        if (!current?.failed && (current?.status === 'empty' || !current?.showLoading)) return null
        return h('section', { className: 'tg-dock', style: { padding: 10 }, 'aria-label': t('title') },
          h('style', null, styles), h('strong', null, t('title')),
          h('p', { role: 'status' }, t(current?.failed ? 'unavailable' : 'loading')),
          current?.failed && h('button', { className: 'tg-control', type: 'button', disabled: current.busy, onClick: refresh }, t('retry')))
      }
      const executionProps = { execution: result.execution, t, pending: controlPending, failed: result.failed, allowed: canControl, control }
      if (!result.graph) return h('section', { className: 'tg-dock', style: { padding: 10 } }, h('style', null, styles),
        h('strong', null, t('planning')), h(ExecutionControls, executionProps),
        controlError && h('p', { role: 'alert' }, t('controlFailed')))
      return h(GraphPanel, { key: sessionId, graph: result.graph, t, busy: result.busy, failed: result.failed, refresh, executionProps, controlError })
    }
  }

  return {
    inject: ['slots', 'locale', 'remote'],
    async apply(ctx) {
      ctx.effect(() => ctx.locale.register('projectTransactionGraph', locale))
      const unmount = await ctx.remote.$mount(contribution)
      ctx.effect(() => unmount)
      ctx.inject(['remote.transactionGraphView'], mounted => {
        const Dock = makeDock(mounted.remote.transactionGraphView)
        mounted.slots.inject('conversation.input.dock', () => mounted.slots.register({
          name: 'conversation.input.dock', id: 'project-transaction-graph', locale: 'projectTransactionGraph', order: 10,
        }, Dock))
      })
    },
  }
}
