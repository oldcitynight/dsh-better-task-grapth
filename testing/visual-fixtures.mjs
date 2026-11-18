// Synthetic frontend inputs only. No session storage, executor or model API.
const leaf = (id, status = 'PENDING', extra = {}) => ({ id, label: id, kind: 'leaf', parent: 'root', status, ...extra })
const edge = (from, to) => ({ from, to, kind: 'prerequisite' })
const root = title => ({ id: 'root', label: title, kind: 'container', parent: null, status: 'CONTAINER_INCOMPLETE' })
const graph = (title, nodes, edges = [], extra = {}) => ({ revision: 18, title, nodes: [root(title), ...nodes], edges,
  active: null, pending: null, legalNext: [], skipChoices: [], ...extra })
const execution = (state, extra = {}) => ({ workflowId: 'visual-workflow', state, phase: 'EXECUTING', reason: null,
  pauseKind: null, canPause: state === 'running', canResume: ['paused','interrupted','blocked'].includes(state),
  activity: null, ...extra })

const labels = ['基础条件探查','核对模块与接口','兼容修复与运行验证','难度平衡与配方设计','恢复存档与版本校验','汉化、美术与体验打磨','集成第三方组件','任务编排与交付准备','交付打包与最终 QC']
const join = graph('整合包开发 · 从基础验证到最终交付', labels.map((label,i) => leaf('n'+i,
  i === 4 ? 'ACTIVE' : [0,1,2,5].includes(i) ? 'COMPLETE' : i === 3 ? 'INCOMPLETE' : 'PENDING',
  { label, ...(i === 3 ? { disposition: 'UNSATISFIED' } : i > 5 ? { blocked: true } : {}) })),
  [[0,1],[1,2],[2,3],[2,4],[2,5],[4,6],[6,7],[7,8],[5,8]].map(([a,b])=>edge('n'+a,'n'+b)),
  { active: { nodeId:'n4', recoveryRequired:false } })

const chain = graph('最大节点长链 · 127 个连续任务', Array.from({length:127},(_,i)=>leaf('step'+i,
  i < 78 ? 'COMPLETE' : i === 78 ? 'ACTIVE' : 'PENDING', {label:`阶段 ${String(i+1).padStart(3,'0')} · ${i%4 ? '实现、验证并提交阶段成果' : '检查输入条件与跨阶段交付约定'}`})),
  Array.from({length:126},(_,i)=>edge('step'+i,'step'+(i+1))), {active:{nodeId:'step78',recoveryRequired:false}})

const wide = graph('并行分支 · 48 个独立子成果在最终验收汇合', [leaf('start','COMPLETE',{label:'共同条件已核验'}),
  ...Array.from({length:48},(_,i)=>leaf('branch'+i,i<28?'COMPLETE':i===28?'ACTIVE':'PENDING',{label:`子模块 ${i+1} · 独立实现与验收`})),
  leaf('deliver','PENDING',{label:'汇合全部成果并交付',blocked:true})],
  Array.from({length:48},(_,i)=>[edge('start','branch'+i),edge('branch'+i,'deliver')]).flat(),
  {active:{nodeId:'branch28',recoveryRequired:false}})

const denseNodes = [leaf('seed','COMPLETE',{label:'固定目标与公共前置'})]
for(let c=0;c<7;c++)for(let r=0;r<18;r++)denseNodes.push(leaf(`l${c}r${r}`,c<3?'COMPLETE':'PENDING',{label:`${c+1}.${r+1} · 数据处理与验证`}));
const denseEdges = Array.from({length:18},(_,r)=>edge('seed',`l0r${r}`))
for(let c=0;c<6;c++)for(let r=0;r<18;r++)for(let offset=0;offset<4;offset++)denseEdges.push(edge(`l${c}r${r}`,`l${c+1}r${(r+offset)%18}`))
for(let c=0;c<6 && denseEdges.length<512;c++)for(let r=0;r<18 && denseEdges.length<512;r++)denseEdges.push(edge(`l${c}r${r}`,`l${c+1}r${(r+4)%18}`))
const dense = graph('容量上限 · 128 个节点 / 512 条关系',denseNodes,denseEdges)

