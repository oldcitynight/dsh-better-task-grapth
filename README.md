# dsh-better-task-grapth · 独立任务图

面向 DeepSeek Harness 的任务图基础包，负责图结构、前序准入、会话投影、事务回执与账本恢复。单独安装可使用读图、建图、开始、拟结和恢复工具。与同一维护线的动态上下文配套安装后，由后者接管 `/task-graph`，提供递归规划、执行、审计和报告。[离线运行图谱](docs/UNIT_WORKFLOW_20261123.html)

**与官方 Timeline（时间线）不兼容。** 在含有 Timeline 的 DSH 中，请在「插件 → 更多 → 时间线」关闭它，再启用这一套任务图。同一 profile 同时开启两者不在支持范围内。官方从 DSH `0.2.3-alpha.1` 引入此实验插件。[官方发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.3-alpha.1)

<!-- dsh-install:start -->
<!-- Generated from package.json and DSH-COMPATIBILITY.json. -->
## 选择与 DSH 配套的构建

本包 `dsh-better-task-grapth@0.3.2-rc.4` 的目标标签为 `dsh-0.2.2-alpha.2`。本线支持的 DSH 精确版本为 `0.2.2-alpha.2`。插件 Node.js 要求为 `^22.19.0 || >=24.0.0`，还须满足所选 DSH 本身的 Node.js 要求。

插件的 `latest` 跟随官方 DSH 的 `latest`，插件的 `next` 跟随官方 DSH 的 `alpha`。两个插件须使用同一行的 RC 后缀。npm 标签可移动，安装前先运行 `dsh --version`。[本构建兼容清单](DSH-COMPATIBILITY.json)

使用 Linux 或 WSL 中的 Linux 版 Node.js。原生 Windows 与 macOS 会收到 npm 的 `EBADPLATFORM`。本版工作流兼容周期为 `1`。

本维护线需要一次宿主适配。在安装 Bundle 后、启动 Web 前，将 BUNDLE_DIR 指向当前已解包的插件，DSH_NODE_MODULES 指向实际运行 DSH 的 node_modules，运行以下命令再启动或重启 DSH。

```sh
node "$BUNDLE_DIR/scripts/patch-native-host.mjs" "$DSH_NODE_MODULES"
```

### 安装本地候选包或已下载的 Release 附件

将对应宿主的一组 .tgz 放在当前目录。以下命令安装到 `bettertaskgraphs` profile。首次创建时选用未占用的名称并运行下列第一条命令，已有 profile 从安装命令开始。

```sh
dsh --profile bettertaskgraphs --from-default-profile web --dump-config
dsh plugin --profile bettertaskgraphs add "$PWD/dsh-better-task-grapth-0.3.2-rc.4.tgz"
dsh --profile bettertaskgraphs web
```

单独安装提供独立任务图。完整单元模式还需在同一 profile 加入 `dsh-dynamic-context@0.1.2-rc.4`。

### 从 npm 安装

下面的查询会访问公共登记库。只有两包所需版本均已公开（独立安装只需基础包）时才运行安装。若查询返回 E404，使用上一节的本地包。

```sh
npm view --registry=https://registry.npmjs.org/ dsh-better-task-grapth@0.3.2-rc.4 version &&
dsh plugin --profile bettertaskgraphs add dsh-better-task-grapth@0.3.2-rc.4
```

### 从对应版本的源码构建

在该维护线源码目录内运行下列命令。配套任务图尚未进入公共登记库时，构建动态上下文前先用 `npm cache add ./dsh-better-task-grapth-0.3.2-rc.4.tgz` 缓存同批基础包。

```sh
npm ci --prefer-offline
mkdir -p .test-tmp
TMPDIR="$PWD/.test-tmp" npm test
npm run pack:bundle
```

产物为 `dist/dsh-better-task-grapth-0.3.2-rc.4.tgz`。打开包内 [HTML 运行图谱](docs/UNIT_WORKFLOW_20261123.html) 可离线查阅流程、角色原文和联动指南。
<!-- dsh-install:end -->

## 单元、前序与终点

完整模式从根单元开始。每个单元绑定自己的基线和事实，既可以直接执行，也可以在原位展开。同层单元通过 AND、OR、NOT 组合对前序 PASS、FAILED、BLOCK 的判定。执行者只提交 PASS 或 FAILED，程序根据可达性计算 BLOCK。前序不可判定时保持等待。

