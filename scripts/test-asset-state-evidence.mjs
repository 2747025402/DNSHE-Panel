#!/usr/bin/env node
/** Real API shapes, synthetic identities. No network, login or foreground input. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(repo, '../shots/takeover-current', `asset-state-evidence-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(out, { recursive: true });
const report = { synthetic: true, boundary: 'Real source contract shapes, not a live credential verification.', tests: [], shots: [], errors: [] };
const code = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {EditorialDomainAtlas, EditorialZoneConstellation, EditorialAccountSwitchboard} from './src/EditorialViews';
import {AssetCollection, AssetRecord} from './src/AssetCollection';
import {PageSearchContext} from './src/PageSearch';
import {domainLifeState, domainStatusLabel, domainDelegation} from './src/DomainPresentation';
window.model = {domainLifeState, domainStatusLabel, domainDelegation};
const states = ['已解析', '未解析', '已委派', 'Registered', 'active', '已过期', 'upstream-new-status'];
const domains = Array.from({length: 30}, (_,i) => ({id:i+1, full_domain:'asset-'+String(i+1).padStart(2,'0')+'.example.invalid',status:states[i%states.length],has_dns:i%3===2?0:1,created_at:'2026-10-01',expires_at:'2027-10-01'}));
const groups = [{accountId:1, alias:'合成账号', domains}];
const accounts = [1,2,3].map(id=>({id,alias:'账号 '+id,api_key:'synthetic-key',created_at:'2026-10-01'}));
function Harness() {
 const [view,setView] = useState('domain'), [query,setQuery] = useState(''), [selected,setSelected] = useState(null);
 window.view = v => {setView(v);setQuery('');setSelected(null)};
 const usage={1:{domains:0,readState:'readable',readLabel:'配额快照可读'},2:{domains:5,readState:'cached',readLabel:'Zone读取失败，保留快照'}};
 return <PageSearchContext.Provider value={{query,setQuery}}><header><input type="search" aria-label="工作面搜索" value={query} onChange={e=>setQuery(e.target.value)} /></header><main>
 {view==='domain'?<EditorialDomainAtlas groups={groups} selected={selected} onSelect={setSelected} onClose={()=>setSelected(null)} onDns={()=>{}}/>
 :view==='zone'?<EditorialZoneConstellation groups={groups.map(g=>({...g,domains:g.domains.map(d=>({...d,status:'active'}))}))} selected={selected} onSelect={setSelected} onClose={()=>setSelected(null)}/>
 :view==='account'?<EditorialAccountSwitchboard dnshe={accounts} cloudflare={[]} usageByAccount={usage} onDnsheEdit={()=>{}} onDnsheDelete={()=>{}} onCfEdit={()=>{}} onCfDelete={()=>{}} onBindDnshe={()=>{}} onBindCf={()=>{}}/>
 :<><div className="list-intro">表格前置内容</div><AssetCollection view="list" label="资产表格">{Array.from({length:60},(_,i)=><AssetRecord key={i} name={<button>asset-{i}.example.invalid</button>} status="已解析" created="2026/10/01" expires="2027/10/01" provider="系统默认" actions={<button>DNS解析</button>}/>)}</AssetCollection></>}
 </main></PageSearchContext.Provider>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
`;
const bundle = await build({stdin:{contents:code, loader:'tsx', resolveDir:path.join(repo,'frontend')}, bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'}});
const css = ['editorial-workspace.css','asset-collection.css','interface-style.css'].map(f=>fs.readFileSync(path.join(repo,'frontend/src',f),'utf8')).join('\n');
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
page.on('pageerror',e=>report.errors.push(e.message));
await page.route('**/*',r=>r.abort());
await page.setContent(`<style>:root{--text-primary:#18181b;--text-secondary:#3f3f46;--text-muted:#71717a;--border-base:#e4e4e7;--border-soft:#f0f0f1;--bg-surface:#fff;--bg-elevated:#f4f4f5}*{box-sizing:border-box}body{margin:0;font:14px Arial;background:#f7f7f8}header{height:64px;padding:12px 24px;background:white;border-bottom:1px solid #e4e4e7}header input{height:40px;width:320px;padding:0 12px}main{height:calc(100dvh - 64px);overflow-y:auto;padding:24px;margin-left:220px}.list-intro{height:240px}.sr-only{position:absolute;width:1px;height:1px;clip-path:inset(50%)}@media(max-width:767px){main{margin-left:0;padding:12px}}${css}</style><div id="root"></div>`);
await page.addScriptTag({content:bundle.outputFiles[0].text});
const test = async(name,fn)=>{try{await fn();report.tests.push({name,passed:true});console.log('PASS '+name)}catch(e){report.tests.push({name,passed:false,error:e.message});console.log('FAIL '+name+': '+e.message)}};
const choose = async v=>{await page.evaluate(v=>window.view(v),v);await page.waitForTimeout(40)};
try {
 await test('DNSHE实际中文三态不是未知生命周期，DNS标签原样保留',async()=>{
  const result=await page.evaluate(()=>['已解析','未解析','已委派','Registered','active'].map(status=>({state:window.model.domainLifeState({status}),label:window.model.domainStatusLabel({status})})));
  assert.deepEqual(result.map(r=>r.state),Array(5).fill('active'));
  assert.deepEqual(result.slice(0,3).map(r=>r.label),['已解析','未解析','已委派']);
  assert.equal(await page.locator('.ew-object-state').filter({hasText:'待确认'}).count(),0);
  // Old implementation is the regression counterexample, not an accepted fixture.
  const legacy = status=>status==='active'||status==='enabled'||status==='正常'?'active':'unknown';
  assert.equal(legacy('已解析'),'unknown');
 });
 await test('真实过期日、未知上游状态与外部NS分别保真',async()=>{
  const result=await page.evaluate(()=>({expired:window.model.domainLifeState({status:'已解析',expires_at:'2020-01-01'}),unknown:window.model.domainLifeState({status:'upstream-new-status'}),label:window.model.domainStatusLabel({status:'upstream-new-status'}),external:window.model.domainDelegation({has_dns:1,ns1:'ada.ns.cloudflare.com',ns2:'sam.ns.cloudflare.com'})}));
  assert.deepEqual(result,{expired:'expired',unknown:'unknown',label:'未识别状态',external:'external'});
  await page.locator('.editorial-domain-node').filter({hasText:'asset-07'}).click();
  assert((await page.locator('.ew-inspector').innerText()).includes('upstream-new-status'));
  await page.keyboard.press('Escape');
 });
 await test('域名桌面保持四列，检查器打开后不因右侧详情降为三列',async()=>{
  const columns=()=>page.locator('.ew-object-grid').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length);
  assert.equal(await columns(),4);await page.locator('.editorial-domain-node').first().click();assert.equal(await columns(),4);
  await page.screenshot({path:path.join(out,'domain-1440-selected.png')});report.shots.push('domain-1440-selected.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(220);
  assert.equal(await page.locator('.ew-inspector').count(),0);
 });
 await test('域名和Zone共享顶栏搜索，无页内重复搜索',async()=>{
  for(const v of ['domain','zone']){await choose(v);assert.equal(await page.getByRole('searchbox').count(),1);await page.getByRole('searchbox').fill('asset-29');assert.equal(await page.locator('.ew-object-row').count(),1);assert((await page.locator('.ew-object-row').innerText()).includes('asset-29'));}
 });
 await test('账号绑定不冒充实时凭据验证，真实零与缓存证据保留',async()=>{
  await choose('account');const rows=page.locator('.ew-connection-row');
  assert((await rows.nth(0).innerText()).includes('0 个域名'));assert((await rows.nth(0).innerText()).includes('配额快照可读'));
  assert((await rows.nth(1).innerText()).includes('保留快照'));assert(!(await rows.nth(2).innerText()).includes('凭据已验证'));
  assert(!(await page.locator('main').innerText()).includes('验证未读取'));
  await page.getByRole('searchbox').fill('账号 3');assert.equal(await rows.count(),1);
  assert.equal(await page.getByRole('searchbox').count(),1);
 });
 await test('资产表头始终属于集合首行，不悬浮穿插数据行',async()=>{
  await choose('table');const header=page.locator('[data-asset-header]');
  const before=await header.boundingBox();
  assert.equal(await header.evaluate(e=>getComputedStyle(e).position),'static');
  await page.locator('main').evaluate(e=>e.scrollTop=450);
  const after=await header.boundingBox();
  assert(Math.abs(before.y-after.y-450)<=1,'header must scroll with its collection');
  await header.evaluate(e=>{e.style.position='sticky';e.style.top='64px'});
  const old=await header.evaluate(e=>e.getBoundingClientRect().top-e.closest('main').getBoundingClientRect().top);
  assert(old>=63,'negative control must reproduce the floating gap');await header.evaluate(e=>{e.style.position='';e.style.top=''});
  await page.screenshot({path:path.join(out,'asset-header-1440-scrolled.png')});report.shots.push('asset-header-1440-scrolled.png');
 });
 for(const v of ['domain','account']) for(const width of [390,768,1440,1920]) await test(v+'/'+width+'无整页横溢或短状态换行',async()=>{
  await page.setViewportSize({width,height:1000});await choose(v);await page.locator('main').evaluate(e=>e.scrollTop=0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const clipped=await page.locator('.ew-object-state').evaluateAll(es=>es.some(e=>e.scrollWidth>e.clientWidth+1));assert(!clipped);
  const name=v+'-'+width+'.png';await page.screenshot({path:path.join(out,name)});report.shots.push(name);
 });
 await test('无页面JS异常',async()=>assert.deepEqual(report.errors,[]));
}finally{await browser.close();fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify(report,null,2))}
console.log(JSON.stringify({out,passed:report.tests.filter(t=>t.passed).length,total:report.tests.length}));
if(report.tests.some(t=>!t.passed))process.exitCode=1;