const branchNames = ['验证全部输入已就绪','检查网络可达与权限充足','确认项目兼容且无待迁移数据','采用旧格式迁移并保留所有原始记录','依赖更新后重新验证相关模块','用户提供补充材料后继续规划','目标条件尚未满足需要执行额外检查','选择中止本轮并等待明确恢复条件']
const branches = graph('条件分支 · 选择与排除状态', [leaf('inspect','COMPLETE',{label:'识别工作条件并选择适用路径',selectedBranch:{outcome:'complete',case:branchNames[3],targetId:'case3'}}),
  ...branchNames.map((name,i)=>leaf('case'+i,i===3?'ACTIVE':'INACTIVE',{label:name,branchState:i===3?'SELECTED':'NOT_SELECTED'}))],
  branchNames.map((name,i)=>({from:'inspect',to:'case'+i,kind:'case',case:name})),{active:{nodeId:'case3',recoveryRequired:false}})

const long = '跨地区资料库迁移与兼容性重构：保留原始资料、历史验证记录和任务之间的证据关联。'.repeat(16).slice(0,512)
const longLabels = graph(long, [leaf('source','COMPLETE',{label:long}),leaf('target','ACTIVE',{
  label:'JSONAndVeryLongUnbrokenIdentifier_'.repeat(20).slice(0,480)+' · 中文🙂 العربية / 输出成果目录与测试结果'}),leaf('last','PENDING',{label:long,blocked:true})],
  [edge('source','target'),edge('target','last')],{active:{nodeId:'target',recoveryRequired:false}})

const nestedNodes=[]
for(let i=0;i<14;i++)nestedNodes.push({id:'group'+i,label:`第 ${i+1} 层工作组 · 目录与子系统`,kind:'container',parent:i?'group'+(i-1):'root',status:'CONTAINER_INCOMPLETE'})
nestedNodes.push(leaf('nested1','COMPLETE',{parent:'group13',label:'最深层的输入验收'}),leaf('nested2','ACTIVE',{parent:'group13',label:'最深层的开发与验证'}),leaf('outside','PENDING',{label:'组外成果集成',blocked:true}))
const nested=graph('深层分组 · 16 级层次与跨组依赖',nestedNodes,[edge('nested1','nested2'),edge('nested2','outside')],{active:{nodeId:'nested2',recoveryRequired:false}})

const mixed=graph('状态图例 · 处置结果与分支状态',[
 leaf('done','COMPLETE',{label:'已经验收完成',disposition:'COMPLETED'}),leaf('active','ACTIVE',{label:'正在执行当前叶'}),
 leaf('failed','INCOMPLETE',{label:'执行失败，真实终结回执',disposition:'FAILED'}),leaf('unmet','INCOMPLETE',{label:'验收条件尚未满足',disposition:'UNSATISFIED'}),
 leaf('skipped','SKIPPED',{label:'明确跳过且没有执行',disposition:'SKIPPED_NOT_RUN'}),leaf('blocked','PENDING',{label:'等待未完成的前置',blocked:true}),
 leaf('wait','INACTIVE',{label:'尚待分支选择',branchState:'WAITING'}),leaf('excluded','INACTIVE',{label:'未被选中的条件分支',branchState:'NOT_SELECTED'})],
 [edge('done','active'),edge('failed','blocked'),{from:'active',to:'wait',kind:'route',outcome:'complete'},{from:'active',to:'excluded',kind:'route',outcome:'incomplete'}],
 {active:{nodeId:'active',recoveryRequired:false}})
