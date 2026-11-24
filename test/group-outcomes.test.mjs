// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test'
import assert from 'node:assert/strict'
import { digest, TransactionGraph, validateDocument, revisedPlan } from '../core.mjs'
import { childrenOf, childUnitResult, scopeSignature } from '../hierarchy.mjs'
import { MemoryGraphStore } from '../store.mjs'
import { formatGraphView } from '../host.mjs'
import { createRemoteContribution } from '../remote.mjs'
import { z } from 'zod'

const group = (key, parent, terminal) => ({ key, label: key, kind: 'container', ...(parent ? {parent} : {}), terminal, acceptance: key })
const leaf = (key, parent) => ({ key, label: key, kind: 'leaf', parent })
const route = (from, outcome, to) => ({kind:'route',from,outcome,to})
function fixture({ mandatory = false } = {}) {
  let serial = 0
  const store = new MemoryGraphStore(), graph = new TransactionGraph(store)
  const op = () => ({expectedRevision:store.read()?.revision ?? 0,operationId:'op_'+ ++serial})
  const plan = {title:'audited alternatives',hierarchy:{version:1,maxGroupDepth:3},
    nodes:[group('root',null,'final'),group('verify','root','check'),leaf('check','verify'),
      group('recover','root','fix'),leaf('fix','recover'),leaf('final','root')],
    edges:[route('verify','blocked','recover'),route('verify','complete','final'),route('recover','complete','final')]}
  if (mandatory) {
    plan.nodes.push(group('signoff','root','sign'),leaf('sign','signoff'))
    plan.edges.push({kind:'prerequisite',from:'signoff',to:'final'})
  }
  graph.create({...op(),definition:plan})
  const next = () => graph.read().legalNext.map(row=>row.label)
  const finish = () => {graph.begin({...op(),choice:0});graph.finish({...op(),outcome:'complete',evidence:[{kind:'artifact',ref:'test'}],note:'done'})}
  function gate(outcome='COMPLETE') {
    const s=store.read().state, pending=s.hierarchy.pending
    const report={outcome,summary:'checked',children:pending.kind==='GROUP_REVIEW'?childrenOf(s.plan,pending.scopeId).map(n=>({id:n.id,sha256:digest(childUnitResult(s,n))})):[],
      ...(outcome==='BLOCKED'?{audit:{action:'BLOCKED',unmetCriterion:'delivered file lacks audio',scopeBoundary:'review has read-only scope',evidence:[{source:'native test'}]}}:{})}
    graph.reviewScope({...op(),scopeId:pending.scopeId,kind:pending.kind,inputHash:scopeSignature(s,pending.scopeId),runId:'test_'+serial,...(pending.kind==='GROUP_REVIEW'?{report}:{})})
  }
  return {graph,store,next,finish,gate,plan}
}
for (const first of ['COMPLETE','BLOCKED']) test('group outcome routing and OR join after '+first,()=>{
  const {graph,store,next,finish,gate}=fixture()
  assert.deepEqual(next(),['check']);finish()
  assert.deepEqual(next(),[]);gate(first);gate()
  if(first==='BLOCKED'){
    assert.deepEqual(next(),['fix']);finish()
    gate();gate()
  }
  assert.deepEqual(next(),['final'])
  const state=store.read().state,remote=formatGraphView(graph.read(),state.plan)
  createRemoteContribution(z).descriptors[0].result.create().parse({status:'ready',sessionId:'test',graph:remote})
  assert.equal(remote.nodes.find(n=>n.label==='verify').selectedBranch.outcome,first.toLowerCase())
  assert.equal(remote.nodes.find(n=>n.label==='recover').branchState,first==='BLOCKED'?'SELECTED':'NOT_SELECTED')
  finish();gate();assert.equal(graph.read().goalReached,true);validateDocument(store.read())
})
test('leaf and cross-scope outcome sources are rejected in hierarchical mode',()=>{
  const {store,plan}=fixture()
  for (const [from,to] of [['check','final'],['verify','fix']]) {
    const bad=structuredClone(plan);bad.edges.push(route(from,'blocked',to))
    assert.throws(()=>revisedPlan(store.read(),bad))
  }
})

test('no successful alternative leaves the final leaf closed after both audited blocks', () => {
  const {graph,store,next,finish,gate}=fixture()
  finish(); gate('BLOCKED'); gate(); finish(); gate('BLOCKED'); gate()
  assert.deepEqual(next(),[])
  const view=graph.read(), final=view.nodes.find(row=>row.label==='final')
  assert.equal(final.branchState,'NOT_SELECTED');assert.equal(final.status,'PENDING')
  assert.equal(view.goalReached,false);validateDocument(store.read())
})

test('a matched alternative still waits for every ordinary prerequisite', () => {
  const {next,finish,gate}=fixture({mandatory:true})
  finish();gate();gate()
  assert.deepEqual(next(),['sign']);finish()
  assert.throws(()=>gate('BLOCKED'),{code:'GROUP_REPORT_INPUT_MISMATCH'})
  gate();gate();assert.deepEqual(next(),['final'])
})
