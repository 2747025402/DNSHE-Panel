#!/usr/bin/env node
/** 当前九项反馈中概览／助力／密钥层级的离线反例；不登录、不访问真实账号。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(repo, '../shots/takeover-current', 'feedback-refinements-' + new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(out, { recursive: true });
const entry = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PageSearchContext } from './src/PageSearch';
import { SourceMappedOverview } from './src/SourceMappedOverview';
import { AssistDirectory, canAssist } from './src/AssistPanels';
import { DataKeyDirectory } from './src/DataKeyDirectory';
const accounts = [
 {account_id:1,name:'Ready account',helper_assist_remaining:7,helper_assist_limit:15,domains:[]},
 {account_id:2,name:'Exhausted account',helper_assist_remaining:0,helper_assist_limit:15,domains:[]},
 {account_id:3,name:'Limit reached',helper_assist_remaining:4,helper_assist_limit:15,helper_limit_reached:true,domains:[]},
 {account_id:4,name:'Unread account',domains:[]}
];
const keys = [{account_id:1,alias:'Parent account',keys:[{key_id:1,key_name:'Child credential',api_key:'synthetic-test-key',status:'active',request_count:120,last_used_at:null}]}];
const overview = {
 domains:{total:53,active:51,expired:2,expiring_soon:3,delegated:32,not_delegated:21},
 accounts:{dnshe:6,cloudflare:2},dnsheAccountCount:6,cloudflareAccountCount:2,
 quota:{available:30,failed:0,accounts:[{account_id:1,alias:'Synthetic owner',used:50,total:80,available:30}]},
 cfAccounts:[],cfUsage:[],assist:{assist_remaining:18,assist_limit:90,upgraded_domains:20,non_upgraded_domains:33},recent:[],
 overviewCols:'auto',quotaColumns:'auto',hiddenQuotaAccounts:[],showQuotaFilter:false,overviewColOptions:[{value:'auto',label:'自动'}],
 onOverviewColsChange:()=>{},onToggleQuotaFilter:()=>{},onSetHiddenQuotaAccounts:()=>{},onRefresh:()=>{},onOpenDomain:()=>{},formatDate:v=>v||'—',
 onNavigate:tab=>{window.navigated=tab;}
};
function Harness(){const [screen,setScreen]=useState('design'),[query,setQuery]=useState('');window.choose=v=>{setScreen(v);setQuery('');};
 window.eligibility=()=>accounts.map(canAssist);
 return <PageSearchContext.Provider value={{query,setQuery}}><label>顶栏搜索<input type='search' value={query} onChange={e=>setQuery(e.target.value)}/></label>
 {screen==='key'?<DataKeyDirectory groups={keys} onCreate={()=>{}} onInspect={()=>{window.inspected=true;}} renderActions={()=>null}/>
 :screen.startsWith('assist')?<AssistDirectory accounts={accounts} history={[]} dataStyle={screen==='assist-data'} onGenerate={()=>{}} onCopy={()=>{}}/>
 :<SourceMappedOverview {...overview} dataStyle={screen!=='design'} view={screen==='cards'?'cards':'list'}/>}
 </PageSearchContext.Provider>;
}createRoot(document.getElementById('root')).render(<Harness/>);`;
const bundle = await build({stdin:{contents:entry,loader:'tsx',resolveDir:path.join(repo,'frontend')},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'}});
const distCss = fs.readdirSync(path.join(repo,'frontend/dist/assets')).filter(file=>file.endsWith('.css')).map(file=>fs.readFileSync(path.join(repo,'frontend/dist/assets',file),'utf8')).join('\n');
const css = ['source-mapped-views.css','overview-assist.css','overview-workspace.css','editorial-workspace.css','mapped-management.css','assist-workspace.css'].map(file=>fs.readFileSync(path.join(repo,'frontend/src',file),'utf8')).join('\n');
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const report = {synthetic:true,tests:[],shots:[],errors:[],network:[]};
page.on('pageerror',error=>report.errors.push(error.message));
await page.route('**/*',route=>{report.network.push(route.request().url());return route.abort();});
await page.setContent('<style>'+distCss+'\n'+css+'\nbody{padding:24px;background:var(--bg-base)}#root>label{display:block;margin-bottom:16px}#root>label input{height:40px;margin-left:12px;border:1px solid var(--border-base)}</style><div id="root"></div>');
await page.addScriptTag({content:bundle.outputFiles[0].text});
const check = async(name,action)=>{try{await action();report.tests.push({name,passed:true});console.log('PASS '+name);}catch(error){report.tests.push({name,passed:false,error:error.message});console.log('FAIL '+name+': '+error.message);}};
const choose = async name=>{await page.evaluate(value=>window.choose(value),name);await page.waitForTimeout(40);};
const shot = async name=>{const file=name+'.png';await page.screenshot({path:path.join(out,file),animations:'disabled'});report.shots.push(file);};
try {
 await check('概览设计与数据都有完整助力摘要且跳转真实页面',async()=>{
  for(const style of ['design','data']){await choose(style);const panel=page.getByLabel('域名助力概览',{exact:true});await panel.waitFor();const text=await panel.innerText();assert.match(text,/18/);assert.match(text,/90/);assert.match(text,/20/);assert.match(text,/33/);await panel.getByRole('button',{name:'管理助力'}).click();assert.equal(await page.evaluate(()=>window.navigated),'assist');await shot('overview-'+style);}
 });
 await check('数据概览合并资产总量与状态，删除重复顶部四格',async()=>{await choose('data');assert.equal(await page.locator('.source-overview-statistics').count(),0);assert.equal(await page.locator('.source-overview-asset-scan').count(),1);const text=await page.locator('.source-overview-asset-scan').innerText();assert.match(text,/53/);assert.match(text,/即将到期 3/);assert.match(text,/已委派/);assert.match(text,/32/);});
 await check('助力资格服从次数用尽标记，不将所有账号当可参与',async()=>{await choose('assist');assert.deepEqual(await page.evaluate(()=>window.eligibility()),[true,false,false,false]);assert.equal(await page.getByLabel('只看可参与').count(),0);assert.equal(await page.locator('.assist-queue-editorial__row').count(),4);assert.equal(await page.locator('.assist-queue-editorial__row[data-eligible=true]').count(),1);assert.match(await page.getByLabel('可参与账号队列').innerText(),/本期次数已用尽/);assert.match(await page.getByLabel('可参与账号队列').innerText(),/7 \/ 15/);await shot('assist-real-quota');});
 await check('密钥账号、凭据名称、掩码分级且查看入口未丢',async()=>{await choose('key');const heading=page.locator('.mapped-key-account-identity');assert.match(await heading.innerText(),/DNSHE 账号/);assert.match(await heading.innerText(),/Parent account/);const identity=page.locator('.mapped-key-identity');assert.match(await identity.innerText(),/Child credential/);assert.match(await identity.innerText(),/API Key/);const offset=await page.locator('.mapped-key-table').evaluate(node=>node.getBoundingClientRect().left-node.parentElement.getBoundingClientRect().left);assert(offset>=16);await identity.click();assert.equal(await page.evaluate(()=>window.inspected),true);await shot('key-hierarchy');});
 await check('四视口浅深截图可读且无横溢',async()=>{for(const width of [390,768,1440,1920])for(const mode of ['data','design','assist','key']){await page.setViewportSize({width,height:1000});await choose(mode);await page.evaluate(()=>document.documentElement.classList.toggle('dark',window.innerWidth===390));const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(size.scroll<=size.width+1,mode+' '+width+' '+JSON.stringify(size));if(width===390||width===1440)await shot(mode+'-'+width);} });
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.network,[]);
}finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(out);if(report.tests.some(test=>!test.passed)||report.errors.length)process.exitCode=1;}
