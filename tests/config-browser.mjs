// The native app's settings page, as the phone opens it: shows the current
// settings, returns the new ones, and the phone then sends them to the watch.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';

const dir=mkdtempSync(join(tmpdir(),'groundtrack-config-'));
let browser;
try{
  const out=join(dir,'index.js');
  execFileSync(process.execPath,['tools/build-pkjs.mjs',out],{stdio:'pipe'});
  const now=Date.parse('2026-09-27T13:24:00Z'),zone='UTC';
  const stored={plate:'crt',flag:'1',timeZone:zone},listeners={},messages=[];let opened=null;
  const context=vm.createContext({
    console:{log:()=>{}},setTimeout,
    // The phone's coarse fix, which it passes to the page.
    navigator:{geolocation:{getCurrentPosition:ok=>setTimeout(()=>ok({coords:{latitude:48.85661,longitude:2.35222}}),5)}},
    localStorage:{getItem:k=>k in stored?stored[k]:null,setItem:(k,v)=>{stored[k]=String(v);}},
    Pebble:{addEventListener:(n,f)=>{listeners[n]=f;},openURL:u=>{opened=u;},sendAppMessage:(m,ok)=>{messages.push(m);setTimeout(ok,0);}}
  });
  vm.runInContext(`Date.now=()=>${now};`,context);
  vm.runInContext(readFileSync(out,'utf8').replace(/\n/g,'\n\t'),context);

  listeners.showConfiguration({});
  for(let i=0;i<100&&!opened;i++)await new Promise(r=>setTimeout(r,20));
  assert.ok(opened?.startsWith('data:text/html;charset=utf-8,'),'the phone opens the page as a data URL');
  const html=decodeURIComponent(opened.slice('data:text/html;charset=utf-8,'.length));

  browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:320,height:640},timezoneId:zone});
  const errors=[],closes=[];
  page.on('pageerror',e=>errors.push(e.message));
  // Leaving for pebblejs://close#... is how the page answers; the browser
  // has no handler for the scheme, so catch the navigation it asks for.
  const cdp=await page.context().newCDPSession(page);await cdp.send('Page.enable');
  cdp.on('Page.frameRequestedNavigation',e=>closes.push(e.url));
  await page.setContent(html);

  // The current settings, the eleven plates and the zone's preset home.
  assert.equal(await page.locator('input[name=plate]').count(),11);
  assert.equal(await page.locator('input[name=plate]:checked').getAttribute('value'),'crt');
  assert.equal(await page.locator('input[name=body]:checked').getAttribute('value'),'sun');
  // Enroute's: the Sun, the Moon, GPS and QZSS (Plotboard has the fast satellites).
  assert.deepEqual(await page.locator('input[name=body]').evaluateAll(e=>e.map(x=>x.value)),['sun','moon','sat:36585','sat:42738']);
  assert.equal(await page.locator('input[name=readout]:checked').getAttribute('value'),'flag');
  assert.equal(await page.locator('input[name=numerals]:checked').getAttribute('value'),'even');
  assert.ok(await page.locator('input[name=clock24]').isChecked());
  // Enroute's options only: no time scale for the world band, nor how its
  // minutes fall on the route.
  assert.equal(await page.locator('input[name=tape]').count(),0);
  assert.equal(await page.locator('input[name=transfer]').count(),0);
  assert.equal(await page.locator('#title').textContent(),'Groundtrack Enroute');
  assert.match(await page.locator('#preset-note').textContent(),/Greenwich/);
  assert.ok(await page.locator('#coords').isHidden());
  // Nothing wider than a small phone.
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'the page scrolls sideways at 320 px');
  mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/native-settings.png',fullPage:true});

  // Choose the Moon on the Sectional, no flag, and a home of one's own.
  await page.check('input[name=body][value=moon]');
  await page.check('input[name=plate][value=sectional]');
  await page.check('input[name=readout][value=callout]');await page.check('input[name=numerals][value=accent]');
  await page.check('input[name=margin][value=body]');await page.uncheck('input[name=clock24]');
  // An event, named by the phone.
  await page.fill('input[name=date]','2026-09-27');await page.fill('input[name=time]','14:30');await page.fill('input[name=title]','Dinner with Sam');await page.click('#add');
  assert.match(await page.locator('#events').textContent(),/Dinner with Sam/);
  await page.getByText('A place of my own').click();
  assert.ok(await page.locator('#coords').isVisible());
  // An impossible latitude is refused.
  await page.fill('input[name=lat]','91');await page.fill('input[name=lon]','2.35');
  await page.click('#save');await page.waitForTimeout(200);
  assert.equal(closes.length,0,'an impossible latitude closed the page');
  // The phone's own fix, rounded to 0.01°.
  await page.click('#locate');
  assert.deepEqual([await page.inputValue('input[name=lat]'),await page.inputValue('input[name=lon]')],['48.86','2.35']);
  await page.click('#save');
  for(let i=0;i<50&&!closes.length;i++)await page.waitForTimeout(50);
  assert.equal(errors.length,0,errors.join('\n'));
  assert.ok(closes[0]?.startsWith('pebblejs://close#'),`the page closed with ${closes[0]}`);
  const response=closes[0].slice('pebblejs://close#'.length);

  // The phone keeps the settings and sends them to the watch, which draws
  // again in them, with home's rise and set for the new home.
  listeners.webviewclosed({response});
  for(let i=0;i<200&&!messages.some(m=>m.RiseSets);i++)await new Promise(r=>setTimeout(r,20));
  assert.deepEqual({body:stored.body,plate:stored.plate,readout:stored.readout,numerals:stored.numerals,margin:stored.margin,clock24:stored.clock24,home:JSON.parse(stored.home)},
    {body:'moon',plate:'sectional',readout:'callout',numerals:'accent',margin:'body',clock24:'0',home:{lat:48.86,lon:2.35}});
  const i32=v=>[v&255,(v>>8)&255,(v>>16)&255,(v>>>24)&255];
  assert.equal(JSON.stringify(messages.find(m=>m.Settings).Settings),JSON.stringify([1,1,2,0,1,...i32(4886),...i32(235),...i32(0),0,0,0,0,4,1,0,0]));
  assert.equal(messages.find(m=>m.RiseSets).RiseSets.length,45*12);
  const saved=JSON.parse(stored.events);
  assert.deepEqual(saved.map(e=>[e.title,e.label]),[['Dinner with Sam','DINNR']]);
  assert.equal(new Date(saved[0].epoch).toISOString(),'2026-09-27T14:30:00.000Z');
  assert.equal(messages.find(m=>m.Events).Events.length,9);

  // Cancel changes nothing.
  const before=JSON.stringify(stored);listeners.webviewclosed({response:'CANCELLED'});
  assert.equal(JSON.stringify(stored),before);
  console.log('settings page: ok');
}finally{
  await browser?.close();
  rmSync(dir,{recursive:true,force:true});
}