const stopped=graph('当前无可执行任务 · 保留已验收结果', [leaf('blocked1','INCOMPLETE',{label:'网络资源尚不可用',disposition:'UNSATISFIED'}),leaf('blocked2','PENDING',{label:'等待外部条件后的处理',blocked:true})],[edge('blocked1','blocked2')])
const pending=structuredClone(join);pending.pending={operation:'finish',qualification:'UNKNOWN'};pending.active.recoveryRequired=true
const minimal=graph('最小任务图',[leaf('only','PENDING',{label:'独立工作成果验收'})],[],{legalNext:[{id:'only',choice:0}]})
const complete=structuredClone(join);complete.title='已完成 · 所有交付结果验收通过';complete.active=null
complete.nodes=complete.nodes.map(n=>({...n,status:'COMPLETE',blocked:undefined,disposition:n.kind==='leaf'?'COMPLETED':undefined}))
// Group gates retain real scope boundaries in both expanded and level views.
const hierarchical = graph('分层终审 · 数据迁移与整体验收', [
 {id:'g1',kind:'container',label:'数据准备与迁移',parent:'root',status:'CONTAINER_INCOMPLETE',terminal:'g1_end',acceptance:'完整迁移获准范围内的数据，保留无法获取部分的真实限制。',gate:'GROUP_REVIEW'},
 leaf('g1_work','INCOMPLETE',{parent:'g1',label:'源数据提取 · 缺少可选历史数据',disposition:'UNSATISFIED'}),
 leaf('g1_end','COMPLETE',{parent:'g1',label:'迁移核验与组内交付',isTerminal:true}),
 {id:'g2',kind:'container',label:'最终发布与回验',parent:'root',status:'CONTAINER_INCOMPLETE',terminal:'g2_end',acceptance:'基于已验收的组报告完成发布与回验。',isTerminal:true},
 leaf('g2_end','PENDING',{parent:'g2',label:'发布与回验',isTerminal:true}),
],[edge('g1_work','g1_end'),edge('g1','g2')], {hierarchy:{version:1,maxGroupDepth:3,focusScopeId:'root',complete:false,pending:{kind:'GROUP_REVIEW',scopeId:'g1',subjectId:'g1_end'}}})
hierarchical.nodes[0].terminal='g2';hierarchical.nodes[0].acceptance='完成迁移、发布和整体回验。'
const hierarchicalLocal=structuredClone(hierarchical);hierarchicalLocal.hierarchy.focusScopeId='g1'
const hierarchicalDone=structuredClone(hierarchical);hierarchicalDone.hierarchy.complete=true;hierarchicalDone.hierarchy.pending=null
hierarchicalDone.nodes=hierarchicalDone.nodes.map(node=>node.id==='g1_work'?node:{...node,status:'COMPLETE',gate:null})
const hierarchicalDeep=structuredClone(hierarchical);hierarchicalDeep.nodes.find(node=>node.id==='g1').terminal='sub'
hierarchicalDeep.nodes.push({id:'sub',kind:'container',label:'嵌套子组 · 迁移验证',parent:'g1',status:'CONTAINER_INCOMPLETE',terminal:'g1_end',acceptance:'验证迁移结果',isTerminal:true,gate:'GROUP_REVIEW'})
hierarchicalDeep.nodes.filter(node=>['g1_work','g1_end'].includes(node.id)).forEach(node=>node.parent='sub')
hierarchicalDeep.nodes.find(node=>node.id==='g1').gate=null
hierarchicalDeep.hierarchy.focusScopeId='sub';hierarchicalDeep.hierarchy.pending.scopeId='sub'

