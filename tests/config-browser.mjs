// The native app's settings page, as the phone opens it: shows the current
// settings, returns the new ones, and the phone then sends them to the watch.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';

async function replacePrimary(page,body){
  if(await primary(page)===body)return;
  await page.locator('[data-slot="0"] .replace-tracked').click();
  const row=page.locator((body.startsWith('sat:')?'#groups':'#bodies')+' .satellite-row[data-key="'+body+'"]');
  const details=row.locator('xpath=ancestor::details[contains(@class,"sub")]');
  if(await details.count()&&!await details.evaluate(d=>d.open))await details.locator('summary').click();
  await row.locator('.use-body').click();
}
const primary=page=>page.locator('[data-slot="0"]').getAttribute('data-key');
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
  const browserContext=await browser.newContext({viewport:{width:320,height:640},timezoneId:zone});
  const page=await browserContext.newPage();
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
  // The satellite search goes to CelesTrak: answered here with what it
  // gave for the name HIMAWARI on 2 October 2026, and for a catalog number
  // with the one set.
  // (And the catalog's own satellites with their sets of 2 October, which
  // the page asks for to preview one the phone has no elements for.)
  const asked=[],himawari=readFileSync('tests/fixtures/celestrak-name-himawari.txt','utf8'),searched=()=>asked.filter(u=>!/CATNR=(25544|43013|40296|36585|42738)&/.test(u));
  await page.context().route('https://celestrak.org/**',route=>{const url=route.request().url();asked.push(url);
    const number=/CATNR=(\d+)/.exec(url),lines=(himawari+readFileSync('tests/fixtures/celestrak-2026-10-02.tle','utf8')).split(/\r?\n/);let body=/NAME=HIMAWARI/.test(url)?himawari:'No GP data found';
    if(number)for(let i=0;i+2<lines.length;i+=3)if(Number(lines[i+1].slice(2,7))===Number(number[1]))body=lines.slice(i,i+3).join('\r\n')+'\r\n';
    route.fulfill({contentType:'text/plain',headers:{'access-control-allow-origin':'*'},body});});
  await page.setContent(html);
  // The sections fold: the face, what it follows and its own settings open,
  // each closed one saying what it holds.
  assert.deepEqual(await page.locator('details.card').evaluateAll(e=>e.map(d=>[d.id,d.open])),[['sec-face',true],['sec-follow',true],['sec-chart',true],['sec-time',false],['sec-look',false],['sec-home',false],['sec-events',false]]);
  assert.deepEqual(await page.locator('summary .now').allTextContents(),['Enroute','Sun','A flag','24-hour · Zulu','Green CRT · Michroma','Greenwich','Off']);
  assert.equal(await page.locator('#chart-title').textContent(),'Enroute');
  await page.waitForFunction(()=>window.previewDrawn,null,{timeout:20000});
  mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/native-settings-closed.png',fullPage:true});
  await page.evaluate(()=>document.querySelectorAll('details').forEach(d=>{d.open=true;}));
  // The current settings, the plates in their order (like with like, not
  // their numbers on the watch) and the zone's preset home.
  {const {PLATE_ORDER}=await import('../src/plates.js');
  assert.deepEqual(await page.locator('input[name=plate]').evaluateAll(e=>e.map(x=>x.value)),PLATE_ORDER);}
  // The preview: the face sketched in the settings, and as the watch's
  // reflective screen shows its colours; it follows the settings.
  const pixels=id=>page.evaluate(id=>{const c=document.getElementById(id);return Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data);},id);
  await page.waitForFunction(()=>window.previewDrawn,null,{timeout:20000});
  // (One preview: as the watch's screen shows it, or as drawn.)
  assert.equal(await page.locator('#colours-now').textContent(),'As the watch\'s screen shows it.');
  const screen=await pixels('preview');
  await page.click('#colours');
  assert.equal(await page.locator('#colours-now').textContent(),'In the colours as drawn.');
  const colours=await pixels('preview');
  // Exactly the watch's frame: the same input drawn by the core here.
  {const {input,minute}=await page.evaluate(()=>window.previewDrawn);
  const {loadCore}=await import('../src/core.js'),read=f=>new Uint8Array(readFileSync(f));
  const core=await loadCore({wasm:read('public/core.wasm'),map:read('native/resources/map.pack'),figures:read('native/resources/figures.bin'),tables:read('native/resources/tables.bin'),grids:read('public/fuller.bin'),land:read('native/resources/land.pack')});
  core.build(input,0);const frame=core.render(minute,0);let differ=0;
  for(let i=0;i<200*228;i++){const c=frame[i];if(colours[4*i]!==((c>>4)&3)*85||colours[4*i+1]!==((c>>2)&3)*85||colours[4*i+2]!==(c&3)*85)differ++;}
  assert.equal(differ,0,'the preview is the core\'s own frame');}
  assert.equal(colours.length,200*228*4);
  // The counter readout: this hour's figure as the time.
  assert.ok(await page.locator('input[name=readout][value=counter]').isVisible());
  await page.check('input[name=readout][value=counter]');
  await page.waitForFunction(()=>window.previewDrawn?.input.includes('\nreadout 3\n'));
  assert.notDeepEqual(await pixels('preview'),colours,'the counter is visible in the watch preview');
  assert.ok(await page.locator('input[name=numerals]').first().isVisible(),'the counter takes the time\'s figures');
  await page.check('input[name=readout][value=flag]');
  await page.waitForFunction(()=>window.previewDrawn?.input.includes('\nreadout 0\n')||window.previewDrawn?.input.includes('\nflag 1\n'));
  assert.deepEqual(await pixels('preview'),colours,'the flag again restores the original chart');
  assert.ok(new Set(colours.filter((v,i)=>i%4===0)).size>2,'the preview is drawn');
  assert.notDeepEqual(colours,screen,'the screen shows the colours muted');
  await page.check('input[name=plate][value=console]');
  assert.notDeepEqual(await pixels('preview'),colours,'the preview follows the plate');
  await page.check('input[name=plate][value=crt]');
  assert.equal(await page.locator('input[name=plate]:checked').getAttribute('value'),'crt');
  assert.equal(await primary(page),'sun');
  assert.equal(await page.locator('#title').textContent(),'Groundtrack');
  assert.equal(await page.locator('input[name=figures]').count(),4);
  assert.equal(await page.locator('input[name=figures]:checked').getAttribute('value'),'michroma');
  assert.ok(await page.locator('input[name=clock24]').isChecked());
  assert.match(await page.locator('#preset-note').textContent(),/Greenwich/);
  assert.ok(await page.locator('#place').isHidden());
  // Two faces, and every body listed whichever is in view: the Sun and
  // Moon, then the catalog's satellites in their groups. A satellite too
  // fast for Enroute is put on the Plotboard, with why; the face asked for
  // comes back with a body it can show.
  const {CATALOG,GROUPS}=await import('../src/satellites.js');
  assert.equal(await page.locator('input[name=tracked]').count(),2+CATALOG.length);
  assert.deepEqual(await page.locator('#groups details').evaluateAll(e=>e.map(d=>d.id)),GROUPS.map(g=>'group-'+g[0]));
  assert.match(await page.locator('#group-starlink summary').textContent(),/^Starlink 6 · SL1, SL5, SL2?P?/);
  const faceNow=()=>page.locator('input[name=face]:checked').getAttribute('value');
  assert.equal(await faceNow(),'enroute');
  assert.ok(await page.locator('#face-why').isHidden());
  await replacePrimary(page,'sat:25544');
  assert.equal(await faceNow(),'plotboard');
  assert.ok(await page.locator('input[name=face][value=enroute]').isDisabled());
  assert.equal(await page.locator('#face-why').textContent(),'International Space Station is on the Plotboard. Too fast for Enroute: round the Earth in 93 minutes, more of the world in an hour than its chart can hold.');
  assert.equal(await page.locator('#chart-title').textContent(),'Plotboard');
  assert.ok(await page.locator('input[name=readout][value=counter]').isHidden(),'the world band offers no counter');
  assert.ok(await page.locator('#corner-light').isVisible());
  assert.match(await page.locator('#corner-light-name').textContent(),/Estimated sunlight/);
  assert.match(await page.locator('#chart-note').textContent(),/^World band\. /);
  // The phone has no elements for it yet: the page asks CelesTrak, once,
  // and previews it.
  await page.waitForFunction(()=>window.previewDrawn&&/\ncode ISS\n/.test(window.previewDrawn.input),null,{timeout:20000});
  assert.equal(asked.filter(u=>/CATNR=25544&FORMAT=TLE$/.test(u)).length,1);
  assert.equal(await page.locator('#preview-note').textContent(),'');
  await replacePrimary(page,'sat:36585');
  assert.equal(await faceNow(),'enroute');
  assert.ok(await page.locator('input[name=face][value=enroute]').isEnabled());
  assert.ok(await page.locator('#face-why').isHidden());
  // The Plotboard shows a slow body's whole day, marked in hours.
  await page.check('input[name=face][value=plotboard]');
  assert.match(await page.locator('#chart-note').textContent(),/^World band, the whole day\. /);
  assert.match(await page.locator('#route-note').textContent(),/^A ruler of the day/);
  // The Sun and Moon can be marked beside what is followed, not beside
  // themselves; the preview shows them.
  {const before=await pixels('preview');
  await page.check('input[name=also][value=sun]');await page.check('input[name=also][value=moon]');
  assert.notDeepEqual(await pixels('preview'),before,'the Sun and Moon are marked on the preview');
  assert.equal(await page.locator('#now-follow').textContent(),'GPS · with the Sun and Moon');
  await replacePrimary(page,'sat:25544');
  assert.match(await page.locator('#route-note').textContent(),/^A ruler as long as the hour's run/);
  await replacePrimary(page,'sun');
  // (Both are always offered; the one followed is not marked beside itself.)
  assert.deepEqual(await page.locator('input[name=also]').evaluateAll(e=>e.map(x=>[x.offsetParent!==null,x.disabled,x.checked])),[[true,true,false],[true,false,true]]);
  // The preview stays at the top of the screen as the settings scroll.
  {await page.evaluate(()=>scrollTo(0,1500));await page.waitForTimeout(100);
  const top=await page.evaluate(()=>document.querySelector('.preview').getBoundingClientRect().top);assert.equal(top,0);
  await page.evaluate(()=>scrollTo(0,0));}
  await page.uncheck('input[name=also][value=moon]');}
  // Any other satellite, from CelesTrak: by name, the one meant chosen from
  // the answers, added under Your satellites and followed; by catalog
  // number; and one already listed is only chosen.
  await page.locator('[data-slot="0"] .replace-tracked').click();
  await page.fill('#find','hi');await page.click('#find-go');
  assert.match(await page.locator('#find-note').textContent(),/^Three letters or more/);
  await page.fill('#find','http://example.com/gp.php?CATNR=5');await page.click('#find-go');
  assert.match(await page.locator('#find-note').textContent(),/^Only CelesTrak's links/);
  assert.equal(searched().length,0);
  await page.fill('#find','HIMAWARI');await page.press('#find','Enter');
  await page.waitForSelector('#found .use-body');
  assert.match(searched()[0],/gp\.php\?NAME=HIMAWARI&FORMAT=TLE$/);
  assert.equal(await page.locator('#found .use-body').count(),13);
  assert.match(await page.locator('#found .satellite-row').nth(10).textContent(),/HIMAWARI-8/);
  await page.locator('#found .use-body').nth(10).click();
  assert.equal(await primary(page),'sat:40267');
  assert.match(await page.locator('#group-yours summary').textContent(),/^Your satellites 1$/);
  assert.equal(await page.locator('#now-follow').textContent(),'HIM · with the Sun');
  // (Previewed at once, on the elements it came with.)
  await page.waitForFunction(()=>window.previewDrawn&&/^body 2\n/.test(window.previewDrawn.input)&&/\ncode HIM\n/.test(window.previewDrawn.input));
  assert.equal(await page.locator('#preview-note').textContent(),'');
  // (The same question is not put to CelesTrak twice.)
  await page.locator('[data-slot="0"] .replace-tracked').click();
  await page.fill('#find','HIMAWARI');await page.click('#find-go');await page.waitForSelector('#found .use-body');
  assert.equal(searched().length,1);
  await page.fill('#find','41836');await page.click('#find-go');
  await page.waitForFunction(()=>document.querySelectorAll('#found .use-body').length===1);
  assert.match(searched()[1],/gp\.php\?CATNR=41836&FORMAT=TLE$/);
  await page.locator('#found .use-body').first().click();
  assert.equal(await primary(page),'sat:41836');
  assert.match(await page.locator('#group-yours summary').textContent(),/^Your satellites 1$/);
  await page.fill('#find','https://celestrak.org/NORAD/elements/gp.php?NAME=NOSUCH&FORMAT=JSON');await page.click('#find-go');
  await page.waitForFunction(()=>/^Nothing found/.test(document.getElementById('find-note').textContent));
  assert.match(searched()[2],/NAME=NOSUCH&FORMAT=TLE$/);
  // One added can be removed; here a second is, and the first kept.
  await page.locator('[data-slot="0"] .replace-tracked').click();
  await page.fill('#find','HIMAWARI');await page.click('#find-go');await page.waitForSelector('#found .use-body');
  await page.locator('#found .use-body').first().click();
  assert.match(await page.locator('#group-yours summary').textContent(),/^Your satellites 2$/);
  await page.evaluate(()=>{document.getElementById('group-yours').open=true;});
  await replacePrimary(page,'sun');
  await page.locator('#group-yours button.drop').nth(1).click();
  assert.match(await page.locator('#group-yours summary').textContent(),/^Your satellites 1$/);
  assert.equal(await primary(page),'sun');
  await page.evaluate(()=>document.querySelectorAll('details').forEach(d=>{d.open=true;}));
  // Each body's chart offers the settings it takes and no others, by the
  // rules the watch's own code is held to (tests/settings.test.mjs); a
  // setting out of sight keeps its value.
  {const {settingsFor}=await import('../src/settings-rules.js'),{viewOf,plotOf}=await import('../src/satellites.js');
  const offered=()=>page.evaluate(()=>{
    const seen=e=>!!e&&e.offsetParent!==null,group=n=>[...document.querySelectorAll(`input[name=${n}]`)].filter(seen).map(e=>e.value),chosen=n=>document.querySelector(`input[name=${n}]:checked`)?.value;
    return {readout:group('readout'),readoutShown:chosen('readout'),numerals:group('numerals').length>0,tape:group('tape').length>0,transfer:group('transfer').length>0,span:group('span').length>0,light:group('corner').includes('light'),bare:group('hourFigures').length>0,note:document.getElementById('chart-note').textContent,
      rest:['plate','figures','margin','corner'].every(n=>group(n).length>1)&&seen(document.querySelector('input[name=clock24]'))};
  });
  const KIND={hour:'Hour chart.',day:'Whole-day chart.',world:'World band.',worldday:'World band, the whole day.'};
  // (The Sun, the Moon, GPS, QZSS, the ISS, NOAA-20, and Meridian 7 in its
  // oval orbit, each on each face that can show it.)
  for(const body of ['sun','moon','sat:36585','sat:42738','sat:25544','sat:43013','sat:40296'])for(const face of viewOf(body)==='world'?['plotboard']:['enroute','plotboard'])
  for(const readout of ['off','flag','callout'])for(const tape of face==='plotboard'?['fixed','tape','slide','clock','route']:['fixed'])for(const span of viewOf(body)==='day'&&face==='enroute'?['day','hour']:['day']){
    await replacePrimary(page,body);
    await page.check(`input[name=face][value=${face}]`);
    // (Set where the control shows; a hidden one keeps what it had.)
    for(const [name,value] of [['span',span],['tape',tape],['readout',readout]])if(await page.locator(`input[name=${name}][value=${value}]`).isVisible())await page.check(`input[name=${name}][value=${value}]`);
    const got=await offered(),chosen={span,tape,readout:got.readout.includes(readout)?readout:undefined};
    const want=settingsFor(face,body,viewOf(body),{span,tape,readout:chosen.readout??(got.readoutShown||'flag'),plot:plotOf(body)});
    const at=`${body} ${face} ${readout} ${tape} ${span}`;
    assert.deepEqual(got.readout,want.readout,`${at}: the readouts offered`);
    assert.deepEqual([got.numerals,got.tape,got.transfer,got.span,got.light,got.bare,got.note.startsWith(KIND[want.chart]),got.rest],[want.numerals,want.tape,want.transfer,want.span,want.light,want.bare,true,true],`${at}: the settings offered`);
  }
  // Back to the ISS under the ruler with its flag, and Enroute's Sun.
  await replacePrimary(page,'sat:25544');await page.check('input[name=tape][value=fixed]');await page.check('input[name=readout][value=flag]');
  await replacePrimary(page,'sun');await page.check('input[name=face][value=enroute]');
  assert.equal(await page.locator('input[name=readout]:checked').getAttribute('value'),'flag');}
  // Nothing wider than a small phone.
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'the page scrolls sideways at 320 px');
  mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/native-settings.png',fullPage:true});

  // The hour chart can leave its hour figures off: the route alone, the
  // time in full beside the body, the readout no longer a choice.
  {assert.ok(await page.locator('input[name=hourFigures][value="0"]').isVisible());
  const before=await pixels('preview');
  await page.check('input[name=hourFigures][value="0"]');
  assert.notDeepEqual(await pixels('preview'),before,'the preview follows the hour figures');
  assert.equal(await page.locator('input[name=readout]').evaluateAll(e=>e.filter(x=>x.offsetParent!==null).length),0);
  assert.match(await page.locator('#readout-fixed').textContent(),/^Without the hour's figures/);
  assert.match(await page.evaluate(()=>window.previewDrawn.input),/\nreadout 2\n[^]*\nbare 1\n/);
  await page.check('input[name=face][value=plotboard]');
  assert.ok(await page.locator('input[name=hourFigures][value="0"]').isHidden());
  await page.check('input[name=face][value=enroute]');}
  // Choose the Moon on the Sectional, no flag, and a home of one's own.
  await replacePrimary(page,'moon');
  await page.check('input[name=plate][value=sectional]');
  await page.check('input[name=hourFigures][value="1"]');
  await page.check('input[name=readout][value=callout]');await page.check('input[name=hourFigures][value="0"]');await page.check('input[name=numerals][value=accent]');await page.check('input[name=figures][value=orbitron]');await page.check('input[name=corner][value=point]');
  await page.check('input[name=margin][value=body]');await page.uncheck('input[name=clock24]');
  // Vibrate when the phone goes out of reach (off until asked for); the
  // fuel line (on until turned off), which the preview follows.
  assert.ok(!await page.locator('input[name=vibe]').isChecked());await page.check('input[name=vibe]');
  assert.ok(await page.locator('input[name=fuel]').isChecked());
  {const before=await pixels('preview');await page.uncheck('input[name=fuel]');assert.notDeepEqual(await pixels('preview'),before,'the preview drops the fuel line');await page.check('input[name=fuel]');}
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
  assert.deepEqual([stored.face,stored.also,stored.calendar],['enroute','sun','webcal://calendar.example/private-abc/basic.ics']);
  // The satellite added is kept, with the elements it came with, as if the
  // phone had fetched them itself.
  assert.deepEqual(JSON.parse(stored.sats),[{norad:40267,name:'HIMAWARI-8',code:'HIM',period:1436.2,ecc:0,still:true}]);
  assert.match(JSON.parse(stored['tle-40267']).text,/^HIMAWARI-8\n1 40267U /);
  assert.equal(JSON.parse(stored['tle-40267']).fetched,now);
  assert.deepEqual({body:stored.body,plate:stored.plate,readout:stored.readout,numerals:stored.numerals,figures:stored.figures,corner:stored.corner,margin:stored.margin,clock24:stored.clock24,home:JSON.parse(stored.home)},
    {body:'moon',plate:'sectional',readout:'callout',numerals:'accent',figures:'orbitron',corner:'point',margin:'body',clock24:'0',home:{lat:48.86,lon:2.35}});
  const i32=v=>[v&255,(v>>8)&255,(v>>16)&255,(v>>>24)&255];
  assert.equal(JSON.stringify(messages.find(m=>m.Settings).Settings),JSON.stringify([1,1,2,0,1,...i32(4886),...i32(235),...i32(0),0,0,0,0,4,1,0,0,3,1,1,1,0,1,...Array(14).fill(0)]));
  assert.equal(stored.vibe,'1');
  assert.equal(stored.hourFigures,'0');
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
  const l2={},stored2={},messages2=[];let opened2=null;
  const c2=vm.createContext({console:{log:()=>{}},setTimeout:(f,ms)=>{const t=setTimeout(f,ms);t.unref();return t;},clearTimeout,XMLHttpRequest,navigator:{},
    localStorage:{getItem:k=>stored2[k]??null,setItem:(k,v)=>{stored2[k]=String(v);},removeItem:k=>{delete stored2[k];}},Pebble:{addEventListener:(n,f)=>{l2[n]=f;},openURL:u=>{opened2=u;},sendAppMessage:(m,ok)=>{messages2.push(m);setTimeout(ok,0);}}});
  vm.runInContext(`Date.now=()=>${now};`,c2);vm.runInContext(readFileSync(out2,'utf8').replace(/\n/g,'\n\t'),c2);
  l2.showConfiguration({});for(let i=0;i<400&&!opened2;i++)await new Promise(r=>setTimeout(r,20));
  const page2=await page.context().newPage(),errors2=[];
  page2.on('pageerror',e=>errors2.push(e.message));
  await page2.setContent(decodeURIComponent(opened2.slice('data:text/html;charset=utf-8,'.length)));
  await page2.evaluate(()=>document.querySelectorAll('details').forEach(d=>{d.open=true;}));
  assert.equal(await page2.locator('#title').textContent(),'Groundtrack Fuller');
  assert.equal(await page2.locator('#sec-face').count(),0);
  assert.equal(await page2.locator('input[name=tracked]').count(),2+CATALOG.length);
  assert.ok(await page2.locator('#group-stations').evaluate(d=>d.open),'the chosen satellite\'s group is open');
  assert.equal(await page2.locator('#chart-title').textContent(),'Sheet');
  assert.equal(await primary(page2),'sat:25544');
  const shown=n=>page2.locator(`input[name=${n}]`).evaluateAll(e=>e.filter(x=>x.offsetParent!==null).map(x=>x.value));
  assert.deepEqual([await shown('readout'),(await shown('tape')).length,(await shown('numerals')).length>0],[['off','flag','counter','callout'],0,false]);
  await replacePrimary(page2,'sun');
  assert.deepEqual([await shown('readout'),(await shown('numerals')).length],[[],5]);
  assert.match(await page2.locator('#chart-note').textContent(),/^Whole-day sheet/);
  // The sheet's open space can carry a scale bar (Fuller alone offers it).
  assert.ok(await page2.locator('input[name=legend]').isVisible());
  assert.ok(await page.locator('input[name=legend]').isHidden());
  await page2.waitForFunction(()=>window.previewDrawn,null,{timeout:20000});
  await page2.check('input[name=legend]');
  await page2.waitForFunction(()=>/\nlegend 1\n/.test(window.previewDrawn.input));
  assert.ok(await page.locator('input[name=north]').isHidden());
  await page2.check('input[name=north]');
  await page2.waitForFunction(()=>/\nlegend 3\n/.test(window.previewDrawn.input));
  await page2.check('input[name=tracked][value="sat:25544"]');
  await page2.check('input[name=tracked][value="sat:43013"]');
  await page2.waitForFunction(()=>/\nextra 25544 43013\n/.test(window.previewDrawn.input));
  assert.match(await page2.evaluate(()=>window.previewDrawn.input),/extra_code0 ISS\nextra_code1 N20\n/);
  assert.equal(await page2.locator('input[name=tracked]:checked').count(),3);
  assert.equal(await page2.locator('select[name=extra0]').count(),0);
  assert.ok(await page2.evaluate(()=>document.documentElement.scrollWidth<=320));
  // Selection never changes the primary implicitly; replacement can be cancelled.
  assert.equal(await primary(page2),'sun');
  assert.ok(await page2.locator('input[name=tracked][value="sat:48274"]').isDisabled());
  await page2.locator('[data-slot="0"] .replace-tracked').click();await page2.click('#picker-cancel');assert.equal(await primary(page2),'sun');
  await page2.locator('[data-slot="1"] .make-primary').click();assert.equal(await primary(page2),'sat:25544');
  assert.ok(await page2.locator('input[name=also][value=sun]').isChecked());
  await page2.locator('[data-slot="1"] .add-companion').click();
  assert.ok(await page2.locator('#groups .satellite-row[data-key="sat:25544"] .use-body').isDisabled(),'an empty slot cannot remove the primary');
  async function custom(slot,norad){
    if(await page2.locator('#picker-mode').isHidden())await page2.locator('[data-slot="'+slot+'"] .replace-tracked').click();
    await page2.fill('#find',String(norad));await page2.click('#find-go');
    await page2.locator('#found .satellite-row[data-key="sat:'+norad+'"] .use-body').click();
    assert.equal(await page2.locator('[data-slot="'+slot+'"]').getAttribute('data-key'),'sat:'+norad);
  }
  await custom(1,40267);
  await page2.locator('[data-slot="1"] .make-primary').click();assert.equal(await primary(page2),'sat:40267');
  assert.equal(await page2.locator('[data-slot="1"]').getAttribute('data-key'),'sat:25544','promotion keeps the former primary');
  await custom(1,10143);await custom(2,12677);
  await page2.waitForFunction(()=>window.previewDrawn?.input.includes('extra 10143 12677'));
  assert.ok(await page2.locator('#found .drop').isHidden(),'tracking removal and forgetting the saved custom satellite are distinct');
  // A keyboard checkmark adds the removed custom companion back, without changing primary.
  await page2.locator('[data-slot="2"] .remove-tracked').click();
  await page2.locator('#found input[name=tracked]').focus();await page2.keyboard.press('Space');
  assert.equal(await primary(page2),'sat:40267');assert.equal(await page2.locator('[data-slot="2"]').getAttribute('data-key'),'sat:12677');
  await page2.fill('#find','');
  await page2.evaluate(()=>document.querySelectorAll('#groups details').forEach(d=>{d.open=d.id==='group-yours';}));
  for(const width of [320,390]){
    await page2.setViewportSize({width,height:844});assert.ok(await page2.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await page2.screenshot({path:'test-results/shared-picker.png',fullPage:true});
  const closes2=[],cdp2=await page2.context().newCDPSession(page2);await cdp2.send('Page.enable');cdp2.on('Page.frameRequestedNavigation',e=>closes2.push(e.url));
  await page2.click('#save');for(let i=0;i<50&&!closes2.length;i++)await page2.waitForTimeout(50);
  assert.ok(closes2[0]?.startsWith('pebblejs://close#'));l2.webviewclosed({response:closes2[0].slice('pebblejs://close#'.length)});
  for(let i=0;i<100&&!messages2.some(m=>m.Settings);i++)await page2.waitForTimeout(20);
  assert.equal(stored2.body,'sat:40267');assert.equal(stored2.extra,'sat:10143,sat:12677');
  assert.deepEqual(JSON.parse(stored2.sats).map(e=>e.norad),[40267,10143,12677]);
  for(const n of [40267,10143,12677])assert.ok(JSON.parse(stored2['tle-'+n]).text.includes('1 '+n));
  const wire=messages2.find(m=>m.Settings).Settings,u32=at=>wire[at]|wire[at+1]<<8|wire[at+2]<<16|wire[at+3]<<24;
  assert.deepEqual([u32(13),u32(31),u32(35)],[40267,10143,12677]);
  opened2=null;l2.showConfiguration({});for(let i=0;i<400&&!opened2;i++)await new Promise(r=>setTimeout(r,20));
  await page2.setContent(decodeURIComponent(opened2.slice('data:text/html;charset=utf-8,'.length)));
  assert.equal(await primary(page2),'sat:40267');assert.deepEqual(await page2.locator('.tracking-card').evaluateAll(cards=>cards.map(c=>c.dataset.key)),['sat:40267','sat:10143','sat:12677']);

  await page2.setViewportSize({width:320,height:844});
  await page2.evaluate(()=>scrollBy(0,document.getElementById('tracking-cards').getBoundingClientRect().top-190));
  await page2.screenshot({path:'test-results/shared-picker-cards.png'});
  assert.equal(errors2.length,0,errors2.join('\n'));}
  console.log('settings page: ok');
}finally{
  await browser?.close();
  rmSync(dir,{recursive:true,force:true});
}
