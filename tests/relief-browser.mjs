import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
const url=process.env.GROUNDTRACK_URL||'http://127.0.0.1:5195';
const page04=`${url}/study-04.html`;
const server=process.env.GROUNDTRACK_URL?null:spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5195','--strictPort'],{stdio:'pipe'});
let logs='';server?.stdout.on('data',d=>logs+=d);server?.stderr.on('data',d=>logs+=d);
let browser;
mkdirSync('test-results',{recursive:true});mkdirSync('docs/screenshots',{recursive:true});
try{
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,logs);
  browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:1100},deviceScaleFactor:1});
  const failures=[];page.on('pageerror',e=>failures.push(e.message));page.on('response',r=>{if(r.status()>=400)failures.push(`${r.status()} ${r.url()}`);});
  await page.goto(page04);await page.waitForFunction(()=>window.groundtrackRelief?.ready);
  assert.equal(await page.locator('#relief-time').textContent(),'08:24');
  assert.deepEqual(await page.evaluate(()=>groundtrackRelief.main.last.hours.map(h=>h.value)),['8','9']);
  let combinations=0;
  for(const body of ['moon','sun','iss'])for(const clock24 of [false,true])for(const material of ['shore','clay','jade'])for(const mixing of [false,true]){
    const r=await page.evaluate(({body,material,mixing,clock24})=>{
      const g=groundtrackRelief;Object.assign(g.state,{body,material,mixing,clock24,epoch:g.demos[body]});g.render();
      const data=g.main.ctx.getImageData(0,0,200,228).data;let invalid=0;
      for(let i=0;i<data.length;i+=4)if(data[i]%85||data[i+1]%85||data[i+2]%85||data[i+3]!==255)invalid++;
      const collisions=g.main.hours.map(h=>g.main.camera.track.filter(p=>p.x>h.box.x-1&&p.x<h.box.x+h.box.w+1&&p.y>h.box.y-1&&p.y<h.box.y+h.box.h+1).length);
      return {invalid,last:g.main.last,collisions,unmapped:g.main.ground.filter(p=>!p).length};
    },{body,material,mixing,clock24});
    assert.equal(r.invalid,0);assert.equal(r.unmapped,0);assert.ok(r.last.colors>4&&r.last.colors<=64);
    assert.equal(r.last.hours.length,2,`${body} ${clock24}: two monuments`);
    assert.ok(r.last.hours.every(h=>h.box.x>=2&&h.box.x+h.box.w<=198&&h.box.y>=2&&h.box.y+h.box.h<=226),JSON.stringify(r.last.hours));
    assert.ok(r.collisions.every(n=>n===0),`${body}: a route must not go through a monument ${r.collisions}`);
    assert.ok(r.last.current.x>=4&&r.last.current.x<=195&&r.last.current.y>=4&&r.last.current.y<=223);
    if(body==='iss')assert.ok(r.last.cuts>0,'Archived ISS cuts stay explicit');
    combinations++;
  }
  console.log(`${combinations} relief render combinations passed.`);
  await page.reload();await page.waitForFunction(()=>window.groundtrackRelief?.ready);
  const before=await page.evaluate(()=>({...groundtrackRelief.main.stats}));
  await page.locator('#relief-minute').fill('41');await page.locator('#relief-minute').dispatchEvent('input');
  const after=await page.evaluate(()=>({...groundtrackRelief.main.stats}));assert.equal(after.geometryBuilds,before.geometryBuilds);assert.equal(after.typeBuilds,before.typeBuilds);assert.ok(after.lightingBuilds>before.lightingBuilds);
  await page.locator('[data-material="clay"]').click();const themed=await page.evaluate(()=>({...groundtrackRelief.main.stats}));assert.equal(themed.lightingBuilds,after.lightingBuilds);assert.equal(themed.geometryBuilds,after.geometryBuilds);
  const pixels=await page.locator('#relief-watch').evaluate(c=>c.toDataURL());await page.locator('#relief-mixing').uncheck();assert.notEqual(await page.locator('#relief-watch').evaluate(c=>c.toDataURL()),pixels);await page.locator('#relief-mixing').check();assert.equal(await page.locator('#relief-watch').evaluate(c=>c.toDataURL()),pixels);
  const idle=await page.evaluate(()=>({...groundtrackRelief.main.stats}));await page.waitForTimeout(1100);assert.deepEqual(await page.evaluate(()=>groundtrackRelief.main.stats),idle);
  await page.locator('.art-options summary').click();await page.locator('#relief-zone').selectOption('Asia/Kolkata');await page.locator('#relief-reset').click();assert.equal(await page.locator('#relief-time').textContent(),'17:54');assert.equal(await page.locator('#relief-minute').inputValue(),'54');
  await page.locator('#relief-zone').selectOption('America/New_York');
  const proofs=[];
  for(const observation of ['coast','dusk','night']){
    await page.locator('#relief-observation').selectOption(observation);
    for(const material of ['shore','clay','jade']){
      await page.locator(`[data-material="${material}"]`).click();
      const png=await page.locator('#relief-watch').evaluate(c=>c.toDataURL());writeFileSync(`docs/screenshots/study-04-${observation}-${material}.png`,Buffer.from(png.split(',')[1],'base64'));proofs.push({name:`${observation} / ${material}`,png});
    }
  }
  for(const body of ['sun','iss']){await page.locator(`[data-body="${body}"]`).click();assert.equal(await page.locator('#relief-observation').isDisabled(),true);await page.locator('[data-material="shore"]').click();const png=await page.locator('#relief-watch').evaluate(c=>c.toDataURL());writeFileSync(`docs/screenshots/study-04-${body}.png`,Buffer.from(png.split(',')[1],'base64'));}
  console.log('Color controls, clock zones, material proofs and zero idle redraws passed. Checking all 24 hours…');
  const daily=await page.evaluate(()=>{
    const g=groundtrackRelief,out=[];Object.assign(g.state,{body:'moon',timeZone:'UTC',clock24:true});
    for(let hour=0;hour<24;hour++){
      g.state.epoch=Date.parse('2026-09-15T00:24Z')+hour*3600000;g.render();
      const positions=[];for(let m=0;m<60;m++){const p=g.main.current({...g.state,epoch:g.state.start+m*60000});positions.push([p.x,p.y]);}
      out.push({hour,figures:g.main.last.hours.map(h=>h.value),boxes:g.main.last.hours.map(h=>h.box),positions});
    }return out;
  });
  for(const d of daily){assert.deepEqual(d.figures,[String(d.hour),String((d.hour+1)%24)]);for(const p of d.positions)assert.ok(p[0]>=3&&p[0]<=197&&p[1]>=3&&p[1]<=225,JSON.stringify({hour:d.hour,p}));for(const box of d.boxes)assert.ok(box.x>=1&&box.x+box.w<=199&&box.y>=1&&box.y+box.h<=227,JSON.stringify({hour:d.hour,box}));}
  const sheet=await page.evaluate(async proofs=>{
    const cv=document.createElement('canvas');cv.width=696;cv.height=810;const ctx=cv.getContext('2d');ctx.fillStyle='#ede9df';ctx.fillRect(0,0,696,810);ctx.imageSmoothingEnabled=false;
    for(let i=0;i<proofs.length;i++){const p=proofs[i],img=new Image();img.src=p.png;await img.decode();const x=24+i%3*224,y=32+Math.floor(i/3)*260;ctx.drawImage(img,x,y);ctx.fillStyle='#283f39';ctx.font='11px monospace';ctx.fillText(p.name.toUpperCase(),x,y-12);}return cv.toDataURL();
  },proofs);writeFileSync('docs/screenshots/study-04-contact-sheet.png',Buffer.from(sheet.split(',')[1],'base64'));
  await page.reload();await page.waitForFunction(()=>window.groundtrackRelief?.ready);await page.screenshot({path:'docs/screenshots/study-04-workshop.png',fullPage:true});
  for(const width of [320,390]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`test-results/relief-mobile-${width}.png`,fullPage:true});}
  assert.deepEqual(failures,[]);console.log('24 hour numerals, every minute position, native pixels, stable dithering and mobile layouts passed.');
}finally{await browser?.close();server?.kill();}
