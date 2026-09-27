import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
const url=process.env.GROUNDTRACK_URL||'http://127.0.0.1:5193';
const server=process.env.GROUNDTRACK_URL?null:spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5193','--strictPort'],{stdio:'pipe'});
let logs='';server?.stdout.on('data',d=>logs+=d);server?.stderr.on('data',d=>logs+=d);
let browser;
mkdirSync('test-results',{recursive:true});mkdirSync('docs/screenshots',{recursive:true});
try{
  let ready=false;
  for(let i=0;i<60;i++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready,`Preview server did not start: ${logs}`);
  browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:1280,height:1100},deviceScaleFactor:1});
  const failures=[];page.on('pageerror',e=>failures.push(e.message));page.on('response',r=>{if(r.status()>=400)failures.push(`${r.status()} ${r.url()}`);});
  await page.goto(url);await page.waitForFunction(()=>window.groundtrackArt?.ready);
  assert.equal(await page.locator('#art-light').count(),0,'There must be no artificial lighting selector');
  assert.equal(await page.locator('#art-time').textContent(),'04:24');
  assert.match(await page.locator('#light-note').textContent(),/above the horizon/);
  const initial=await page.evaluate(()=>groundtrackArt.main.last);
  assert.deepEqual(initial.hours.map(h=>h.value),['4','5']);
  assert.ok(initial.hours.every(h=>h.shadowPixels>0));
  assert.ok(initial.hours[0].y>initial.hours[1].y);
  let combinations=0;
  for(const body of ['moon','sun'])for(const lens of ['above','oblique','low'])for(const material of ['chalk','basalt','copper'])for(const treatment of ['relief','inlay'])for(const texture of [false,true]){
    // Render all material / geometry / texture paths at native resolution.
    const result=await page.evaluate(({body,lens,material,treatment,texture})=>{
      const g=groundtrackArt;
      Object.assign(g.state,{body,lens,material,treatment,texture,epoch:Date.parse(body==='moon'?'2026-09-16T08:24:00Z':'2026-09-27T08:24:00Z')});g.render();
      const d=g.main.ctx.getImageData(0,0,200,228).data;
      let invalid=0,transparent=0;const colors=new Set();
      for(let i=0;i<d.length;i+=4){if(d[i]%85||d[i+1]%85||d[i+2]%85)invalid++;if(d[i+3]!==255)transparent++;colors.add(`${d[i]},${d[i+1]},${d[i+2]}`);}
      return {invalid,transparent,colors:colors.size,last:g.main.last};
    },{body,lens,material,treatment,texture});
    assert.equal(result.invalid,0);assert.equal(result.transparent,0);assert.ok(result.colors>=3);
    assert.equal(result.last.hours.length,2);assert.ok(result.last.hours.every(h=>h.pixels>300));
    assert.ok(result.last.point.visible&&result.last.point.x>0&&result.last.point.x<200);
    if(treatment==='inlay')assert.ok(result.last.hours.every(h=>h.shadowPixels===0));
    combinations++;
  }
  // Use controls for the observation dates, all time-zone interactions, and
  // cache invalidation. Test the meaning of the slider, not just its pixels.
  await page.reload();await page.waitForFunction(()=>window.groundtrackArt?.ready);
  await page.locator('[data-body="moon"]').click();
  await page.locator('[data-lens="oblique"]').click();
  await page.locator('[data-treatment="relief"]').click();
  await page.locator('#art-materials [data-material="chalk"]').click();
  await page.locator('#texture').uncheck();
  const compassOn=await page.locator('#art-watch').evaluate(c=>c.toDataURL());
  await page.locator('#compass').uncheck();
  assert.equal(await page.evaluate(()=>groundtrackArt.state.compass),false);
  assert.notEqual(await page.locator('#art-watch').evaluate(c=>c.toDataURL()),compassOn);
  await page.locator('#compass').check();
  const cache=await page.evaluate(()=>{
    const g=groundtrackArt;
    g.state.epoch+=60000;g.render();const before={...g.main.stats};
    g.state.epoch+=60000;g.render();const after={...g.main.stats};
    const a=g.main.canvas.toDataURL();g.render();const b=g.main.canvas.toDataURL();
    return {before,after,stable:a===b};
  });
  assert.equal(cache.after.geometryBuilds,cache.before.geometryBuilds);
  assert.equal(cache.after.typeBuilds,cache.before.typeBuilds);
  assert.equal(cache.after.sceneBuilds,cache.before.sceneBuilds+1,'Sunlight must use the new minute');
  assert.ok(cache.stable);
  await page.locator('#art-reset').click();
  await page.selectOption('#art-observation','2026-09-18');
  assert.match(await page.locator('#art-date').textContent(),/18/);
  assert.equal(await page.locator('#art-time').textContent(),'04:24');
  await page.selectOption('#art-observation','2026-09-19');
  assert.match(await page.locator('#light-note').textContent(),/below the horizon/);
  assert.equal(await page.evaluate(()=>groundtrackArt.main.last.hours[0].shadowPixels),0);
  await page.locator('#art-minute').fill('59');await page.locator('#art-minute').dispatchEvent('input');
  await page.locator('#art-reset').click();
  assert.equal(await page.locator('#art-observation').inputValue(),'2026-09-19');
  await page.selectOption('#art-observation','2026-09-16');
  await page.locator('.art-options summary').click();
  await page.selectOption('#art-zone','Asia/Kolkata');
  assert.equal(await page.locator('#art-time').textContent(),'13:54');
  assert.equal(await page.locator('#art-minute').inputValue(),'54');
  await page.locator('#clock24').check();
  assert.deepEqual(await page.evaluate(()=>groundtrackArt.main.last.hours.map(h=>h.value)),['13','14']);
  await page.locator('#art-minute').fill('59');await page.locator('#art-minute').dispatchEvent('input');
  assert.equal(await page.locator('#art-time').textContent(),'13:59');
  await page.locator('#art-reset').click();
  assert.equal(await page.locator('#art-minute').inputValue(),'54');
  await page.locator('#fullTime').check();await page.locator('#fullTime').uncheck();
  await page.selectOption('#art-zone','America/New_York');
  await page.locator('#clock24').uncheck();
  await page.locator('.art-options summary').click();
  // Both hour numerals remain present across the entire 24-hour cycle.
  const hours=await page.evaluate(()=>{
    const g=groundtrackArt,epoch=g.state.epoch;
    const result=[];g.state.clock24=true;
    for(let i=0;i<24;i++){
      g.state.epoch=Date.parse('2026-09-16T04:24:00Z')+i*3600000;g.render();
      result.push(g.main.last.hours.map(h=>({value:h.value,pixels:h.pixels})));
    }
    g.state.epoch=epoch;g.state.clock24=false;g.render();return result;
  });
  assert.equal(new Set(hours.flat().map(h=>h.value)).size,24);
  assert.ok(hours.flat().every(h=>h.pixels>100));
  // Six proofs give a direct comparison of relief and inlay at actual pixels.
  const images=[];
  for(const treatment of ['relief','inlay'])for(const material of ['chalk','basalt','copper']){
    await page.locator(`[data-treatment="${treatment}"]`).click();
    await page.locator(`#art-materials [data-material="${material}"]`).click();
    const image=await page.locator('#art-watch').evaluate(c=>c.toDataURL());
    images.push({label:`${material==='copper'?'OCHRE':material.toUpperCase()} / ${treatment.toUpperCase()}`,image});
    writeFileSync(`docs/screenshots/study-02-${material}-${treatment}.png`,Buffer.from(image.split(',')[1],'base64'));
  }
  const sheet=await page.evaluate(async images=>{
    const c=document.createElement('canvas');c.width=672;c.height=568;const g=c.getContext('2d');
    g.fillStyle='#e9e7df';g.fillRect(0,0,c.width,c.height);g.imageSmoothingEnabled=false;
    for(let i=0;i<images.length;i++){
      const img=new Image();img.src=images[i].image;await img.decode();
      const x=16+(i%3)*224,y=16+Math.floor(i/3)*284;
      g.drawImage(img,x,y);g.fillStyle='#213a33';g.font='12px monospace';g.fillText(images[i].label,x,y+251);
    }
    return c.toDataURL();
  },images);
  writeFileSync('docs/screenshots/study-02-contact-sheet.png',Buffer.from(sheet.split(',')[1],'base64'));
  await page.locator('[data-treatment="relief"]').click();await page.locator('#art-materials [data-material="chalk"]').click();
  const renders=await page.evaluate(()=>groundtrackArt.main.stats.renders);
  await page.waitForTimeout(1100);assert.equal(await page.evaluate(()=>groundtrackArt.main.stats.renders),renders);
  await page.screenshot({path:'docs/screenshots/study-02-workshop.png',fullPage:true});
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    const sizes=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,canvas:document.querySelector('#art-watch').getBoundingClientRect().toJSON()}));
    assert.ok(sizes.document<=sizes.viewport,`Horizontal overflow at ${width}px`);
    assert.ok(sizes.canvas.x>=0&&sizes.canvas.right<=width,`Clipped watch at ${width}px`);
    await page.screenshot({path:`test-results/art-mobile-${width}.png`,fullPage:true});
  }
  assert.deepEqual(failures,[]);
  console.log(`${combinations} art combinations passed; actual solar shadows, day/night observations, 24-hour numerals, fractional-zone controls, cache reuse, opaque RGB222, zero idle redraws and mobile layouts checked.`);
}finally{await browser?.close();server?.kill('SIGTERM');}
