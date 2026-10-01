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
  for(const body of ['sun','moon','iss'])for(const plate of ['enroute','sectional','console','hypsometric','red','crt','sunlight','blueprint','amber','airbrush','dotmatrix','odyssey'])for(const clock24 of [false,true]){
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
  const after=await page.evaluate(()=>({...groundtrackEnroute.main.stats}));assert.equal(after.geometryBuilds,before.geometryBuilds);assert.ok(after.renders>before.renders);
  await page.locator('#enroute-plates [data-plate="console"]').click();
  const plated=await page.evaluate(()=>({...groundtrackEnroute.main.stats}));assert.ok(plated.renders>after.renders);assert.equal(await page.locator('#enroute-proofs [data-plate="console"]').getAttribute('aria-pressed'),'true');
  await page.locator('#enroute-proofs [data-plate="sectional"]').click();assert.equal(await page.locator('#enroute-plates [data-plate="sectional"]').getAttribute('aria-pressed'),'true');
  const idle=await page.evaluate(()=>({...groundtrackEnroute.main.stats}));await page.waitForTimeout(1100);assert.deepEqual(await page.evaluate(()=>groundtrackEnroute.main.stats),idle);
  // Moonlight applies to the Moon only: three evenings, three kinds of light.
  assert.equal(await page.locator('[data-observation="dusk"]').isDisabled(),true);
  await page.locator('[data-body="moon"]').click();assert.equal(await page.locator('[data-observation="dusk"]').isDisabled(),false);
  assert.match(await page.locator('#enroute-caption').textContent(),/TAN/);
  // The three Moon observations light the same ground differently.
  const frames={};
  for(const observation of ['day','dusk','night']){await page.locator(`[data-observation="${observation}"]`).click();frames[observation]=await page.evaluate(()=>Array.from(groundtrackEnroute.main.last.frame));}
  assert.notDeepEqual(frames.day,frames.dusk);assert.notDeepEqual(frames.dusk,frames.night);
  await page.locator('#enroute-minute').fill('3');await page.locator('#enroute-minute').dispatchEvent('input');await page.locator('#enroute-reset').click();assert.equal(await page.locator('#enroute-minute').inputValue(),'24');
  await page.locator('[data-body="sun"]').click();await page.locator('.art-options summary').click();await page.locator('#enroute-zone').selectOption('Asia/Kolkata');
  assert.equal(await page.locator('#enroute-time').textContent(),'13:54');
  assert.deepEqual(await page.evaluate(()=>{const f=groundtrackEnroute.main.last.figure;return [f.hour,f.minute,f.next];}),['13','54','14']);
  assert.equal(await page.evaluate(()=>groundtrackEnroute.main.last.figure.readout),null);
  await page.locator('#enroute-readout').selectOption('callout');assert.ok(await page.evaluate(()=>groundtrackEnroute.main.last.figure.readout));
  await page.locator('#enroute-readout').selectOption('flag');assert.equal(await page.evaluate(()=>groundtrackEnroute.main.last.figure.readout.kind),'flag');
  await page.locator('#enroute-readout').selectOption('off');assert.equal(await page.evaluate(()=>groundtrackEnroute.main.last.figure.readout),null);
  // 24-hour figures are the default; the callout sets four figures, and the
  // margin can give the nautical zone under the body.
  assert.equal(await page.locator('#enroute-24').isChecked(),true);
  await page.locator('#enroute-readout').selectOption('callout');assert.equal(await page.evaluate(()=>groundtrackEnroute.main.last.figure.time),'1354');
  await page.locator('#enroute-numerals').selectOption('colon');assert.equal(await page.evaluate(()=>groundtrackEnroute.main.last.figure.time),'13:54');
  await page.locator('#enroute-numerals').selectOption('even');await page.locator('#enroute-readout').selectOption('off');
  await page.locator('#enroute-margin-zone').selectOption('body');assert.match(await page.evaluate(()=>groundtrackEnroute.main.last.zulu.text),/^\d{4}[A-IK-Z]$/);
  await page.locator('#enroute-margin-zone').selectOption('utc');assert.match(await page.evaluate(()=>groundtrackEnroute.main.last.zulu.text),/^\d{4}Z$/);
  await page.locator('#enroute-24').check();assert.deepEqual(await page.evaluate(()=>{const f=groundtrackEnroute.main.last.figure;return [f.hour,f.next];}),['13','14']);
  // Home: New York by default; none; or the browser's location, when asked.
  assert.equal(await page.locator('#home-select').inputValue(),'America/New_York');
  await page.locator('#home-select').selectOption('none');assert.equal(await page.evaluate(()=>groundtrackEnroute.state.home),null);
  await page.context().grantPermissions(['geolocation'],{origin:new URL(url).origin});await page.context().setGeolocation({latitude:51.47793,longitude:-0.00148});
  await page.locator('#home-select').selectOption('here');await page.waitForFunction(()=>groundtrackEnroute.state.home?.name==='My location');
  assert.deepEqual(await page.evaluate(()=>{const h=groundtrackEnroute.state.home;return [h.lat,h.lon];}),[51.48,0]);
  assert.equal(await page.locator('#home-select').inputValue(),'here');assert.match(await page.locator('#home-status').textContent(),/51\.48°N/);
  await page.locator('#home-select').selectOption('Europe/London');assert.equal(await page.evaluate(()=>groundtrackEnroute.state.home.name),'London');
  // Events: add one in the displayed hour; it stands on the route, is listed,
  // and can be removed again.
  await page.locator('#event-time').fill('13:40');await page.locator('#event-label').fill('Gate b12');await page.locator('#event-form button').click();
  assert.ok(await page.evaluate(()=>groundtrackEnroute.main.last.events.some(e=>e.label==='GATEE')));
  assert.match(await page.locator('#event-list').textContent(),/13:40 GATEE Gate b12/);
  // A second event of the same name gets its own code.
  await page.locator('#event-time').fill('13:50');await page.locator('#event-label').fill('Gate B12');await page.locator('#event-form button').click();
  assert.equal(await page.evaluate(()=>new Set(groundtrackEnroute.state.events.filter(e=>e.title.toUpperCase()==='GATE B12').map(e=>e.label)).size),2);
  await page.locator('[aria-label="Remove Gate b12"]').click();await page.locator('[aria-label="Remove Gate B12"]').click();
  assert.ok(await page.evaluate(()=>!groundtrackEnroute.main.last.events.some(e=>e.label.startsWith('GATE'))));
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
  // The time scale as a tape, and with the world sliding under it.
  await page.locator('[data-tape="tape"]').click();assert.equal(await page.evaluate(()=>groundtrackEnroute.main.last.figure.index.x),100);
  await page.locator('[data-tape="slide"]').click();assert.ok(await page.evaluate(()=>Math.abs(groundtrackEnroute.main.last.marker.x-100)<=1.5));
  await page.locator('[data-tape="fixed"]').click();
  // Slow orbits on nominal elements: GPS on the hour chart, QZSS's day.
  await page.locator('[data-body="sat:36585"]').click();assert.equal(await page.evaluate(()=>groundtrackEnroute.main.last.world),false);
  assert.match(await page.locator('#enroute-caption').textContent(),/GPS.*nominal orbit/);
  await page.locator('[data-body="sat:42738"]').click();assert.ok(await page.evaluate(()=>groundtrackEnroute.main.camera.day.hours.length===25));
  assert.match(await page.locator('#body-note').textContent(),/figure-8/);
  await page.locator('[data-span="hour"]').click();assert.equal(await page.evaluate(()=>groundtrackEnroute.main.camera.day),null);
  await page.locator('[data-span="day"]').click();assert.ok(await page.evaluate(()=>groundtrackEnroute.main.camera.day.hours.length===25));
  await page.reload();await page.waitForFunction(()=>window.groundtrackEnroute?.ready);await page.screenshot({path:'docs/screenshots/study-06-workshop.png',fullPage:true});
  for(const width of [320,390]){await page.setViewportSize({width,height:844});const scroll=await page.evaluate(()=>[document.documentElement.scrollWidth,innerWidth,[...document.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>innerWidth+.5).slice(0,4).map(e=>e.tagName+'#'+e.id+'.'+e.className)]);assert.ok(scroll[0]<=scroll[1],JSON.stringify(scroll));await page.screenshot({path:`test-results/enroute-mobile-${width}.png`,fullPage:true});}
  assert.deepEqual(failures,[]);console.log('Controls, plates, moonlight, stations, clock zones, zero idle redraws and mobile layouts passed.');
}finally{await browser?.close();server?.kill();}
