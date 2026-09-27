import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
const url=process.env.GROUNDTRACK_URL||'http://127.0.0.1:5192';
const server=process.env.GROUNDTRACK_URL?null:spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5192','--strictPort'],{stdio:'pipe'});
let logs='';server?.stderr.on('data',d=>logs+=d);server?.stdout.on('data',d=>logs+=d);
let browser;
mkdirSync('test-results',{recursive:true});mkdirSync('docs/screenshots',{recursive:true});
try{
  let ready=false;
  for(let i=0;i<60;i++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready,`Preview server did not start: ${logs}`);
  browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:1280,height:1100},deviceScaleFactor:1});
  const failures=[];page.on('pageerror',e=>failures.push(e.message));page.on('response',r=>{if(r.status()>=400)failures.push(`${r.status()} ${r.url()}`);});
  await page.goto(url);await page.waitForFunction(()=>window.groundtrack?.ready);
  assert.equal(await page.locator('vite-error-overlay').count(),0);
  assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(242, 241, 233)');
  await page.screenshot({path:'test-results/desktop.png',fullPage:true});
  const images=[];
  let configurations=0;
  for(const body of ['sun','moon','iss']){
    await page.locator(`[data-body="${body}"]`).click();
    for(const view of ['landscape','oblique','globe']){
      await page.locator(`[data-view="${view}"]`).click();
      await page.locator('[data-theme="survey"]').click();
      await page.selectOption('#dither','stipple');
      const image=await page.locator('#watch').evaluate(c=>c.toDataURL());
      images.push({body,view,image});
      await page.locator('#watch').screenshot({path:`docs/screenshots/${body}-${view}.png`});
      for(const theme of ['survey','paper','ink'])for(const shading of ['none','ordered','stipple']){
        await page.locator(`[data-theme="${theme}"]`).click();await page.selectOption('#dither',shading);
        const pixels=await page.locator('#watch').evaluate(c=>{
          const bytes=c.getContext('2d').getImageData(0,0,200,228).data;
          let invalid=0,translucent=0;const colors=new Set();
          for(let i=0;i<bytes.length;i+=4){if(bytes[i]%85||bytes[i+1]%85||bytes[i+2]%85)invalid++;if(bytes[i+3]!==255)translucent++;colors.add(`${bytes[i]},${bytes[i+1]},${bytes[i+2]}`);}
          return {invalid,translucent,colors:[...colors]};
        });
        assert.equal(pixels.invalid,0,`${body}/${view}/${theme}/${shading}: colors outside RGB222`);
        assert.equal(pixels.translucent,0);
        if(theme==='ink')assert.deepEqual(pixels.colors.sort(),['0,0,0','255,255,255']);
        configurations++;
      }
    }
  }
  // Exercise real user controls, not just a render function.
  await page.locator('[data-body="sun"]').click();await page.locator('[data-theme="survey"]').click();await page.selectOption('#dither','stipple');
  await page.selectOption('#zone','Asia/Kolkata');assert.match(await page.locator('#time-output').textContent(),/14:54/);
  await page.selectOption('#zone','UTC');
  await page.locator('#cities').check();await page.locator('#secondary').check();await page.locator('#night').uncheck();
  await page.locator('#minute').fill('59');await page.locator('#minute').dispatchEvent('input');assert.match(await page.locator('#time-output').textContent(),/10:23/);
  await page.locator('#reset-time').click();assert.match(await page.locator('#time-output').textContent(),/09:24/);
  await page.locator('#cities').uncheck();await page.locator('#secondary').uncheck();await page.locator('#night').check();
  const cache=await page.evaluate(()=>{
    const g=window.groundtrack;
    g.state.epoch+=60000;g.render(); // 09:25, inside a new 5-minute shade bucket.
    const before={...g.main.stats};g.state.epoch+=60000;g.render();
    const after={...g.main.stats};
    const first=g.main.canvas.toDataURL();g.render();const second=g.main.canvas.toDataURL();
    g.state.epoch-=120000;g.render();
    return {before,after,stable:first===second};
  });
  assert.equal(cache.after.mapBuilds,cache.before.mapBuilds);assert.equal(cache.after.trackBuilds,cache.before.trackBuilds);assert.ok(cache.stable);
  // Frozen study should do absolutely no idle rendering.
  const renders=await page.evaluate(()=>groundtrack.main.stats.renders);
  await page.waitForTimeout(1100);assert.equal(await page.evaluate(()=>groundtrack.main.stats.renders),renders);
  await page.screenshot({path:'docs/screenshots/workshop.png',fullPage:true});
  const sheet=await page.evaluate(async images=>{
    const c=document.createElement('canvas');c.width=672;c.height=852;const g=c.getContext('2d');
    g.fillStyle='#e3e8dc';g.fillRect(0,0,c.width,c.height);g.imageSmoothingEnabled=false;
    for(let i=0;i<images.length;i++){
      const item=images[i],img=new Image();img.src=item.image;await img.decode();
      const x=16+(i%3)*224,y=16+Math.floor(i/3)*284;
      g.drawImage(img,x,y,200,228);g.fillStyle='#213a33';g.font='12px monospace';g.fillText(`${item.body.toUpperCase()} / ${item.view.toUpperCase()}`,x,y+251);
    }
    return c.toDataURL();
  },images);
  writeFileSync('docs/screenshots/contact-sheet.png',Buffer.from(sheet.split(',')[1],'base64'));
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    const sizes=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,canvas:document.querySelector('#watch').getBoundingClientRect().toJSON()}));
    assert.ok(sizes.document<=sizes.viewport,`Horizontal overflow at ${width}px`);
    assert.ok(sizes.canvas.x>=0&&sizes.canvas.right<=width,`Clipped canvas at ${width}px`);
    await page.screenshot({path:`test-results/mobile-${width}.png`,fullPage:true});
  }
  assert.deepEqual(failures,[]);
  console.log(`${configurations} rendering combinations passed; monochrome/RGB222, deterministic pixels, cache reuse, controls, and 320/390px layouts checked.`);
}finally{await browser?.close();server?.kill('SIGTERM');}
