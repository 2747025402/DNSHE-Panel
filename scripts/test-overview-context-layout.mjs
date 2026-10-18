#!/usr/bin/env node
/** 概览双轨布局回归：独立合成数据、headless、禁止网络与真人账号访问。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(repo, '../shots/takeover-current', 'overview-context-' + new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(out, { recursive: true });
const entry = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SourceMappedOverview } from './src/SourceMappedOverview';
const quotaAccounts = Array.from({length:6},(_,i)=>({account_id:i+1,alias:'owner-'+(i+1)+'@example.test',used:8+i,total:16,available:8-i,base:10,invite_bonus:6,error:null}));
const recent = Array.from({length:8},(_,i)=>({id:i+1,full_domain:'recent-'+(i+1)+'.example.test',account_alias:'owner-'+(i%6+1)+'@example.test',created_at:'2026-10-18T08:00:00Z'}));
const usage = ['Workers 请求','D1 行读','KV 读取'].map((label,i)=>({key:'metric-'+i,label,used:1464+i*400,limit:100000,coverage:2,total:2,cached:0,highest:{alias:'cf-owner@example.test',pct:1.5+i}}));
const cfAccounts=[{account_id:1,alias:'CF owner',counts:{zones:32,d1_databases:6,kv_namespaces:5}}];
function Harness(){const [mode,setMode]=useState('design'),[hidden,setHidden]=useState([]),[filter,setFilter]=useState(false);
 window.choose=value=>{setMode(value);document.documentElement.dataset.interfaceStyle=value;};
 const props={dataStyle:mode!=='design',view:mode==='cards'?'cards':'list',domains:{total:53,active:51,expired:2,expiring_soon:3,delegated:32,not_delegated:21},accounts:{dnshe:6,cloudflare:2},dnsheAccountCount:6,cloudflareAccountCount:2,quota:{available:33,failed:0,accounts:quotaAccounts},cfAccounts,cfUsage:usage,cfUpdatedAt:1792310400000,assist:{assist_remaining:18,assist_limit:90,upgraded_domains:34,non_upgraded_domains:16},recent,overviewCols:'auto',quotaColumns:'auto',hiddenQuotaAccounts:hidden,showQuotaFilter:filter,overviewColOptions:[{value:'auto',label:'自动'}],onOverviewColsChange:()=>{},onToggleQuotaFilter:()=>setFilter(value=>!value),onSetHiddenQuotaAccounts:setHidden,onRefresh:()=>{window.refreshed=true;},onOpenDomain:item=>{window.opened=item.id;},formatDate:()=> '10/18 16:00',onNavigate:tab=>{window.navigated=tab;}};
 return <main data-workspace="dashboard"><div className="page-anim"><SourceMappedOverview {...props}/></div></main>;
}createRoot(document.getElementById('root')).render(<Harness/>);`;
const bundle = await build({stdin:{contents:entry,loader:'tsx',resolveDir:path.join(repo,'frontend')},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'}});
const distCss = fs.readdirSync(path.join(repo,'frontend/dist/assets')).filter(file=>file.endsWith('.css')).map(file=>fs.readFileSync(path.join(repo,'frontend/dist/assets',file),'utf8')).join('\n');
const css = ['source-mapped-views.css','overview-assist.css','overview-workspace.css','editorial-workspace.css'].map(file=>fs.readFileSync(path.join(repo,'frontend/src',file),'utf8')).join('\n');
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'reduce'});
const report={synthetic:true,tests:[],shots:[],errors:[],network:[]};
page.on('pageerror',error=>report.errors.push(error.message));
await page.route('**/*',route=>{report.network.push(route.request().url());return route.abort();});
await page.setContent('<style>'+distCss+'\n'+css+'\nbody{background:var(--bg-base);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{padding:24px;height:100dvh;overflow-y:auto}@media(min-width:1024px){main{margin-left:248px}}</style><div id="root"></div>');
await page.evaluate(()=>document.documentElement.dataset.interfaceStyle='design');
await page.addScriptTag({content:bundle.outputFiles[0].text});
const check=async(name,action)=>{try{await action();report.tests.push({name,passed:true});console.log('PASS '+name);}catch(error){report.tests.push({name,passed:false,error:error.message});console.log('FAIL '+name+': '+error.message);}};
const choose=async(mode)=>{await page.evaluate(value=>window.choose(value),mode);await page.waitForTimeout(30);};
const shot=async(name)=>{
 await page.locator('main').evaluate(node=>{node.scrollTop=0;});
 await page.screenshot({path:path.join(out,name+'.png'),fullPage:true,animations:'disabled'});report.shots.push(name+'.png');
 const canScroll=await page.locator('main').evaluate(node=>node.scrollHeight>node.clientHeight+1);
 if(canScroll){await page.locator('main').evaluate(node=>{node.scrollTop=node.scrollHeight;});await page.screenshot({path:path.join(out,name+'-bottom.png'),animations:'disabled'});report.shots.push(name+'-bottom.png');await page.locator('main').evaluate(node=>{node.scrollTop=0;});}
};
try {
 await check('设计风最近注册紧邻CF右轨，CF不再单独被拉成长空白',async()=>{
  const geometry=await page.locator('.overview-design-hero').evaluate(node=>{
   const rect=selector=>{const n=node.querySelector(selector),r=n.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom,minHeight:getComputedStyle(n).minHeight};};
   return {asset:rect('.overview-design-asset-track'),cf:rect('.dashboard-cf-usage-panel'),recent:rect('.overview-recent-panel'),context:rect('.overview-design-context-track')};
  });
  assert(geometry.cf.x>geometry.asset.x,JSON.stringify(geometry));
  assert.equal(geometry.cf.minHeight,'0px');
  assert(Math.abs(geometry.cf.x-geometry.recent.x)<=1,JSON.stringify(geometry));
  assert(Math.abs(geometry.cf.w-geometry.recent.w)<=1,JSON.stringify(geometry));
  assert(Math.abs(geometry.cf.bottom-geometry.recent.y)<=1,JSON.stringify(geometry));
  assert(geometry.recent.y<geometry.asset.bottom,JSON.stringify(geometry));
  assert.equal(await page.locator('.overview-recent-panel').count(),1);
  assert.equal(await page.locator('.overview-capacity-item').count(),6);
  assert.equal(await page.locator('.overview-registration-row').count(),8);
 });
 await check('原最近注册定位、CF入口和账号配额筛选仍可用',async()=>{
  await page.locator('.overview-registration-row').first().click();assert.equal(await page.evaluate(()=>window.opened),1);
  await page.getByRole('button',{name:'查看用量',exact:true}).click();assert.equal(await page.evaluate(()=>window.navigated),'cfquota');
  await page.getByRole('button',{name:'筛选',exact:true}).click();await page.getByRole('button',{name:'全不选',exact:true}).click();assert.equal(await page.locator('.overview-capacity-item').count(),0);
  await page.getByRole('button',{name:'全选',exact:true}).click();assert.equal(await page.locator('.overview-capacity-item').count(),6);
  await page.getByRole('button',{name:'筛选',exact:true}).click();
 });
 await check('桌面至手机、浅深主题保持无横溢，窄屏按配额CF最近注册顺序',async()=>{
  for(const width of [390,768,1440,1920])for(const dark of [false,true]){
   await page.setViewportSize({width,height:1100});await page.evaluate(value=>document.documentElement.classList.toggle('dark',value),dark);
   const geometry=await page.evaluate(()=>{
    const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom};};
    return{scroll:document.documentElement.scrollWidth,width:innerWidth,asset:rect('.overview-design-asset-track'),cf:rect('.dashboard-cf-usage-panel'),recent:rect('.overview-recent-panel')};
   });
   assert(geometry.scroll<=geometry.width+1,JSON.stringify(geometry));
   if(width<=960){assert(geometry.cf.y>=geometry.asset.bottom-1,JSON.stringify(geometry));assert(geometry.recent.y>=geometry.cf.bottom-1,JSON.stringify(geometry));}
   await shot('design-'+width+'-'+(dark?'dark':'light'));
  }
 });
 await check('数据与卡片模式仍保留全部内容，不受设计双轨改动影响',async()=>{
  await page.setViewportSize({width:1440,height:1100});await page.evaluate(()=>document.documentElement.classList.remove('dark'));
  for(const mode of ['data','cards']){await choose(mode);assert.equal(await page.locator('.overview-design-context-track').count(),0);assert.equal(await page.getByLabel('最近注册',{exact:true}).count(),1);assert.equal(await page.locator('.source-overview-cf').count(),1);assert.match(await page.locator('.source-overview-quota').innerText(),/owner-6@example\.test/);await shot(mode+'-1440');}
 });
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.network,[]);
}finally{
 await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(out);
 if(report.tests.some(test=>!test.passed)||report.errors.length)process.exitCode=1;
}
