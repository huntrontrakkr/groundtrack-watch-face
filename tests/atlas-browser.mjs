import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
const url=process.env.GROUNDTRACK_URL||'http://127.0.0.1:5194';
const server=process.env.GROUNDTRACK_URL?null:spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5194','--strictPort'],{stdio:'pipe'});
let logs='';server?.stdout.on('data',d=>logs+=d);server?.stderr.on('data',d=>logs+=d);
let browser;
mkdirSync('test-results',{recursive:true});mkdirSync('docs/screenshots',{recursive:true});
try{
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,logs);
  browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:1100},deviceScaleFactor:1});
  const failures=[];page.on('pageerror',e=>failures.push(e.message));page.on('response',r=>{if(r.status()>=400)failures.push(`${r.status()} ${r.url()}`);});
  await page.goto(url);await page.waitForFunction(()=>window.groundtrackAtlas?.ready);
  assert.equal(await page.locator('#atlas-time').textContent(),'04:24');
  assert.equal(await page.locator('#atlas-minute').getAttribute('max'),'59');
  assert.equal(await page.locator('[data-zoom]').count(),0,'The wider overview must not return to this study');
  assert.deepEqual(await page.evaluate(()=>groundtrackAtlas.main.last.hours.map(h=>h.value)),['4','5']);
  let combinations=0;
  for(const body of ['moon','iss','sun'])for(const ink of ['chalk','blue','ochre'])for(const edges of [false,true])for(const clock24 of [false,true]){
    const r=await page.evaluate(({body,ink,edges,clock24})=>{
      const g=groundtrackAtlas,d=g.demos[body];Object.assign(g.state,d,{body,ink,edges,clock24,epoch:d.start+24*60000});g.render();
      const data=g.main.ctx.getImageData(0,0,200,228).data,colors=new Set();let invalid=0;
      for(let i=0;i<data.length;i+=4){if(data[i]%85||data[i+1]%85||data[i+2]%85||data[i+3]!==255)invalid++;colors.add(`${data[i]},${data[i+1]},${data[i+2]}`);}
      const {camera,last}=g.main;
      const collisions=g.main.hours.map(h=>camera.track.filter(p=>p.x>h.box.x-3&&p.x<h.box.x+h.box.w+3&&p.y>h.box.y-3&&p.y<h.box.y+h.box.h+3).length);
      return {invalid,colors:colors.size,last,minutes:(camera.end-camera.start)/60000,collisions};
    },{body,ink,edges,clock24});
    assert.equal(r.invalid,0);assert.equal(r.colors,2,'No extra antialiased shades');assert.equal(r.minutes,60);
    assert.equal(r.last.unmappedPixels,0);assert.equal(r.last.hours.length,2,`${body}: exactly two hour monuments`);
    assert.ok(r.last.hours.every(h=>h.w>=15&&h.h>=30),'Hour numerals must have real space');
    assert.ok(r.collisions.every(n=>n===0),`${body}: route overlaps an hour numeral ${r.collisions}`);
    assert.ok(r.last.cities.length<=2);assert.ok(r.last.nightLights<=15);
    if(body==='iss'){assert.ok(r.last.cuts>0);assert.deepEqual(r.last.cutLabels,['A','A']);}
    combinations++;
  }
  await page.reload();await page.waitForFunction(()=>window.groundtrackAtlas?.ready);
  await page.locator('.art-options summary').click();
  for(const zone of ['UTC','Asia/Kolkata','Europe/London','America/New_York']){
    await page.locator('#atlas-zone').selectOption(zone);
    const g=await page.evaluate(()=>({start:groundtrackAtlas.main.camera.start,end:groundtrackAtlas.main.camera.end,epoch:groundtrackAtlas.state.epoch,hours:groundtrackAtlas.main.last.hours,time:groundtrackAtlas.main.last.time}));
    assert.ok(g.epoch>=g.start&&g.epoch<g.end);assert.equal(g.end-g.start,3600000);assert.equal(g.hours.length,2,zone);
    assert.equal(Number(await page.locator('#atlas-minute').inputValue()),Number(g.time.slice(-2)));
  }
  await page.locator('#atlas-zone').selectOption('Asia/Kolkata');
  await page.locator('#atlas-minute').fill('59');await page.locator('#atlas-minute').dispatchEvent('input');
  await page.locator('#atlas-reset').click();assert.equal(await page.locator('#atlas-time').textContent(),'13:54');
  await page.locator('#atlas-zone').selectOption('America/New_York');
  await page.locator('[data-body="iss"]').click();
  const before=await page.evaluate(()=>({...groundtrackAtlas.main.stats}));
  await page.locator('#atlas-minute').fill('40');await page.locator('#atlas-minute').dispatchEvent('input');
  const after=await page.evaluate(()=>({...groundtrackAtlas.main.stats}));
  assert.equal(after.geometryBuilds,before.geometryBuilds);assert.equal(after.typeBuilds,before.typeBuilds);assert.ok(after.lightingBuilds>before.lightingBuilds);
  await page.waitForTimeout(1100);assert.deepEqual(await page.evaluate(()=>groundtrackAtlas.main.stats),after,'No idle rendering');
  await page.locator('#atlas-secondary').selectOption('moon');assert.ok(await page.evaluate(()=>groundtrackAtlas.main.last.secondarySegments>0));
  await page.locator('#atlas-secondary').selectOption('sun');assert.ok(await page.evaluate(()=>groundtrackAtlas.main.last.secondarySegments>0));
  await page.locator('#atlas-cities').uncheck();assert.equal(await page.evaluate(()=>groundtrackAtlas.main.last.nightLights),0);assert.deepEqual(await page.evaluate(()=>groundtrackAtlas.main.last.cities),[]);
  for(const home of ['london','tokyo','sydney','norfolk']){await page.locator('#atlas-home').selectOption(home);assert.ok(await page.evaluate(()=>Number.isFinite(groundtrackAtlas.main.last.locator.home.x)));}
  const daily=await page.evaluate(()=>{
    const g=groundtrackAtlas,results=[];g.state.body='moon';g.state.timeZone='UTC';g.state.clock24=true;
    for(let hour=0;hour<24;hour++){
      g.state.epoch=Date.parse('2026-09-16T00:24Z')+hour*3600000;g.render();
      results.push({hour,figures:g.main.last.hours.map(h=>h.value),unmapped:g.main.last.unmappedPixels});
    }
    return results;
  });
  for(const d of daily){assert.deepEqual(d.figures,[String(d.hour),String((d.hour+1)%24)]);assert.equal(d.unmapped,0);}
  await page.reload();await page.waitForFunction(()=>window.groundtrackAtlas?.ready);
  const proofs=[];
  for(const body of ['moon','iss','sun']){
    await page.locator(`[data-body="${body}"]`).click();
    for(const ink of ['chalk','blue','ochre']){
      await page.locator(`#atlas-inks [data-ink="${ink}"]`).click();
      const png=await page.locator('#atlas-watch').evaluate(c=>c.toDataURL());
      writeFileSync(`docs/screenshots/study-03-${body}-${ink}.png`,Buffer.from(png.split(',')[1],'base64'));proofs.push({body,ink,png});
    }
  }
  const sheet=await page.evaluate(async proofs=>{
    const c=document.createElement('canvas');c.width=696;c.height=810;const ctx=c.getContext('2d');ctx.fillStyle='#f2f1e9';ctx.fillRect(0,0,c.width,c.height);ctx.imageSmoothingEnabled=false;
    for(let i=0;i<proofs.length;i++){const p=proofs[i],img=new Image();img.src=p.png;await img.decode();const x=24+i%3*224,y=32+Math.floor(i/3)*260;ctx.drawImage(img,x,y);ctx.fillStyle='#213a33';ctx.font='11px monospace';ctx.fillText(`${p.body.toUpperCase()} / ${p.ink.toUpperCase()}`,x,y-12);}return c.toDataURL();
  },proofs);
  writeFileSync('docs/screenshots/study-03-contact-sheet.png',Buffer.from(sheet.split(',')[1],'base64'));
  await page.reload();await page.waitForFunction(()=>window.groundtrackAtlas?.ready);await page.screenshot({path:'docs/screenshots/study-03-workshop.png',fullPage:true});
  for(const width of [320,390]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`test-results/atlas-mobile-${width}.png`,fullPage:true});}
  assert.deepEqual(failures,[]);console.log(`${combinations} focused atlas combinations, controls, topology, colors, counters, cache and mobile checks passed.`);
}finally{await browser?.close();server?.kill();}
