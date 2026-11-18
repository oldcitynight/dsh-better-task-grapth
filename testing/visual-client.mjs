import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { z } from 'zod'
import { createClientPlugin } from 'graph-client-under-test'
import { graphPresentation, branchLayout } from 'graph-layout-under-test'
import { createRemoteContribution } from '../remote.mjs'
import { visualFixtures } from './visual-fixtures.mjs'

const params=new URLSearchParams(location.search), fixtureId=params.get('case')??'join', fixture=structuredClone(visualFixtures[fixtureId])
if(!fixture)throw Error('Unknown synthetic fixture')
document.documentElement.style.colorScheme=params.get('theme')??'dark'
const sessionId='visual-'+fixtureId
let Dock, locales, failNext=false
const requests=[], controls=[]
const response=()=>({sessionId,status:fixture.graph?'ready':'empty',graph:fixture.graph,execution:fixture.execution??null})
createRemoteContribution(z).descriptors[0].result.create().parse(response())
const api={
 async status(){requests.push('status');if(failNext){failNext=false;return {ok:false}}return {ok:true,value:response()}},
 async control({action}){controls.push(action);fixture.execution={...fixture.execution,state:action==='pause'?'paused':'running',
   canPause:action==='resume',canResume:action==='pause',pauseKind:action==='pause'?'normal':null};return {ok:true,value:response()}},
}
const ctx={effect(fn){fn()},locale:{register(_name,value){locales=value}},remote:{$mount:async()=>()=>{},transactionGraphView:api},
 slots:{inject(_name,fn){fn()},register(_options,component){Dock=component}},inject(_deps,fn){fn(ctx)}}
await createClientPlugin(React,z,createRemoteContribution,graphPresentation,branchLayout).apply(ctx)
const lang=params.get('lang')??'zh'
const t=(key,values={})=>(locales[lang][key]??key).replace(/\{(\w+)\}/g,(_,k)=>values[k]??`{${k}}`)
createRoot(document.getElementById('root')).render(React.createElement(Dock,{sessionId,
 useAccess:()=>true,useSession:selector=>selector({openState:'open',removed:false,running:false}),t}))
window.visual={fixtureId,requests,controls,graph:fixture.graph,failNext(){failNext=true},layout:()=>{
 const stage=document.querySelector('.tg-canvas-stage')
 return fixture.graph&&branchLayout(fixture.graph,stage?.dataset.scopeId??fixture.graph.hierarchy?.focusScopeId,{
  expandedGroups:stage?.dataset.view==='expanded',
  collapsedIds:[...document.querySelectorAll('.tg-collapsed-group .tg-card')].map(node=>node.dataset.nodeId),
 })
}}