const hierarchicalPaused=structuredClone(hierarchicalLocal)
hierarchicalPaused.nodes.find(node=>node.id==='g1').gate='WAITING_USER'
const hierarchicalUpdating=structuredClone(hierarchical)
hierarchicalUpdating.nodes.find(node=>node.id==='g1').gate=null
hierarchicalUpdating.nodes[0].gate='GRAPH_AUDIT'
const multi = graph('多组协作 · 数据准备、并行实现与最终交付', [], [], {
 hierarchy:{version:1,maxGroupDepth:3,focusScopeId:'build',complete:false,pending:null},active:{nodeId:'build_check',recoveryRequired:false},
})
for(const [id,label,count] of [['prepare','输入整理与范围确认',2],['build','核心能力实现与验证',3],['docs','使用说明与迁移文档',1],['delivery','整体集成、质量检查与发布交付',2]]){
 const names=count===3?['work','check','end']:count===2?['work','end']:['end']
 multi.nodes.push({id,label,kind:'container',parent:'root',status:id==='prepare'?'COMPLETE':'CONTAINER_INCOMPLETE',terminal:`${id}_end`,isTerminal:id==='delivery'?true:undefined})
 names.forEach((key,i)=>multi.nodes.push(leaf(`${id}_${key}`,id==='prepare'?'COMPLETE':`${id}_${key}`==='build_check'?'ACTIVE':'PENDING',{
  parent:id,label:`${label} · ${['准备与实现','检查与验证','验收与交付'][i]}`,isTerminal:key==='end'?true:undefined})))
 for(let i=1;i<names.length;i++)multi.edges.push(edge(`${id}_${names[i-1]}`,`${id}_${names[i]}`))
}
multi.nodes[0].terminal='delivery'
multi.edges.push(edge('prepare','build'),edge('prepare','docs'),edge('build','delivery'),edge('docs','delivery'),edge('prepare','delivery'))
const many=graph('大规模分组 · 128 个节点及跨组长依赖',[],[],{
 hierarchy:{version:1,maxGroupDepth:3,focusScopeId:'batch6',complete:false,pending:null},active:{nodeId:'batch6_task4',recoveryRequired:false},
})
for(let g=0;g<12;g++){
 const id='batch'+g,count=g===11?16:9
 many.nodes.push({id,label:`阶段 ${g+1} · 资料迁移与成果校核`,kind:'container',parent:'root',status:g<6?'COMPLETE':'CONTAINER_INCOMPLETE',terminal:`${id}_task${count-1}`,isTerminal:g===11?true:undefined})
 for(let i=0;i<count;i++){
  many.nodes.push(leaf(`${id}_task${i}`,g<6?'COMPLETE':g===6&&i===4?'ACTIVE':'PENDING',{parent:id,label:`${g+1}.${i+1} · 处理与验证阶段成果`,isTerminal:i===count-1?true:undefined}))
  if(i)many.edges.push(edge(`${id}_task${i-1}`,`${id}_task${i}`))
 }
 if(g)many.edges.push(edge('batch'+(g-1),id))
}
many.nodes[0].terminal='batch11';many.edges.push(edge('batch0','batch11'))
const groupLabels=structuredClone(hierarchicalDeep)
groupLabels.nodes.filter(node=>node.kind==='container').forEach(node=>node.label=long)
// JSON transport omits optional undefined fields, exactly like real RPC.
const clean = v => JSON.parse(JSON.stringify(v))
export const visualFixtures = clean({
 hierarchy_multi:{graph:multi},hierarchy_many:{graph:many,execution:execution('running')},hierarchy_labels:{graph:groupLabels},
 hierarchy:{graph:hierarchical,execution:execution('running',{activity:{stage:'group_audit',kind:'model',sessionId:null,step:3,tool:null,at:'2026-11-16T00:15:00.000Z'}})},
 hierarchy_paused:{graph:hierarchicalPaused,execution:execution('paused',{pauseKind:'normal',reason:'等待用户补充获准输入后重新分析。'})},
 hierarchy_updating:{graph:hierarchicalUpdating,execution:execution('running',{activity:{stage:'scope_audit',kind:'model',sessionId:null,step:5,tool:null,at:'2026-11-16T00:15:00.000Z'}})},
 hierarchy_local:{graph:hierarchicalLocal},hierarchy_done:{graph:hierarchicalDone,execution:execution('complete')},hierarchy_deep:{graph:hierarchicalDeep},
 minimal:{graph:minimal}, join:{graph:join,execution:execution('running',{activity:{stage:'EXECUTING',kind:'model',sessionId:'visual-leaf',step:12,tool:null,at:'2026-11-15T01:30:00.000Z'}})},
 chain:{graph:chain,execution:execution('running')}, wide:{graph:wide}, dense:{graph:dense}, branches:{graph:branches},
 long:{graph:longLabels}, nested:{graph:nested}, mixed:{graph:mixed}, blocked:{graph:stopped,execution:execution('blocked',{reason:'当前双图没有可执行叶，等待核对受阻原因。',phase:'BLOCKAGE_HANDLING'})},
 pending:{graph:pending,execution:execution('interrupted',{pauseKind:'unexpected',reason:'请求已中断，已完成的工具结果保持不变。核对保存状态后继续当前尝试。'.repeat(4)})},
 paused:{graph:join,execution:execution('paused',{pauseKind:'normal'})},complete:{graph:complete,execution:execution('complete')},
 planning:{graph:null,execution:execution('running',{phase:'PREPLANNING',activity:{stage:'PREPLANNING',kind:'tool',sessionId:'visual-planner',step:3,tool:'bash',at:'2026-11-15T01:30:00.000Z'}})},
})

