import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
const url=process.env.GROUNDTRACK_URL||'http://127.0.0.1:5196';
const server=process.env.GROUNDTRACK_URL?null:spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5196','--strictPort'],{stdio:'pipe'});
let logs='';server?.stdout.on('data',d=>logs+=d);server?.stderr.on('data',d=>logs+=d);
let browser;
mkdirSync('test-results',{recursive:true});mkdirSync('docs/screenshots',{recursive:true});
try{
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,logs);
  browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:1100},deviceScaleFactor:1});
  const failures=[];page.on('pageerror',e=>failures.push(e.message));page.on('response',r=>{if(r.status()>=400)failures.push(`${r.status()} ${r.url()}`);});
  await page.goto(url);await page.waitForFunction(()=>window.groundtrackChart?.ready);
  assert.equal(await page.locator('#chart-time').textContent(),'04:24');
  assert.deepEqual(await page.evaluate(()=>groundtrackChart.main.last.hours.map(h=>h.value)),['4','5']);
  // The canvas shows exactly the renderer's native pixels, in every view.
  let combinations=0;
  for(const body of ['sun','moon','iss'])for(const theme of ['shore','survey','nocturne'])for(const clock24 of [false,true]){
    const r=await page.evaluate(({body,theme,clock24})=>{
      const g=groundtrackChart;Object.assign(g.state,{body,theme,clock24,epoch:g.demos[body]});g.render();
      const shown=document.getElementById('chart-watch').getContext('2d').getImageData(0,0,200,228).data,own=g.main.last.rgba;let differ=0,invalid=0;
      for(let i=0;i<shown.length;i++){if(shown[i]!==own[i])differ++;if(i%4<3&&shown[i]%85)invalid++;}
      return {differ,invalid,hours:g.main.last.hours.length};
    },{body,theme,clock24});
    assert.equal(r.differ,0);assert.equal(r.invalid,0);assert.equal(r.hours,2);combinations++;
  }
  console.log(`${combinations} chart combinations match the renderer's native pixels.`);
  await page.reload();await page.waitForFunction(()=>window.groundtrackChart?.ready);
  const before=await page.evaluate(()=>({...groundtrackChart.main.stats}));
  await page.locator('#chart-minute').fill('41');await page.locator('#chart-minute').dispatchEvent('input');
  assert.equal(await page.locator('#chart-time').textContent(),'04:41');
  const after=await page.evaluate(()=>({...groundtrackChart.main.stats}));assert.equal(after.geometryBuilds,before.geometryBuilds);assert.ok(after.lightBuilds>before.lightBuilds);
  await page.locator('#chart-palettes [data-theme="survey"]').click();
  const themed=await page.evaluate(()=>({...groundtrackChart.main.stats}));assert.equal(themed.lightBuilds,after.lightBuilds);assert.equal(await page.locator('#chart-proofs [data-theme="survey"]').getAttribute('aria-pressed'),'true');
  await page.locator('#chart-proofs [data-theme="nocturne"]').click();assert.equal(await page.locator('#chart-palettes [data-theme="nocturne"]').getAttribute('aria-pressed'),'true');
  const idle=await page.evaluate(()=>({...groundtrackChart.main.stats}));await page.waitForTimeout(1100);assert.deepEqual(await page.evaluate(()=>groundtrackChart.main.stats),idle);
  // Moonlight only applies to the Moon; each evening is a different light.
  assert.equal(await page.locator('[data-observation="dusk"]').isDisabled(),true);
  await page.locator('[data-body="moon"]').click();assert.equal(await page.locator('[data-observation="dusk"]').isDisabled(),false);
  const zones={};
  for(const observation of ['day','dusk','night']){await page.locator(`[data-observation="${observation}"]`).click();zones[observation]=await page.evaluate(()=>groundtrackChart.main.last.zones);}
  assert.equal(zones.day[1]+zones.day[2],0);assert.ok(zones.dusk.every(z=>z>0));assert.ok(zones.night[2]>zones.night[0]);
  await page.locator('#chart-minute').fill('3');await page.locator('#chart-minute').dispatchEvent('input');await page.locator('#chart-reset').click();assert.equal(await page.locator('#chart-minute').inputValue(),'24');
  await page.locator('[data-body="sun"]').click();await page.locator('.art-options summary').click();await page.locator('#chart-zone').selectOption('Asia/Kolkata');
  assert.equal(await page.locator('#chart-time').textContent(),'13:54');assert.deepEqual(await page.evaluate(()=>groundtrackChart.main.last.hours.map(h=>h.value)),['1','2']);
  await page.locator('#chart-24').check();assert.deepEqual(await page.evaluate(()=>groundtrackChart.main.last.hours.map(h=>h.value)),['13','14']);
  await page.locator('[data-body="iss"]').click();assert.ok(await page.evaluate(()=>groundtrackChart.main.last.world));assert.match(await page.locator('#chart-caption').textContent(),/ISS/);
  await page.reload();await page.waitForFunction(()=>window.groundtrackChart?.ready);await page.screenshot({path:'docs/screenshots/study-05-workshop.png',fullPage:true});
  for(const width of [320,390]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`test-results/chart-mobile-${width}.png`,fullPage:true});}
  assert.deepEqual(failures,[]);console.log('Controls, cache reuse, moonlight, clock zones, zero idle redraws and mobile layouts passed.');
}finally{await browser?.close();server?.kill();}
