/** 合成凭据、当前源码 CSS：状态无贴片、无叠加标记，浅深主题与行级动作不退化。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(repo, '../shots/takeover-current/key-surface-' + new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(out, { recursive: true });
const css = fs.readFileSync(path.join(repo, 'frontend/src/mapped-management.css'), 'utf8');
const tokens = fs.readFileSync(path.join(repo, 'frontend/src/index.css'), 'utf8');
const themeCss = [tokens.match(/^:root\s*\{[^}]+\}/m)?.[0], tokens.match(/^\.dark\s*\{[^}]+\}/m)?.[0]].join('\n');
const entry = `import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DataKeyDirectory} from './src/DataKeyDirectory';
import {PageSearchContext} from './src/PageSearch';
const keys=Array.from({length:3},(_,i)=>({key_id:i,key_name:'应用凭据 '+(i+1),api_key:'synthetic-key-'+i,status:i===2?'revoked':'active',request_count:100+i,last_used_at:'2026-10-18 10:00:00'}));
function App(){const [query,setQuery]=useState('');window.search=setQuery;window.actions=[];
return <PageSearchContext.Provider value={{query,setQuery}}><DataKeyDirectory groups={[{account_id:1,alias:'synthetic-owner@example.test',keys}]} onCreate={()=>window.actions.push('create')} onInspect={()=>window.actions.push('inspect')} renderActions={()=> <><button onClick={()=>window.actions.push('reset')}>重新生成</button><button onClick={()=>window.actions.push('delete')}>删除</button></>}/></PageSearchContext.Provider>}
createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({ stdin: { contents: entry, loader: 'tsx', resolveDir: path.join(repo, 'frontend') }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const report = { synthetic: true, tests: [], shots: [], errors: [], network: [], operationAlignment: [] };
page.on('pageerror', error => report.errors.push(error.message));
await page.route('**/*', route => { report.network.push(route.request().url()); return route.abort(); });
const check = async (name, fn) => {
  try { await fn(); report.tests.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { report.tests.push({ name, passed: false, error: error.message }); console.error('FAIL ' + name + ': ' + error.message); }
};
try {
  await page.setContent(`<style>${themeCss}\n*{box-sizing:border-box}body{margin:0;padding:24px;background:var(--bg-base);color:var(--text-primary);font:14px/1.5 system-ui,sans-serif}button{font:inherit;border:0;cursor:pointer;background:none}h2,p{margin:0}#root{max-width:1600px;margin:auto}${css}</style><div id="root"></div>`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.locator('.mapped-key-state').first().waitFor();
  await check('十种视口/主题同表面无横溢，桌面操作标题与按钮组右缘对齐', async () => {
    for (const width of [390, 768, 1400, 1440, 1920]) for (const dark of [false, true]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
      const values = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        states: [...document.querySelectorAll('.mapped-key-state')].map(node => ({ background: getComputedStyle(node).backgroundColor, pseudo: getComputedStyle(node, '::before').content, markers: node.querySelectorAll('i').length, markerWidth: node.querySelector('i').getBoundingClientRect().width })),
        rows: [...document.querySelectorAll('.mapped-key-row')].map(node => getComputedStyle(node).backgroundColor),
      }));
      assert(values.overflow <= 1, width + ' overflow: ' + values.overflow);
      for (const state of values.states) {
        assert.equal(state.background, 'rgba(0, 0, 0, 0)');
        assert(['none', 'normal'].includes(state.pseudo));
        assert.equal(state.markers, 1); assert.equal(state.markerWidth, 4);
      }
      assert(values.rows.every(color => color === 'rgba(0, 0, 0, 0)'));
      if (width >= 1400) {
        const alignment = await page.locator('.mapped-key-table').evaluate(table => {
          const rows = [...table.children];
          const range = document.createRange();
          range.selectNodeContents(rows[0].lastElementChild);
          const headerTextRight = range.getBoundingClientRect().right;
          return {
            cells: rows.slice(1).flatMap(row => [...row.children].map((cell, i) => Math.abs(cell.getBoundingClientRect().left - rows[0].children[i].getBoundingClientRect().left))),
            operations: rows.slice(1).map(row => {
              const buttons = row.querySelectorAll('.mapped-key-row-actions button');
              const buttonRight = buttons[buttons.length - 1].getBoundingClientRect().right;
              return { headerTextRight, buttonRight, delta: Math.abs(headerTextRight - buttonRight) };
            }),
          };
        });
        assert(alignment.cells.every(delta => delta <= 1), JSON.stringify(alignment.cells));
        report.operationAlignment.push({ width, theme: dark ? 'dark' : 'light', rows: alignment.operations });
      }
      const shot = `keys-${dark ? 'dark' : 'light'}-${width}.png`;
      await page.screenshot({ path: path.join(out, shot), animations: 'disabled' }); report.shots.push(shot);
    }
    assert(report.operationAlignment.every(scene => scene.rows.every(row => row.delta <= 1)), '操作表头文字与末按钮右边缘未对齐：' + JSON.stringify(report.operationAlignment));
  });
  await check('创建、详情、重置、删除与折叠入口保留，搜索仍生效', async () => {
    await page.getByRole('button', { name: '创建密钥', exact: true }).click();
    await page.getByRole('button', { name: '查看凭据', exact: true }).first().click();
    await page.getByRole('button', { name: '重新生成', exact: true }).first().click();
    await page.getByRole('button', { name: '删除', exact: true }).first().click();
    assert.deepEqual(await page.evaluate(() => window.actions), ['create', 'inspect', 'reset', 'delete']);
    await page.locator('.mapped-key-group-title').click(); assert.equal(await page.locator('.mapped-key-state').count(), 0);
    await page.locator('.mapped-key-group-title').click(); assert.equal(await page.locator('.mapped-key-state').count(), 3);
    await page.evaluate(() => window.search('应用凭据 2'));
    await page.waitForFunction(() => document.querySelectorAll('.mapped-key-state').length === 1);
    assert.match(await page.locator('.mapped-key-identity').innerText(), /应用凭据 2/);
  });
  assert.deepEqual(report.errors, []); assert.deepEqual(report.network, []);
} finally {
  await browser.close(); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(out); if (report.tests.some(test => !test.passed) || report.errors.length) process.exitCode = 1;
}
