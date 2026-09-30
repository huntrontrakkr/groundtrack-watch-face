// The native app's settings page, as the phone opens it: shows the current
// settings, returns the new ones, and the phone then draws this hour again
// in them, byte for byte as the tools do.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {buildScene} from '../tools/export-scene.mjs';
import {civilHour} from '../src/chart-render.js';

const dir=mkdtempSync(join(tmpdir(),'groundtrack-config-'));
let browser;
try{
  const out=join(dir,'index.js');
  execFileSync(process.execPath,['tools/build-pkjs.mjs',out],{stdio:'pipe'});
  const now=Date.parse('2026-09-27T13:24:00Z'),zone='UTC';
  const stored={plate:'crt',flag:'1',timeZone:zone},listeners={},messages=[];let opened=null;
  const context=vm.createContext({
    console:{log:()=>{}},setTimeout,
    localStorage:{getItem:k=>k in stored?stored[k]:null,setItem:(k,v)=>{stored[k]=String(v);}},
    Pebble:{addEventListener:(n,f)=>{listeners[n]=f;},openURL:u=>{opened=u;},sendAppMessage:(m,ok)=>{messages.push(m);setTimeout(ok,0);}}
  });
  vm.runInContext(`Date.now=()=>${now};`,context);
  vm.runInContext(readFileSync(out,'utf8').replace(/\n/g,'\n\t'),context);

  listeners.showConfiguration({});
  assert.ok(opened?.startsWith('data:text/html;charset=utf-8,'),'the phone opens the page as a data URL');
  const html=decodeURIComponent(opened.slice('data:text/html;charset=utf-8,'.length));

  browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:320,height:640}});
  const errors=[],closes=[];
  page.on('pageerror',e=>errors.push(e.message));
  // Leaving for pebblejs://close#... is how the page answers; the browser
  // has no handler for the scheme, so catch the navigation it asks for.
  const cdp=await page.context().newCDPSession(page);await cdp.send('Page.enable');
  cdp.on('Page.frameRequestedNavigation',e=>closes.push(e.url));
  await page.setContent(html);

  // The current settings, the seven plates and the zone's preset home.
  assert.equal(await page.locator('input[name=plate]').count(),7);
  assert.equal(await page.locator('input[name=plate]:checked').getAttribute('value'),'crt');
  assert.equal(await page.locator('input[name=body]:checked').getAttribute('value'),'sun');
  assert.ok(await page.locator('input[name=flag]').isChecked());
  assert.match(await page.locator('#preset-note').textContent(),/Greenwich/);
  assert.ok(await page.locator('#coords').isHidden());
  // Nothing wider than a small phone.
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'the page scrolls sideways at 320 px');
  mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/native-settings.png',fullPage:true});

  // Choose the Moon on the Sectional, no flag, and a home of one's own.
  await page.check('input[name=body][value=moon]');
  await page.check('input[name=plate][value=sectional]');
  await page.uncheck('input[name=flag]');
  await page.getByText('A place of my own').click();
  assert.ok(await page.locator('#coords').isVisible());
  // An impossible latitude is refused.
  await page.fill('input[name=lat]','91');await page.fill('input[name=lon]','2.35');
  await page.click('#save');await page.waitForTimeout(200);
  assert.equal(closes.length,0,'an impossible latitude closed the page');
  await page.fill('input[name=lat]','48.8566');
  await page.click('#save');
  for(let i=0;i<50&&!closes.length;i++)await page.waitForTimeout(50);
  assert.equal(errors.length,0,errors.join('\n'));
  assert.ok(closes[0]?.startsWith('pebblejs://close#'),`the page closed with ${closes[0]}`);
  const response=closes[0].slice('pebblejs://close#'.length);

  // The phone keeps the settings and draws this hour again in them.
  listeners.webviewclosed({response});
  for(let i=0;i<200&&!(messages.length&&messages.slice(1).reduce((n,m)=>n+m.SceneChunk.length,0)===messages[0].SceneTotal);i++)await new Promise(r=>setTimeout(r,20));
  assert.deepEqual({body:stored.body,plate:stored.plate,flag:stored.flag,home:JSON.parse(stored.home)},{body:'moon',plate:'sectional',flag:'0',home:{lat:48.86,lon:2.35}});
  const scene=new Uint8Array(messages[0].SceneTotal);for(const m of messages.slice(1))scene.set(m.SceneChunk,m.SceneOffset);
  const expected=buildScene({body:'moon',start:civilHour(now,zone),plate:'sectional',flag:false,timeZone:zone,home:{code:'HOM',name:'Home',lat:48.86,lon:2.35}}).scene;
  assert.ok(Buffer.from(scene).equals(expected),'the scene after saving differs from the exported one');

  // Cancel changes nothing.
  const before=JSON.stringify(stored);listeners.webviewclosed({response:'CANCELLED'});
  assert.equal(JSON.stringify(stored),before);
  console.log('settings page: ok');
}finally{
  await browser?.close();
  rmSync(dir,{recursive:true,force:true});
}
