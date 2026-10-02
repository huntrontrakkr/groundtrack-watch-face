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
  // (The calendar's link, once the settings hold one, answers with a file.)
  const fetched=[];
  class XMLHttpRequest{open(method,url){this.url=url;}send(){fetched.push(this.url);setTimeout(()=>{this.status=200;
    this.responseText='BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nDTSTART:20260927T143000Z\r\nSUMMARY:Dinner with Sam\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:2\r\nDTSTART;VALUE=DATE:20260928\r\nSUMMARY:Holiday\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';this.onload();},5);}}
  const context=vm.createContext({
    // (The phone's long waits, its calendar's three hours say, must not keep this test alive.)
    console:{log:()=>{}},setTimeout:(f,ms)=>{const t=setTimeout(f,ms);t.unref();return t;},clearTimeout,XMLHttpRequest,
    // The phone's coarse fix, which it passes to the page.
    navigator:{geolocation:{getCurrentPosition:ok=>setTimeout(()=>ok({coords:{latitude:48.85661,longitude:2.35222}}),5)}},
    localStorage:{getItem:k=>k in stored?stored[k]:null,setItem:(k,v)=>{stored[k]=String(v);},removeItem:k=>{delete stored[k];}},
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
  // The place search goes to Open-Meteo's geocoding: answered here.
  const searches=[];
  await page.route('https://geocoding-api.open-meteo.com/**',route=>{searches.push(route.request().url());
    route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({results:[{name:'Norfolk',admin1:'Virginia',country:'United States',latitude:36.84681,longitude:-76.28522},{name:'Norfolk',admin1:'England',country:'United Kingdom',latitude:52.66667,longitude:1}]})});});
  await page.setContent(html);
  // The sections fold: the face, what it follows and its own settings open,
  // each closed one saying what it holds.
  assert.deepEqual(await page.locator('details.card').evaluateAll(e=>e.map(d=>[d.id,d.open])),[['sec-face',true],['sec-follow',true],['sec-chart',true],['sec-time',false],['sec-look',false],['sec-home',false],['sec-events',false]]);
  assert.deepEqual(await page.locator('summary .now').allTextContents(),['Enroute','Sun','A flag','24-hour · Zulu','Green CRT · Michroma','Greenwich','Off']);
  assert.equal(await page.locator('#chart-title').textContent(),'Enroute');
  await page.waitForFunction(()=>window.previewDrawn,null,{timeout:20000});
  mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/native-settings-closed.png',fullPage:true});
  await page.evaluate(()=>document.querySelectorAll('details').forEach(d=>{d.open=true;}));
  // The current settings, the twelve plates and the zone's preset home.
  assert.equal(await page.locator('input[name=plate]').count(),12);
  // The preview: the face sketched in the settings, and as the watch's
  // reflective screen shows its colours; it follows the settings.
  const pixels=id=>page.evaluate(id=>{const c=document.getElementById(id);return Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data);},id);
  await page.waitForFunction(()=>window.previewDrawn,null,{timeout:20000});
  const colours=await pixels('preview'),screen=await pixels('preview-screen');
  // Exactly the watch's frame: the same input drawn by the core here.
  {const {input,minute}=await page.evaluate(()=>window.previewDrawn);
  const {loadCore}=await import('../src/core.js'),read=f=>new Uint8Array(readFileSync(f));
  const core=await loadCore({wasm:read('public/core.wasm'),map:read('native/resources/map.pack'),figures:read('native/resources/figures.bin'),tables:read('native/resources/tables.bin'),grids:read('public/fuller.bin'),land:read('native/resources/land.pack')});
  core.build(input,0);const frame=core.render(minute,0);let differ=0;
  for(let i=0;i<200*228;i++){const c=frame[i];if(colours[4*i]!==((c>>4)&3)*85||colours[4*i+1]!==((c>>2)&3)*85||colours[4*i+2]!==(c&3)*85)differ++;}
  assert.equal(differ,0,'the preview is the core\'s own frame');}
  assert.equal(colours.length,200*228*4);
  assert.ok(new Set(colours.filter((v,i)=>i%4===0)).size>2,'the preview is drawn');
  assert.notDeepEqual(colours,screen,'the screen shows the colours muted');
  await page.check('input[name=plate][value=console]');
  assert.notDeepEqual(await pixels('preview'),colours,'the preview follows the plate');
  await page.check('input[name=plate][value=crt]');
  assert.equal(await page.locator('input[name=plate]:checked').getAttribute('value'),'crt');
  assert.equal(await page.locator('input[name=body]:checked').getAttribute('value'),'sun');
  assert.equal(await page.locator('#title').textContent(),'Groundtrack');
  assert.equal(await page.locator('input[name=figures]').count(),4);
  assert.equal(await page.locator('input[name=figures]:checked').getAttribute('value'),'michroma');
  assert.ok(await page.locator('input[name=clock24]').isChecked());
  assert.match(await page.locator('#preset-note').textContent(),/Greenwich/);
  assert.ok(await page.locator('#place').isHidden());
  // Two faces. Enroute follows the Sun, the Moon and the slow satellites,
  // and says of each fast one why it is not here and where it is; the
  // Plotboard the other way about. Each keeps the body it last followed.
  const followed=()=>page.locator('input[name=body]').evaluateAll(e=>e.map(x=>x.value));
  assert.deepEqual(await followed(),['sun','moon','sat:36585','sat:42738']);
  assert.equal(await page.locator('#others-title').textContent(),'Not on Enroute (5)');
  assert.match(await page.locator('#others-why').textContent(),/^Too fast for Enroute: .* They are on the Plotboard\.$/);
  assert.deepEqual(await page.locator('#unsuited li').evaluateAll(e=>e.map(li=>[li.firstChild.textContent,li.lastChild.textContent])),
    [['International Space Station','Round the Earth in 93 minutes'],['Tiangong','Round the Earth in 92 minutes'],['Hubble Space Telescope','Round the Earth in 95 minutes'],['Landsat 9','Round the Earth in 99 minutes'],['NOAA-20','Round the Earth in 101 minutes']]);
  await page.check('input[name=face][value=plotboard]');
  assert.deepEqual(await followed(),['sat:25544','sat:48274','sat:20580','sat:49260','sat:43013']);
  assert.equal(await page.locator('input[name=body]:checked').getAttribute('value'),'sat:25544');
  assert.equal(await page.locator('#chart-title').textContent(),'Plotboard');
  assert.equal(await page.locator('#others-title').textContent(),'Not on the Plotboard (4)');
  assert.match(await page.locator('#others-why').textContent(),/^Too slow for the Plotboard: .* They are on Enroute\.$/);
  assert.deepEqual(await page.locator('#unsuited li').evaluateAll(e=>e.map(li=>[li.firstChild.textContent,li.lastChild.textContent])),
    [['Sun','Comes round in 24 hours'],['Moon','Comes round in 25 hours'],['GPS BIIF-1 (PRN 25)','Comes round in 12 hours'],['QZS-2 (Michibiki)','Comes round in 24 hours']]);
  await page.check('input[name=body][value="sat:20580"]');
  await page.check('input[name=face][value=enroute]');
  assert.equal(await page.locator('input[name=body]:checked').getAttribute('value'),'sun');
  await page.check('input[name=face][value=plotboard]');
  assert.equal(await page.locator('input[name=body]:checked').getAttribute('value'),'sat:20580');
  // Each body's chart offers the settings it takes and no others, by the
  // rules the watch's own code is held to (tests/settings.test.mjs); a
  // setting out of sight keeps its value.
  {const {settingsFor,faceOf}=await import('../src/settings-rules.js'),{viewOf}=await import('../src/satellites.js');
  const offered=()=>page.evaluate(()=>{
    const seen=e=>!!e&&e.offsetParent!==null,group=n=>[...document.querySelectorAll(`input[name=${n}]`)].filter(seen).map(e=>e.value),chosen=n=>document.querySelector(`input[name=${n}]:checked`)?.value;
    return {readout:group('readout'),readoutShown:chosen('readout'),numerals:group('numerals').length>0,tape:group('tape').length>0,transfer:group('transfer').length>0,span:group('span').length>0,light:group('corner').includes('light'),note:document.getElementById('chart-note').textContent,
      rest:['plate','figures','margin','corner'].every(n=>group(n).length>1)&&seen(document.querySelector('input[name=clock24]'))};
  });
  const KIND={hour:'Hour chart',day:'Whole-day chart',world:'World band'};
  for(const body of ['sun','moon','sat:36585','sat:42738','sat:25544','sat:43013'])for(const readout of ['off','flag','callout'])for(const tape of viewOf(body)==='world'?['fixed','tape','slide','clock']:['fixed'])for(const span of viewOf(body)==='day'?['day','hour']:['day']){
    await page.check(`input[name=face][value=${faceOf(viewOf(body))}]`);
    await page.check(`input[name=body][value="${body}"]`);
    // (Set where the control shows; a hidden one keeps what it had.)
    for(const [name,value] of [['span',span],['tape',tape],['readout',readout]])if(await page.locator(`input[name=${name}][value=${value}]`).isVisible())await page.check(`input[name=${name}][value=${value}]`);
    const got=await offered(),chosen={span,tape,readout:got.readout.includes(readout)?readout:undefined};
    const want=settingsFor('enroute',body,viewOf(body),{span,tape,readout:chosen.readout??(got.readoutShown||'flag')});
    const at=`${body} ${readout} ${tape} ${span}`;
    assert.deepEqual(got.readout,want.readout,`${at}: the readouts offered`);
    assert.deepEqual([got.numerals,got.tape,got.transfer,got.span,got.light,got.note.startsWith(KIND[want.chart]),got.rest],[want.numerals,want.tape,want.transfer,want.span,want.light,true,true],`${at}: the settings offered`);
  }
  // Back to the ISS under the ruler with its flag, and Enroute's Sun.
  await page.check('input[name=face][value=plotboard]');await page.check('input[name=body][value="sat:25544"]');await page.check('input[name=tape][value=fixed]');await page.check('input[name=readout][value=flag]');
  await page.check('input[name=face][value=enroute]');await page.check('input[name=body][value=sun]');
  assert.equal(await page.locator('input[name=readout]:checked').getAttribute('value'),'flag');}
  // Nothing wider than a small phone.
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'the page scrolls sideways at 320 px');
  mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/native-settings.png',fullPage:true});

  // Choose the Moon on the Sectional, no flag, and a home of one's own.
  await page.check('input[name=body][value=moon]');
  await page.check('input[name=plate][value=sectional]');
  await page.check('input[name=readout][value=callout]');await page.check('input[name=numerals][value=accent]');await page.check('input[name=figures][value=orbitron]');await page.check('input[name=corner][value=point]');
  await page.check('input[name=margin][value=body]');await page.uncheck('input[name=clock24]');
  // The calendar is off until it has a link; something that is no link is
  // refused.
  assert.equal(await page.inputValue('input[name=calendar]'),'');
  await page.fill('input[name=calendar]','my calendar');
  await page.click('#save');await page.waitForTimeout(200);
  assert.equal(closes.length,0,'something that is no link closed the page');
  assert.match(await page.locator('#calendar-status').textContent(),/starts with https/);
  await page.fill('input[name=calendar]','webcal://calendar.example/private-abc/basic.ics');
  assert.equal(await page.locator('#now-events').textContent(),'On');
  await page.getByText('A place of my own').click();
  assert.ok(await page.locator('#place').isVisible());
  // A place searched for by name: the one meant is chosen from the answers.
  await page.fill('#search','Norfolk');
  await page.waitForSelector('#places button');
  assert.match(searches[0],/name=Norfolk/);
  assert.equal(await page.locator('#places button').count(),2);
  await page.locator('#places button').first().click();
  assert.deepEqual([await page.inputValue('input[name=lat]'),await page.inputValue('input[name=lon]')],['36.85','-76.29']);
  assert.match(await page.locator('#place-now').textContent(),/Norfolk · 36.85, -76.29/);
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
  assert.deepEqual([stored.bodyEnroute,stored.bodyPlotboard,stored.calendar],['moon','sat:25544','webcal://calendar.example/private-abc/basic.ics']);
  assert.deepEqual({body:stored.body,plate:stored.plate,readout:stored.readout,numerals:stored.numerals,figures:stored.figures,corner:stored.corner,margin:stored.margin,clock24:stored.clock24,home:JSON.parse(stored.home)},
    {body:'moon',plate:'sectional',readout:'callout',numerals:'accent',figures:'orbitron',corner:'point',margin:'body',clock24:'0',home:{lat:48.86,lon:2.35}});
  const i32=v=>[v&255,(v>>8)&255,(v>>16)&255,(v>>>24)&255];
  assert.equal(JSON.stringify(messages.find(m=>m.Settings).Settings),JSON.stringify([1,1,2,0,1,...i32(4886),...i32(235),...i32(0),0,0,0,0,4,1,0,0,3,1]));
  assert.equal(messages.find(m=>m.RiseSets).RiseSets.length,45*12);
  // The calendar's link is read at once (as https), and its timed event,
  // named by the phone, goes to the watch; the all-day one does not.
  for(let i=0;i<200&&!messages.some(m=>m.Events&&m.Events.length===9);i++)await new Promise(r=>setTimeout(r,20));
  assert.deepEqual(fetched,['https://calendar.example/private-abc/basic.ics']);
  const saved=JSON.parse(stored.events);
  assert.deepEqual(saved.map(e=>[e.title,e.label]),[['Dinner with Sam','DINNR']]);
  assert.equal(new Date(saved[0].epoch).toISOString(),'2026-09-27T14:30:00.000Z');
  assert.equal(messages.filter(m=>m.Events).pop().Events.length,9);
  assert.equal(stored['calendar-status'],'1 event in the next week');

  // Cancel changes nothing.
  const before=JSON.stringify(stored);listeners.webviewclosed({response:'CANCELLED'});
  assert.equal(JSON.stringify(stored),before);
  // Groundtrack Fuller is one face: no choice of face, every body followed,
  // and each sheet's own settings.
  {const out2=join(dir,'fuller.js');execFileSync(process.execPath,['tools/build-pkjs.mjs','--face','fuller',out2],{stdio:'pipe'});
  const l2={};let opened2=null;
  const c2=vm.createContext({console:{log:()=>{}},setTimeout:(f,ms)=>{const t=setTimeout(f,ms);t.unref();return t;},clearTimeout,XMLHttpRequest,navigator:{},
    localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},Pebble:{addEventListener:(n,f)=>{l2[n]=f;},openURL:u=>{opened2=u;},sendAppMessage:(m,ok)=>setTimeout(ok,0)}});
  vm.runInContext(`Date.now=()=>${now};`,c2);vm.runInContext(readFileSync(out2,'utf8').replace(/\n/g,'\n\t'),c2);
  l2.showConfiguration({});for(let i=0;i<400&&!opened2;i++)await new Promise(r=>setTimeout(r,20));
  const page2=await browser.newPage({viewport:{width:320,height:640},timezoneId:zone}),errors2=[];
  page2.on('pageerror',e=>errors2.push(e.message));
  await page2.setContent(decodeURIComponent(opened2.slice('data:text/html;charset=utf-8,'.length)));
  await page2.evaluate(()=>document.querySelectorAll('details').forEach(d=>{d.open=true;}));
  assert.equal(await page2.locator('#title').textContent(),'Groundtrack Fuller');
  assert.equal(await page2.locator('#sec-face').count(),0);
  assert.equal(await page2.locator('input[name=body]').count(),9);
  assert.ok(await page2.locator('#others').isHidden());
  assert.equal(await page2.locator('#chart-title').textContent(),'Sheet');
  assert.equal(await page2.locator('input[name=body]:checked').getAttribute('value'),'sat:25544');
  const shown=n=>page2.locator(`input[name=${n}]`).evaluateAll(e=>e.filter(x=>x.offsetParent!==null).map(x=>x.value));
  assert.deepEqual([await shown('readout'),(await shown('tape')).length,(await shown('numerals')).length>0],[['off','flag','callout'],0,false]);
  await page2.check('input[name=body][value=sun]');
  assert.deepEqual([await shown('readout'),(await shown('numerals')).length],[[],5]);
  assert.match(await page2.locator('#chart-note').textContent(),/^Whole-day sheet/);
  assert.equal(errors2.length,0,errors2.join('\n'));}
  console.log('settings page: ok');
}finally{
  await browser?.close();
  rmSync(dir,{recursive:true,force:true});
}
