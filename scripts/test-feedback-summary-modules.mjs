#!/usr/bin/env node
/** 当前反馈的组件边界回归；纯合成数据，headless，禁止网络，不访问前台键鼠。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(repo, '../shots/takeover-current', 'feedback-summary-' + new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(out, { recursive: true });
const fixture = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/fixtures/cf-quota-synthetic-20.json'), 'utf8'))['GET /api/cf/quota'].body;
const entry = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PageSearchContext } from './src/PageSearch.tsx';
import { EditorialQuotaPressure } from './src/EditorialViews.tsx';
import { DataKeyDirectory } from './src/DataKeyDirectory.tsx';
import { LogsWorkspace } from './src/FlowWorkspaces.tsx';
import { CfQuotaDashboard } from './src/CfQuotaPage.tsx';
const quotas = [
 { account_id: 1, alias: 'Alpha', used: 110, total: 100, available: -10 },
 { account_id: 2, alias: 'Beta', used: 20, total: 200, available: 180 },
 { account_id: 3, alias: 'Failed', used: 0, total: 0, available: 0, error: '合成读取失败' },
];
const groups = Array.from({length: 13}, (_, i) => ({account_id:i+1, alias:'Account '+(i+1), keys:[{key_id:i+1,key_name:'Key '+(i+1),api_key:'synthetic-key-'+i,status:'active',request_count:i,last_used_at:null,has_secret:true}]}));
const logs = ['SUCCESS','警告','info','failed'].map((type,i) => ({id:i,type,category:'sync',message:'Event '+i,details:'Raw details '+i,created_at:'2026-10-17T00:00:00Z'}));
function Harness() {
 const [view, setView] = useState('quota'), [query, setQuery] = useState(''), [zero, setZero] = useState(false);
 window.choose = v => {setView(v);setQuery('');}; window.zero = v => setZero(v);
 return <PageSearchContext.Provider value={{query,setQuery}}><label>顶栏搜索<input type='search' value={query} onChange={e=>setQuery(e.target.value)} /></label>
 {view==='quota' ? <EditorialQuotaPressure quotas={zero ? quotas.map(q=>({...q,total:0})) : quotas}/>
 : view==='cf' ? <CfQuotaDashboard accounts={window.fixture.accounts.slice(0,2)} limits={null} loading={false} onRefresh={()=>{}} updatedAt={0} interfaceStyle='design'/>
 : view==='key' ? <DataKeyDirectory groups={groups} onCreate={()=>{}} onInspect={()=>{}} renderActions={()=>null}/>
 : view==='cards' ? <div className='mapped-key-account-grid'>{groups.slice(0,6).map(group=><section className='mapped-key-account-group' key={group.account_id}><div className='mapped-key-grid'><article className='mapped-key-card' data-key-card><header>{group.alias}</header><dl><div><dt>API Key</dt><dd><code>{group.keys[0].api_key}</code></dd></div><div><dt>API Secret</dt><dd><button>显示</button></dd></div></dl><footer><button>查看凭据</button></footer></article></div></section>)}</div>
 : <LogsWorkspace logs={logs} dataStyle={false} loading={false} updatedAt={0} error='' pendingCount={0} onApplyPending={()=>{}} onRefresh={()=>{}} onClear={()=>{}} clearBusy={false} category='all' onCategory={()=>{}}/>}</PageSearchContext.Provider>;
} createRoot(document.getElementById('root')).render(<Harness/>);`;
const bundle = await build({ stdin: { contents: entry, loader: 'tsx', resolveDir: path.join(repo, 'frontend') }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' } });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors = [], tests = [], shots = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', route => route.abort());
const baseCss = fs.readdirSync(path.join(repo, 'frontend/dist/assets')).filter(name => name.endsWith('.css')).map(name=>fs.readFileSync(path.join(repo, 'frontend/dist/assets', name),'utf8')).join('\n');
const overrides = ['editorial-workspace.css','mapped-management.css','cf-quota.css','flow-workspaces.css'].map(name=>fs.readFileSync(path.join(repo,'frontend/src',name),'utf8')).join('\n');
await page.setContent('<style>'+baseCss+'\n'+overrides+'\nbody{padding:24px;background:var(--bg-base);font-family:Arial,sans-serif}#root>label{display:block;margin-bottom:20px}#root>label>input{height:40px;border:1px solid #ccc;margin-left:12px}</style><div id="root"></div>');
await page.evaluate(value => { window.fixture=value; }, fixture);
await page.addScriptTag({ content: bundle.outputFiles[0].text });
const check = async (name, callback) => { try { await callback(); tests.push({name,passed:true}); console.log('PASS '+name); } catch(e) { tests.push({name,passed:false,error:e.message}); console.log('FAIL '+name+': '+e.message); } };
const choose = async view => { await page.evaluate(value => window.choose(value),view); await page.waitForTimeout(50); };
const snapshot = async name => { const file=name+'.png'; await page.screenshot({path:path.join(out,file),animations:'disabled'});shots.push(file); };
try {
 await check('配额总览来自全部已读账号，排除失败假零且不随筛选改变',async()=>{
  const overview=page.getByLabel('全部账户配额总览');
  assert.match(await overview.innerText(),/43\.3%/);assert.match(await overview.innerText(),/130/);assert.match(await overview.innerText(),/300/);assert.match(await overview.innerText(),/2 \/ 3/);
  await page.getByRole('searchbox').fill('Beta');assert.equal(await page.locator('.ew-pressure-select').count(),1);
  await page.locator('.ew-pressure-select').click();assert.match(await overview.innerText(),/43\.3%/);assert.match(await page.locator('.ew-quota-detail').innerText(),/200/);
  await page.getByRole('searchbox').fill('');await snapshot('quota-all-accounts');
 });
 await check('总额度零仍未知，不制造0%正常',async()=>{await page.evaluate(()=>window.zero(true));assert.match(await page.getByLabel('全部账户配额总览').innerText(),/使用率未知/);await page.evaluate(()=>window.zero(false));});
 await check('API账本只读顶栏搜索，稳定列线与摘要不丢',async()=>{await choose('key');assert.equal(await page.getByRole('searchbox').count(),1);assert.equal(await page.locator('.mapped-key-summary').count(),1);assert.match(await page.locator('.mapped-key-summary').innerText(),/账号/);assert.equal((await page.locator('.mapped-key-row.is-head').first().innerText()).replace(/\s+/g,' '), '凭据名称 / API KEY 状态 累计请求 最后使用 操作');assert.equal(await page.locator('.mapped-key-row:not(.is-head)').first().locator(':scope > *').count(),5);await page.getByRole('button',{name:'下一页',exact:true}).click();await page.getByRole('searchbox').fill('Account 1');assert.match(await page.locator('.mapped-key-group-title').first().innerText(),/Account 1/);await page.getByRole('searchbox').fill('not-found');assert.match(await page.locator('.mapped-key-directory').innerText(),/没有匹配/);});
 await check('密钥卡片随实际容器宽度多列，窄屏单列且不截控件',async()=>{await choose('cards');for(const width of [1440,1920,768,390]){await page.setViewportSize({width,height:1000});const rects=await page.locator('[data-key-card]').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,right:r.right};}));const firstRow=rects.filter(r=>Math.abs(r.y-rects[0].y)<1);assert.equal(firstRow.length,width===1920?4:width===1440?3:1);assert(rects.every(r=>r.right<=width));await snapshot('key-cards-'+width);}await page.setViewportSize({width:1440,height:1000});});
 await check('CF摘要标题与账号首列有一致16px内边距',async()=>{await choose('cf');const collection=page.getByLabel('账号摘要',{exact:true});const offsets=await collection.evaluate(node=>{const left=node.getBoundingClientRect().left;const title=node.querySelector('h3').getBoundingClientRect().left-left;const td=node.querySelector('tbody td');const text=td.querySelector('span');return{title,text:text.getBoundingClientRect().left-left,padding:parseFloat(getComputedStyle(td).paddingLeft)};});assert(offsets.title>=16&&offsets.title<=18,JSON.stringify(offsets));assert(Math.abs(offsets.title-offsets.text)<=1,JSON.stringify(offsets));assert.equal(offsets.padding,16);assert.equal(await page.getByRole('searchbox').count(),1);await snapshot('cf-summary-aligned');});
 await check('日志结果按最新要求默认英文，兼容大写与旧中文并保留详情',async()=>{await choose('logs');assert.deepEqual(await page.locator('.log-result').allTextContents(),['success','warning','info','error']);assert.equal(await page.getByRole('searchbox').count(),1);await page.getByLabel('只看失败与警告').check();assert.deepEqual(await page.locator('.log-result').allTextContents(),['warning','error']);await page.getByRole('searchbox').fill('failed');assert.equal(await page.locator('.log-result').count(),0);await page.getByRole('searchbox').fill('error');assert.equal(await page.locator('.log-result').count(),1);await page.getByText('查看详情',{exact:true}).click();assert.match(await page.locator('.log-detail pre').innerText(),/Raw details 3/);await snapshot('log-english-results');});
 assert.deepEqual(errors,[]);
} finally {
 await browser.close();
 const report={synthetic:true,boundary:'Standalone current components; card check validates CSS topology, not full App integration or real accounts.',tests,shots,errors};
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(out);
 if(tests.some(t=>!t.passed)||errors.length) process.exitCode=1;
}