每层一个终点。终点有准入资格且同层没有其他可执行单元时才会被选中。终点不能成为同层其他单元的前置条件。其已审结论发起父单元拟结。面板按前后依赖推导显示顺序，插入的单元可出现在两个既有单元之间。[角色与规则](docs/UNIT_WORKFLOW_20261123.html#n-rules)

## 设置与已有数据

在「插件 → 独立任务图」设置项目根、账本相对目录、独立图开关及工作流规模。默认全图 512 个单元、递归深度 32、第三方预装文本合计 10 KiB、动态材料合计 64 KiB。配套动态上下文有独立设置页。默认项目根取会话工作目录，任务图账本位于项目内的 `.dsh/transaction-graphs-v4/`。

旧名称 `dsh-bettertaskgraphs` 的自定义配置应将 Bundle ID 改为 `dsh-better-task-grapth`。在空闲边界成对升级并保留原项目根、会话与账本。新版完整模式使用单元工作流 v2，旧版完整工作流需在新会话重新建立根单元。恢复会校验兼容周期和版本，成功接续后采用当前版本作为新的恢复基线。[恢复与设置](docs/UNIT_WORKFLOW_20261123.html#settings)

## 插件间联动 API v1

公共模块导出为 `dsh-better-task-grapth/core`、`/store`、`/host`、`/interop`。消费者无需再访问包内私有路径。`ctx.transactionGraph.workflowContract` 固定为 `dsh-taskgraph-workflow-v1`。

宿主插件通过 `registerWorkflowProvider(adapter)` 登记一个联动工作流，返回取消登记函数。adapter 必须给出 contract、version:1、kind、workflowId、真实 projectRoot、operations、authorize、read、execute；subscribe 可发布已提交后的变更通知。重复标识拒绝覆盖，取消登记会取消该入口发起的在途执行。

控制器端接口：

```js
const graph = ctx.transactionGraph
const ref = { kind: 'dynamic-context', workflowId: 'project-workflow' }
const workflows = graph.listWorkflows(controllerAgent)
const snapshot = graph.readWorkflow(controllerAgent, ref)
const result = await graph.dispatchWorkflow(controllerAgent, ref, 'run_next', {
  expectedRevision: snapshot.revision,
}, signal)
const unsubscribe = graph.subscribeWorkflows(notice => {
  // notice 只含 contract、kind、workflowId、type、revision；重新读取提交后的状态。
})
```

动态上下文提供 `submit`、`status`、`run_next`；durable 模式另提供 `pause`、`resume`、`reconcile`、`maintenance`。submit 的 request 为 `{proposal:{taskGraph,contextGraph}}`，两张图仍由动态上下文的一个 CAS 文档原子提交。read 返回同一真实任务图、contextVersion、报告引用和执行状态；不返回原始上下文和报告正文。恢复/对账仍须精确 revision、attempt 与检查点票据，不能通过联动接口绕过。

入口只接受当前注册的真实控制器、原始与当前工作目录均在本项目内；worker 不能提升成控制器。参数由对应 provider 严格校验，来源 Agent 和取消信号由宿主绑定，模型参数不能替换。通知监听器异常不会回滚已提交状态。

联动工作流和原生事务图各用自己的账本。`transaction_graph_*` 工具仍操作原有会话账本。Web 面板优先使用经典账本，经典账本为空时可显示唯一授权工作流的图。提供方可通过 `readGraphView()` 返回本账本的 `{display, plan}` 或空图的 `null`，任务图插件再按 Web 接口输出可展示字段。联动 API 的报告和 Goal 仍有各自的验收流程。

可选 `readExecutionView(agent)` 与 `controlExecution(agent, action, signal)` 为通用工作流状态及控制接口；不注册时独立任务图保持原有行为。Web 通过 `transactionGraphView/control({sessionId,workflowId,action:'pause'|'resume'})` 控制当前会话唯一授权的提供方，不能跨会话、跨工作流或替换控制器。阶段及恢复语义由扩展插件提供，基础插件只负责授权路由和显示。面板会显示当前步骤并持续刷新，尚无图的预规划阶段也可显示暂停/继续。

可选 `readExecutionOutput(request, {agent,signal})` 提供后台执行的只读展示流。Web 的 `transactionGraphView/output` 以游标增量读取、`outputBody` 按记录 ID 分段读取完整正文；两者都绑定当前会话及 workflowId，不接受文件路径。基础插件只处理授权和分页，实际采集与 Chat 消息展示由扩展提供。未安装扩展时不创建额外模型请求或日志。任务图 UI 保留图、状态和暂停/继续，详细执行内容位于主会话消息区。

## 后续开发方向

1. 将各角色的信息可见范围移入配置文件，并开放设置页与插件动态调整接口。
2. 支持原生 Windows 和 macOS。
3. 发布独立的多 Agent 推理插件，与单元任务图联动。
4. 为 Codex 和 OpenCode 的兼容接入做准备。
5. 分别为 ChatGPT 系和 Qwen 系模型编写、调优专用预装上下文。

## 许可证

GPL-3.0-only。见 [LICENSE](LICENSE)。