export const visualCases = [
 ['groups-multi','hierarchy_multi',1920,1080,'dark','viewer'],['groups-multi-laptop','hierarchy_multi',1280,720,'light','viewer'],
 ['groups-many','hierarchy_many',1440,900,'dark','viewer'],['groups-long-labels','hierarchy_labels',1280,720,'light','viewer'],
 ['groups-english','hierarchy_multi',1440,900,'light','viewer'],
 ['hierarchy-paused','hierarchy_paused',1280,720,'dark','viewer'],['hierarchy-paused-mobile','hierarchy_paused',390,844,'light','panel'],
 ['hierarchy-updating','hierarchy_updating',1440,1000,'light','viewer'],
 ['hierarchy-root','hierarchy',1440,1000,'dark','viewer'],['hierarchy-local','hierarchy_local',1280,720,'light','viewer'],
 ['hierarchy-mobile','hierarchy',390,844,'light','viewer'],['hierarchy-narrow','hierarchy_local',320,640,'dark','viewer'],
 ['hierarchy-done','hierarchy_done',1440,1000,'light','viewer'],['hierarchy-deep','hierarchy_deep',1280,720,'dark','viewer'],
 ['hierarchy-panel','hierarchy_deep',390,844,'dark','panel'],
 ['join-dark','join',1440,1000,'dark','viewer'],['join-light','join',1440,1000,'light','viewer'],
 ['chain-desktop','chain',1440,1000,'dark','viewer'],['wide-desktop','wide',1440,1000,'dark','viewer'],
 ['dense-desktop','dense',1440,1000,'dark','viewer'],['branches-dark','branches',1440,1000,'dark','viewer'],
 ['branches-light','branches',1280,720,'light','viewer'],['long-desktop','long',1280,720,'dark','viewer'],
 ['long-mobile','long',390,844,'light','viewer'],['nested-panel','nested',390,844,'dark','panel'],
 ['nested-viewer','nested',1440,1000,'light','viewer'],['mixed-desktop','mixed',1440,1000,'dark','viewer'],
 ['blocked-mobile','blocked',320,640,'dark','viewer'],['pending-mobile','pending',390,844,'dark','viewer'],
 ['landscape','join',844,390,'light','viewer'],['paused-panel','paused',390,844,'light','panel'],
 ['complete-desktop','complete',1440,1000,'light','viewer'],['minimal-mobile','minimal',320,640,'light','viewer'],
 ['planning-mobile','planning',390,844,'dark','panel'],['long-panel','long',320,640,'light','panel'],
 ['wide-mobile','wide',390,844,'dark','viewer'],['dense-light','dense',1440,1000,'light','viewer'],
 ['chain-tablet','chain',768,1024,'light','viewer'],['stale-panel','join',390,844,'light','stale'],
].map(([id,fixture,width,height,theme,surface])=>({id,fixture,width,height,theme,surface,...(id==='groups-english'?{lang:'en'}:{})}))
