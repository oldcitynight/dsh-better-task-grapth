// Optional browser suite. Dependencies live in an isolated directory, never in
// the installed DSH profile. Real frontend components; synthetic RPC only.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {visualCases} from './visual-fixtures.mjs'
import {checkInteractions,prepareUnitInsertion} from './visual-interactions.mjs'

const packageRoot=path.resolve(fileURLToPath(new URL('..',import.meta.url)))
const workspace=process.cwd(), deps=path.resolve(process.env.DSH_UI_TEST_DEPS??'.tmp/task-graph-visual-20261115/node_modules')
const source=path.resolve(process.env.DSH_UI_TEST_SOURCE??packageRoot)
const baseline=process.env.DSH_UI_TEST_BASELINE==='1'
const output=path.resolve(process.argv[2]??'docs/audits/task-graph-visual-20261115/after')
fs.mkdirSync(output,{recursive:true})
const {build}=await import(pathToFileURL(path.join(deps,'esbuild/lib/main.js')))
const {chromium}=await import(pathToFileURL(path.join(deps,'playwright/index.mjs')))
const zod=process.env.DSH_UI_TEST_ZOD??path.join(workspace,'releases/compatibility-0.3.1-0.1.1/runtime/0.2.1-rc.5/node_modules/zod/index.js')
const bundle=await build({entryPoints:[path.join(packageRoot,'testing/visual-client.mjs')],bundle:true,write:false,format:'esm',platform:'browser',
 nodePaths:[deps],alias:{'graph-client-under-test':path.join(source,'client.source.mjs'),'graph-layout-under-test':path.join(source,'view-model.mjs'),zod},
 define:{'process.env.NODE_ENV':'"production"'}})
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated task graph visual test</title>
<style>:root{font-family:system-ui,"Noto Sans CJK SC",sans-serif;color:light-dark(#242833,#e6e8ed);background:light-dark(#f7f8fa,#191b20);--dsw-alias-bg-base:light-dark(#fafbfc,#1d2026);--dsw-specific-menu:light-dark(#fff,#252831);--dsw-alias-label-primary:light-dark(#242833,#e6e8ed);--dsw-alias-label-secondary:light-dark(#626b78,#a4acbb);--dsw-alias-border-l1:light-dark(#dce0e6,#414750)}*{box-sizing:border-box}body{margin:0}header{padding:18px 24px;font-size:13px;color:var(--dsw-alias-label-secondary)}#root{padding-block:18px}button{font-family:inherit}body:after{content:'隔离视觉用例 · 不连接会话或模型';display:block;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary);padding:24px}</style>
<header>任务图 · 组件视觉回归</header><div id="root"></div><script type="module" src="/app.js"></script></html>`
const server=http.createServer((req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].contents:html)})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
let browser
const results=[], failures=[]
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.DSH_UI_TEST_CHROME??'/home/oldcitynight/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
  env:{...process.env,TMPDIR:'/tmp'},args:['--no-sandbox']})
 const extraCases=[{id:'english-mobile',fixture:'pending',width:390,height:844,theme:'light',surface:'viewer',lang:'en'},
  {id:'small-panel',fixture:'join',width:260,height:640,theme:'dark',surface:'panel'},
  {id:'join-large',fixture:'join',width:1920,height:1080,theme:'dark',surface:'viewer'},
  {id:'unit-insertion',fixture:'join',width:740,height:900,theme:'light',surface:'panel'}]
 for(const row of [...visualCases,...extraCases].filter(row=>!process.env.DSH_UI_TEST_CASES||process.env.DSH_UI_TEST_CASES.split(',').includes(row.id))){
  const context=await browser.newContext({viewport:{width:row.width,height:row.height},locale:'zh-CN',colorScheme:row.theme,reducedMotion:'reduce'})
  const page=await context.newPage(), errors=[]
  page.setDefaultTimeout(5000)
  page.on('pageerror',error=>errors.push(error.message))
  const outside=[]
  page.on('request',req=>{if(!req.url().startsWith(`http://127.0.0.1:${server.address().port}/`))outside.push(req.url())})
  try{
   const revisedGraph = row.id === 'unit-insertion' ? await prepareUnitInsertion(page) : undefined
   await page.goto(`http://127.0.0.1:${server.address().port}/?case=${row.fixture}&theme=${row.theme}&lang=${row.lang??'zh'}`)
   await page.locator('.tg-dock').waitFor()
   if(row.surface==='viewer')await page.locator('.tg-top button[aria-haspopup="dialog"]').click()
   else if(await page.locator('.tg-header').count())await page.locator('.tg-header').click()
   if(row.surface==='stale'){
    await page.evaluate(()=>window.visual.failNext());await page.getByRole('button',{name:'刷新',exact:true}).first().click()
    await page.getByText('暂时无法读取事务图',{exact:true}).first().waitFor()
   }
   await page.evaluate(()=>document.fonts.ready)
   if(row.surface==='viewer'&&!baseline)await page.locator('.tg-canvas-scroll[data-ready=true]').waitFor()
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
   const metrics=await page.evaluate(()=>{
    const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}}
    const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'
    const dialog=document.querySelector('dialog[open]'),scroll=dialog?.querySelector('.tg-canvas-scroll')
    const cards=[...(dialog?.querySelectorAll('.tg-card')??[])],badges=[]
    for(const card of cards){const c=rect(card);for(const e of card.querySelectorAll('.tg-card-states')){const r=rect(e);if(r.bottom>c.bottom+.5||r.right>c.right+.5)badges.push(card.title)}}
    const controls=[...(dialog??document).querySelectorAll('button,select')].filter(e=>visible(e)&&!e.closest('.tg-canvas')&&!e.classList.contains('tg-link-button')&&!e.classList.contains('tg-node'))
    return {bodyOverflow:document.documentElement.scrollWidth>innerWidth+1,canvas:scroll?{...rect(scroll),scrollWidth:scroll.scrollWidth,scrollHeight:scroll.scrollHeight}:null,
      cards:cards.length,groups:dialog?.querySelectorAll('.tg-group-frame').length??0,wires:dialog?.querySelectorAll('.tg-wire').length??0,expectedWires:window.visual.layout()?.wires.length??0,
      badgeOverflow:badges,offscreenControls:controls.filter(e=>{const r=rect(e);return r.x<0||r.right>innerWidth+1||r.y<0||r.bottom>innerHeight+1}).map(e=>e.textContent),
      title:dialog?.querySelector('h2')?.textContent,controlsCalled:[...window.visual.controls]}
   })
   await page.screenshot({path:path.join(output,row.id+'.png'),animations:'disabled'})
   if(!baseline){
    assert.equal(metrics.bodyOverflow,false,'page must not overflow horizontally')
    assert.deepEqual(metrics.badgeOverflow,[],'status badges stay inside cards')
    assert.deepEqual(metrics.offscreenControls,[],'controls stay inside the viewport')
    if(metrics.canvas)assert.ok(metrics.canvas.height>=150,'small screens retain a usable graph canvas')
   }
   const interactions=baseline?[]:await checkInteractions(page,row,output,revisedGraph)
   assert.deepEqual(errors,[]);assert.deepEqual(outside,[])
   if(row.surface==='viewer')assert.equal(metrics.wires,metrics.expectedWires,'every reduced edge is in the SVG')
   results.push({...row,metrics,interactions,errors,externalRequests:outside})
   console.log(row.id,JSON.stringify({canvas:metrics.canvas&&[Math.round(metrics.canvas.width),Math.round(metrics.canvas.height)],overflow:metrics.bodyOverflow,badges:metrics.badgeOverflow.length,offscreenControls:metrics.offscreenControls.length}))
  }catch(error){failures.push({case:row.id,error:error.stack,browserErrors:errors});console.log('FAILED',row.id,error.message,JSON.stringify(errors))}
  finally{await context.close()}
 }
 fs.writeFileSync(path.join(output,'RESULTS.json'),JSON.stringify({source,baseline,syntheticRPC:true,realModelRequests:0,results,failures},null,2)+'\n')
 assert.deepEqual(failures,[])
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
