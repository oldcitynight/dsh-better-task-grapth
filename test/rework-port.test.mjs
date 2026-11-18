import test from 'node:test'
import assert from 'node:assert/strict'
import { TransactionGraph, reworkClosure, revisedPlan, validateDocument } from '../core.mjs'
import { MemoryGraphStore } from '../store.mjs'
const plan = { title: 'Generic opt-in rework', nodes: [{key:'root',kind:'container',label:'Root'},
  ...['a','b','c'].map(key=>({key,kind:'leaf',label:key,parent:'root'}))],
  edges:[{kind:'prerequisite',from:'a',to:'b'},{kind:'prerequisite',from:'b',to:'c'}] }
const evidence=[{kind:'tool_result',ref:'host:review/immutable-decision'}]
function fixture() {
  let id=0; const store=new MemoryGraphStore(), graph=new TransactionGraph(store,{id:p=>`${p}_${++id}`})
  graph.create({operationId:'create',definition:plan})
  const end=(name,outcome='complete')=>{
    graph.begin({expectedRevision:graph.read().revision,operationId:'begin_'+name,choice:0})
    graph.finish({expectedRevision:graph.read().revision,operationId:'finish_'+name,outcome,evidence,note:'Original outcome'})
  }
  return {store,graph,end}
}
test('generic rework port preserves immutable attempts and resets the executed dependency closure',()=>{
  const {store,graph,end}=fixture(); end('a');end('b','incomplete')
  const before=store.read(), a=before.state.plan.nodes.find(n=>n.key==='a').id
  assert.equal(reworkClosure(before.state,[a]).length,2)
  graph.reopen({expectedRevision:5,operationId:'rework',nodeIds:[a],decisionId:'decision_host',evidence,note:'Independent evidence'})
  const after=store.read();validateDocument(after)
  assert.deepEqual(after.events.slice(0,-1),before.events)
  assert.equal(after.state.leaves[a].reopenedFrom,before.state.leaves[a].attemptId)
  assert.equal(graph.read().legalNext.length,1)
  graph.begin({expectedRevision:6,operationId:'begin_again',choice:0})
  assert.notEqual(store.read().state.active.attemptId,before.state.leaves[a].attemptId)
})
test('rework rejects stale revisions, active execution, pending targets and missing evidence without mutation',()=>{
  const {store,graph,end}=fixture();end('a','incomplete');const before=store.read(),a=before.state.plan.nodes.find(n=>n.key==='a').id
  const request={expectedRevision:3,operationId:'rework',nodeIds:[a],decisionId:'decision_host',evidence,note:'Evidence'}
  assert.throws(()=>graph.reopen({...request,expectedRevision:2}),{code:'CAS_CONFLICT'})
  assert.throws(()=>graph.reopen({...request,evidence:[]}),{code:'REWORK_EVIDENCE_REQUIRED'})
  const pending=before.state.plan.nodes.find(n=>n.key==='b').id
  assert.throws(()=>graph.reopen({...request,nodeIds:[pending]}),{code:'REWORK_TERMINAL_TARGET_REQUIRED'})
  assert.deepEqual(store.read(),before)
  graph.reopen(request); graph.begin({expectedRevision:4,operationId:'new_attempt',choice:0})
  assert.throws(()=>graph.reopen({...request,expectedRevision:5,operationId:'during_execution'}),{code:'REWORK_REQUIRES_QUIESCENT_GRAPH'})
})
test('a reopened task remains historically started and cannot be deleted or relabelled by revision',()=>{
  const {store,graph,end}=fixture();end('a','incomplete');const a=store.read().state.plan.nodes.find(n=>n.key==='a').id
  graph.reopen({expectedRevision:3,operationId:'rework',nodeIds:[a],decisionId:'decision_host',evidence,note:'Independent evidence'})
  const changed=structuredClone(plan);changed.nodes.find(n=>n.key==='a').label='Rewrite old task'
  assert.throws(()=>revisedPlan(store.read(),changed),{code:'STARTED_TASK_IMMUTABLE'})
})
