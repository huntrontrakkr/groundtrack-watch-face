import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fixtureTLE} from './tle-fixture.mjs';
const url=process.env.GROUNDTRACK_URL||'http://127.0.0.1:5197';
const server=process.env.GROUNDTRACK_URL?null:spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5197','--strictPort'],{stdio:'pipe'});
let logs='';server?.stdout.on('data',d=>logs+=d);server?.stderr.on('data',d=>logs+=d);
let browser;
mkdirSync('test-results',{recursive:true});mkdirSync('docs/screenshots',{recursive:true});
try{
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,logs);
  browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:1100},deviceScaleFactor:1});
  const failures=[];page.on('pageerror',e=>failures.push(e.message));page.on('response',r=>{if(r.status()>=400&&!r.url().startsWith('https://celestrak.org/'))failures.push(`${r.status()} ${r.url()}`);});
  await page.goto(url);await page.waitForFunction(()=>window.groundtrackEnroute?.ready);
  assert.equal(await page.locator('#enroute-time').textContent(),'04:24');
  assert.deepEqual(await page.evaluate(()=>{const f=groundtrackEnroute.main.last.figure;return [f.hour,f.minute,f.next];}),['4','24','5']);
  // The canvas and the three proofs show exactly the renderer's native pixels.
  let combinations=0;
  for(const body of ['sun','moon','iss'])for(const plate of ['enroute','sectional','plotboard','hypsometric','red','crt','sunlight'])for(const clock24 of [false,true]){
    const r=await page.evaluate(({body,plate,clock24})=>{
      const g=groundtrackEnroute;Object.assign(g.state,{body,plate,clock24,epoch:g.demos[body]});g.render();
      const shown=document.getElementById('enroute-watch').getContext('2d').getImageData(0,0,200,228).data,own=g.main.last.rgba;let differ=0,invalid=0;
      for(let i=0;i<shown.length;i++){if(shown[i]!==own[i])differ++;if(i%4<3&&shown[i]%85)invalid++;}
      const proof=document.querySelector(`#enroute-proofs [data-plate="${plate}"] canvas`).getContext('2d').getImageData(0,0,200,228).data;let proofDiffer=0;
      for(let i=0;i<proof.length;i++)if(proof[i]!==own[i])proofDiffer++;
      return {differ,invalid,proofDiffer};
    },{body,plate,clock24});
    assert.equal(r.differ,0);assert.equal(r.invalid,0);assert.equal(r.proofDiffer,0);combinations++;
  }
  console.log(`${combinations} enroute combinations match the renderer's native pixels.`);
  await page.reload();await page.waitForFunction(()=>window.groundtrackEnroute?.ready);
  const before=await page.evaluate(()=>({...groundtrackEnroute.main.stats}));
  await page.locator('#enroute-minute').fill('41');await page.locator('#enroute-minute').dispatchEvent('input');
  assert.equal(await page.locator('#enroute-time').textContent(),'04:41');
  const after=await page.evaluate(()=>({...groundtrackEnroute.main.stats}));assert.equal(after.geometryBuilds,before.geometryBuilds);assert.ok(after.lightBuilds>before.lightBuilds);
  await page.locator('#enroute-plates [data-plate="plotboard"]').click();
  const plated=await page.evaluate(()=>({...groundtrackEnroute.main.stats}));assert.equal(plated.lightBuilds,after.lightBuilds);assert.equal(await page.locator('#enroute-proofs [data-plate="plotboard"]').getAttribute('aria-pressed'),'true');
  await page.locator('#enroute-proofs [data-plate="sectional"]').click();assert.equal(await page.locator('#enroute-plates [data-plate="sectional"]').getAttribute('aria-pressed'),'true');
  const idle=await page.evaluate(()=>({...groundtrackEnroute.main.stats}));await page.waitForTimeout(1100);assert.deepEqual(await page.evaluate(()=>groundtrackEnroute.main.stats),idle);
  // Moonlight applies to the Moon only: three evenings, three kinds of light.
  assert.equal(await page.locator('[data-observation="dusk"]').isDisabled(),true);
  await page.locator('[data-body="moon"]').click();assert.equal(await page.locator('[data-observation="dusk"]').isDisabled(),false);
  assert.match(await page.locator('#enroute-caption').textContent(),/TAN/);
  const zones={};
  for(const observation of ['day','dusk','night']){await page.locator(`[data-observation="${observation}"]`).click();zones[observation]=await page.evaluate(()=>groundtrackEnroute.main.last.zones);}
  assert.equal(zones.day[1]+zones.day[2],0);assert.ok(zones.dusk.every(z=>z>0));assert.ok(zones.night[2]>zones.night[0]);
  await page.locator('#enroute-minute').fill('3');await page.locator('#enroute-minute').dispatchEvent('input');await page.locator('#enroute-reset').click();assert.equal(await page.locator('#enroute-minute').inputValue(),'24');
  await page.locator('[data-body="sun"]').click();await page.locator('.art-options summary').click();await page.locator('#enroute-zone').selectOption('Asia/Kolkata');
  assert.equal(await page.locator('#enroute-time').textContent(),'13:54');
  assert.deepEqual(await page.evaluate(()=>{const f=groundtrackEnroute.main.last.figure;return [f.hour,f.minute,f.next];}),['1','54','2']);
  assert.equal(await page.evaluate(()=>groundtrackEnroute.main.last.figure.readout),null);
  await page.locator('#enroute-readout').check();assert.ok(await page.evaluate(()=>groundtrackEnroute.main.last.figure.readout));
  await page.locator('#enroute-readout').uncheck();assert.equal(await page.evaluate(()=>groundtrackEnroute.main.last.figure.readout),null);
  await page.locator('#enroute-24').check();assert.deepEqual(await page.evaluate(()=>{const f=groundtrackEnroute.main.last.figure;return [f.hour,f.next];}),['13','14']);
  // Live satellites: CelesTrak is intercepted, so no network is used. One
  // satellite answers with fresh elements, another with an error.
  const requests=[];
  await page.route('https://celestrak.org/**',route=>{
    const norad=Number(new URL(route.request().url()).searchParams.get('CATNR'));requests.push(norad);
    if(norad===49260)return route.fulfill({status:403,body:'Forbidden',headers:{'access-control-allow-origin':'*'}});
    return route.fulfill({status:200,body:fixtureTLE(Date.now()-3600000,norad,'TEST'),headers:{'content-type':'text/plain','access-control-allow-origin':'*'}});
  });
  await page.locator('#sat-select').selectOption('20580');await page.locator('#sat-track').click();
  await page.waitForFunction(()=>groundtrackEnroute.state.body==='sat:20580');
  assert.match(await page.locator('#enroute-caption').textContent(),/Hubble/);assert.ok(await page.evaluate(()=>groundtrackEnroute.main.last.world));
  assert.match(await page.locator('#sat-status').textContent(),/CelesTrak/);
  await page.locator('#sat-track').click();await page.waitForFunction(()=>/cache/.test(document.getElementById('sat-status').textContent));
  assert.deepEqual(requests,[20580],'a second request within two hours is served from cache');
  await page.locator('#sat-select').selectOption('49260');await page.locator('#sat-track').click();
  await page.waitForFunction(()=>/Could not track/.test(document.getElementById('sat-status').textContent));
  assert.equal(await page.evaluate(()=>groundtrackEnroute.state.body),'sat:20580');
  await page.locator('[data-body="sun"]').click();await page.locator('#enroute-now').click();
  assert.ok(await page.evaluate(()=>Math.abs(groundtrackEnroute.state.epoch-Date.now())<120000));
  // The rolling Fuller spike: same controls, the icosahedron rolled along the route.
  await page.locator('[data-projection="fuller"]').click();assert.ok(await page.evaluate(()=>groundtrackEnroute.main.camera.fuller));
  assert.equal(await page.evaluate(()=>{const d=document.getElementById('enroute-watch').getContext('2d').getImageData(0,0,200,228).data,o=groundtrackEnroute.main.last.rgba;let n=0;for(let i=0;i<d.length;i++)if(d[i]!==o[i])n++;return n;}),0);
  await page.locator('[data-projection="chart"]').click();assert.equal(await page.evaluate(()=>groundtrackEnroute.main.camera.fuller),undefined);
  await page.locator('[data-body="iss"]').click();assert.ok(await page.evaluate(()=>groundtrackEnroute.main.last.world));assert.match(await page.locator('#enroute-caption').textContent(),/ISS/);
  await page.reload();await page.waitForFunction(()=>window.groundtrackEnroute?.ready);await page.screenshot({path:'docs/screenshots/study-06-workshop.png',fullPage:true});
  for(const width of [320,390]){await page.setViewportSize({width,height:844});const scroll=await page.evaluate(()=>[document.documentElement.scrollWidth,innerWidth,[...document.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>innerWidth+.5).slice(0,4).map(e=>e.tagName+'#'+e.id+'.'+e.className)]);assert.ok(scroll[0]<=scroll[1],JSON.stringify(scroll));await page.screenshot({path:`test-results/enroute-mobile-${width}.png`,fullPage:true});}
  assert.deepEqual(failures,[]);console.log('Controls, plates, moonlight, stations, clock zones, zero idle redraws and mobile layouts passed.');
}finally{await browser?.close();server?.kill();}
