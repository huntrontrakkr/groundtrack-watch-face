// The watch app itself on the host (native/host/watch_sim.c: main.c and
// watch_data.c over a stand-in SDK, sanitized, in the watch's heap), with
// the phone's own code (the bundle) playing the phone to it: what a new
// watch asks for and is sent draws its chart, the same pixels the core draws
// from the phone's input for that hour, in any time zone; the days after go
// by without a blank; a phone with nothing to give is asked less and less.
// Skipped where no C compiler is available.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import vm from 'node:vm';
import {registerLiveFixture} from './tle-fixture.mjs';
import {registerNominal} from '../src/nominal.js';
import {renderer} from './core-fixture.mjs';
import {nameCode} from '../src/events.js';

let cc=true;try{execFileSync('make',['-s','-C','native/host','watch_sim-enroute','watch_sim-fuller'],{stdio:'pipe'});}catch{cc=false;}
// (The fixture's elements over the nominal orbits, as the phone has them.)
registerNominal();registerLiveFixture();
const dir=mkdtempSync(join(tmpdir(),'groundtrack-watch-'));
const bundles={};
const bundle=face=>bundles[face]??=(()=>{const out=join(dir,face+'.js');execFileSync(process.execPath,['tools/build-pkjs.mjs','--face',face,out],{stdio:'pipe'});return readFileSync(out,'utf8').replace(/\n/g,'\n\t');})();
// (A failed case leaves its watch running: stopped here, so the run ends.)
const watches=new Set();
test.afterEach(()=>{for(const w of watches)w.p.kill();watches.clear();});
test.after(()=>rmSync(dir,{recursive:true,force:true}));
// The fixture's element sets, as the phone keeps them once fetched.
// (WATCH_TLE names another file of them, WATCH_NOW the time to start the
// satellites' test at: `WATCH_TLE=/tmp/all.tle WATCH_NOW=2026-10-02T13:40:00Z`
// runs every satellite on today's elements.)
const TLE_FILE=process.env.WATCH_TLE||'tests/fixtures/celestrak-2026-09-29.tle';
if(process.env.WATCH_TLE){const {registerElements}=await import('../src/satellites.js');const l=readFileSync(TLE_FILE,'utf8').trim().split('\n');for(let i=0;i+2<l.length;i+=3)registerElements(l.slice(i,i+3).join('\n')+'\n','celestrak');}
const sets=file=>Object.fromEntries(readFileSync(file,'utf8').trim().split('\n').reduce((sets,line,i)=>{if(i%3===0)sets.push([]);sets.at(-1).push(line);return sets;},[]).map(l=>[Number(l[1].slice(2,7)),l.join('\n')+'\n']));
let TLES=sets(TLE_FILE);
// The watch's heap: what its 128 KB leaves after the app (about 64.5 KB of
// code and data on Groundtrack, 65.0 on Fuller) and the system's own share,
// as the emulator reports it free when a build starts, with the lettering's
// glyphs; modelled as the watch's is (native/host/heap_model.h), a block
// taking the first stretch that holds it, so a heap left in pieces by a
// build fails here as it does there. The tests run in 2 KB less.
const HEAPS={enroute:62250+1687-2000,fuller:61700+1687-2000};
// What the app holds for its life: the lettering's glyphs (1,679 bytes, in a
// block of the heap's).
const GLYPHS=1688;

// The watch: commands in, each answered by its requests and its screen.
class Watch{
  constructor(face,t,zone,heap=HEAPS[face]){
    this.p=spawn(`native/host/watch_sim-${face}`,[String(Math.floor(t/1000))],{env:{...process.env,TZ:zone,ASAN_OPTIONS:'detect_leaks=0',SIM_HEAP:String(heap)}});
    watches.add(this);this.err='';this.p.stderr.on('data',d=>{this.err+=d;});this.blocks=[];this.waiting=[];this.lines=[];this.requests=[];
    this.done=new Promise(r=>this.p.on('close',status=>{this.status=status;for(const w of this.waiting)w(null);r();}));
    createInterface({input:this.p.stdout}).on('line',line=>{
      if(line!=='.'){this.lines.push(JSON.parse(line));return;}
      const block={requests:this.lines.filter(l=>'request' in l),state:this.lines.find(l=>'note' in l)};this.lines=[];
      const w=this.waiting.shift();if(w)w(block);else this.blocks.push(block);
    });
  }
  block(){return this.blocks.length?Promise.resolve(this.blocks.shift()):new Promise(r=>this.waiting.push(r));}
  async cmd(text){
    this.p.stdin.write(text+'\n');const b=await this.block();
    assert.ok(b,`the watch stopped at "${text.slice(0,60)}": ${this.err.slice(0,3000)}`);
    this.requests.push(...b.requests);this.state=b.state;return b;
  }
  async close(){this.p.stdin.end();await this.done;assert.equal(this.status,0,this.err.slice(0,3000));assert.equal(this.err,'');return this.lines.find(l=>'held' in l).held;}
}
// The phone: the bundle, its clock the watch's, its messages kept in order.
function phone(face,stored){
  const listeners={},out=[];let pending=0;
  // (A wait of an hour or more, the calendar's next reading, never comes here.)
  const later=(f,ms)=>{if(ms>=3600000)return 0;pending++;setTimeout(()=>{pending--;f();},Math.min(ms/1000,50));return 1;};
  // (CelesTrak is out of reach: the phone falls back on what it has kept.)
  function XMLHttpRequest(){this.open=()=>{};this.send=()=>later(()=>this.onerror&&this.onerror(),0);}
  const context=vm.createContext({console:{log:()=>{}},NOW:0,XMLHttpRequest,
    setTimeout:later,clearTimeout:()=>{},
    localStorage:{getItem:k=>k in stored?stored[k]:null,setItem:(k,v)=>{stored[k]=v;},removeItem:k=>{delete stored[k];}},
    Pebble:{addEventListener:(n,f)=>{listeners[n]=f;},sendAppMessage:(m,ok)=>{out.push(m);pending++;setTimeout(()=>{pending--;ok();},0);}}});
  vm.runInContext('Date.now=()=>NOW;',context);vm.runInContext(bundle(face),context);
  const quiet=async()=>{for(let idle=0;idle<2;){await new Promise(r=>setTimeout(r,8));idle=pending?0:idle+1;}};
  return {listeners,out,quiet,at:t=>{context.NOW=t;}};
}
const hex=bytes=>bytes.map(b=>(b&255).toString(16).padStart(2,'0')).join('');
// What the phone has sent, given to the watch.
async function deliver(w,ph){
  for(const m of ph.out.splice(0)){
    if(m.Status!==undefined)await w.cmd(`text Status ${m.Status}`);
    else if(m.Passes)await w.cmd(`body Passes ${hex(m.Passes)} ${m.DataBody}`);
    else{const key=Object.keys(m)[0];await w.cmd(`msg ${key} ${hex(m[key])}`);}
  }
}
// The watch's requests answered, until it asks no more (or `rounds` are up).
async function answer(w,ph,rounds=4){
  for(let n=0;w.requests.length&&n<rounds;n++){
    for(const r of w.requests.splice(0)){ph.at(r.t*1000);ph.listeners.appmessage({payload:{DataRequest:r.request,...(r.body?{DataBody:r.body}:{})}});await ph.quiet();}
    await deliver(w,ph);await w.cmd('run 4');
  }
}
// A phone's storage for a case: its settings, home, events and (kept as
// fetched an hour before) the fixture's elements.
function storage(c,t){
  const s={timeZone:c.zone,body:c.body,plate:c.plate||'enroute',readout:c.readout||'flag',numerals:c.numerals||'even',figures:c.figures||'michroma',corner:c.corner||'day',margin:c.margin||'utc',span:c.span||'day',tape:c.tape||'fixed',transfer:c.transfer||'off',clock24:c.clock24===false?'0':'1',...(c.face?{face:c.face}:{}),also:(c.also||[]).join(','),hourFigures:c.bare?'0':'1',legend:c.legend?'1':'0',ticker:c.ticker?'1':'0',
    home:c.home?JSON.stringify({lat:c.home.lat,lon:c.home.lon}):JSON.stringify({none:true}),events:JSON.stringify((c.events||[]).map(([minutes,title])=>({epoch:t+minutes*60000,title,label:nameCode(title)})))};
  // (Events come from a calendar's link: read a moment ago, as the phone keeps it.)
  if((c.events||[]).length){s.calendar='https://calendar.example/private/basic.ics';s['calendar-fetched']=String(t);}
  for(const [norad,text] of Object.entries(TLES)){s['tle-'+norad]=JSON.stringify({text,fetched:t-3600e3,epoch:t-86400e3});}
  return s;
}
// A new watch at time t: the phone starts, the watch asks, the phone
// answers. Returns the watch and phone, the chart drawn.
async function fresh(face,c,t,heap){
  const w=new Watch(face,t,c.zone,heap),ph=phone(face,storage(c,t));
  const first=await w.block();w.requests.push(...first.requests);w.state=first.state;
  assert.equal(w.state.chart,false);
  ph.at(t);ph.listeners.ready({});await ph.quiet();await deliver(w,ph);
  await answer(w,ph);
  return {w,ph};
}
const what=(face,c,t)=>`${face} ${JSON.stringify(c)} at ${new Date(t).toISOString()}`;
// The frame the core draws for the phone's own input of the hour.
async function expected(face,c,t){
  const r=await renderer();
  r.render({body:c.body,epoch:t,timeZone:c.zone,clock24:c.clock24!==false,plate:c.plate||'enroute',readout:c.readout==='off'?false:c.readout||'flag',numerals:c.numerals||'even',zone:c.margin||'utc',span:c.span||'day',tape:c.tape||'fixed',transfer:c.transfer||'off',
    figures:c.figures||'michroma',corner:c.corner||'day',events:(c.events||[]).map(([minutes,title])=>({epoch:c.t0+minutes*60000,label:nameCode(title)})),home:c.home?{code:'HOM',name:'Home',...c.home}:null,projection:face==='fuller'?'fuller':'chart',face:c.face,also:c.also||[],bare:!!c.bare,legend:!!c.legend,ticker:!!c.ticker});
  return Buffer.from(r.last.frame);
}
async function same(face,c,w,label){
  const file=join(dir,'frame.bin');await w.cmd(`frame ${file}`);
  const got=readFileSync(file),want=await expected(face,c,w.state.t*1000);let differ=0,first=null;
  for(let i=0;i<got.length;i++)if(got[i]!==want[i]){differ++;first??=[i%200,Math.floor(i/200)];}
  assert.equal(differ,0,`${label}: ${differ} pixels differ from the core's frame, first at ${first}`);
}

const NY={lat:40.71,lon:-74.01},KTM={lat:27.7,lon:85.32},MCM={lat:-77.85,lon:166.67};
// (GPS and QZSS are on their nominal orbits, which the reference renders
// within three days of their epoch, 27 September.)
// New watches: every kind of chart on each app, in zones on the hour, the
// half hour and the three-quarter hour, early in the hour and late, just
// after midnight UTC and just before; with home and without, events, and
// the settings' corners.
const NEW_ALL=[
  ['enroute',{body:'sun',zone:'Asia/Kathmandu',plate:'survey',ticker:true},'2026-09-30T13:59:20Z'],
  ['enroute',{body:'sat:25544',zone:'UTC',plate:'trackingboard',ticker:true,tape:'slide',corner:'light',events:[[10,'Launch']]},'2026-09-30T13:09:00Z'],
  ['fuller',{body:'sat:25544',zone:'America/New_York',plate:'operations',ticker:true,corner:'light',home:NY},'2026-09-30T13:59:20Z'],
  ['fuller',{body:'sun',zone:'UTC',plate:'survey',ticker:true},'2026-09-30T17:24:00Z'],
  ['enroute',{body:'sun',zone:'UTC'},'2026-09-30T00:10:20Z'],['enroute',{body:'sun',zone:'America/New_York',home:NY,readout:'callout',numerals:'colon',clock24:false},'2026-09-30T23:58:30Z'],
  ['enroute',{body:'moon',zone:'Asia/Kolkata',home:KTM,plate:'airbrush',corner:'light'},'2026-09-30T01:12:00Z'],['enroute',{body:'moon',zone:'Asia/Kathmandu',home:KTM,plate:'crt',corner:'point',margin:'body'},'2026-10-01T00:03:10Z'],
  ['enroute',{body:'sun',zone:'Pacific/Kiritimati',plate:'odyssey',events:[[5,'Run'],[40,'Standup'],[-200,'Old']]},'2026-09-30T10:20:00Z'],['enroute',{body:'sun',zone:'Pacific/Chatham',home:MCM,plate:'hypsometric'},'2026-09-30T11:16:00Z'],
  ['enroute',{body:'sat:36585',zone:'America/St_Johns',home:NY,plate:'airbrush'},'2026-09-30T05:29:00Z'],['enroute',{body:'sat:36585',zone:'UTC',plate:'console',readout:'callout'},'2026-09-29T20:59:30Z'],
  ['enroute',{body:'sat:42738',zone:'Asia/Tokyo',home:{lat:35.68,lon:139.69},plate:'sectional'},'2026-09-28T15:00:05Z'],['enroute',{body:'sat:42738',zone:'Asia/Dhaka',plate:'dotmatrix'},'2026-09-28T18:00:30Z'],
  ['enroute',{body:'sat:42738',zone:'Asia/Kathmandu',span:'hour',readout:'callout'},'2026-09-29T00:20:00Z'],['enroute',{body:'sat:25544',zone:'America/New_York',home:NY,plate:'crt'},'2026-09-30T13:07:00Z'],
  ['enroute',{body:'sat:25544',zone:'Asia/Kathmandu',home:KTM,plate:'amber',tape:'slide'},'2026-09-30T01:01:00Z'],['enroute',{body:'sat:43013',zone:'Australia/Eucla',home:MCM,plate:'console',tape:'clock',clock24:false},'2026-09-30T16:02:00Z'],
  ['enroute',{body:'sat:49260',zone:'Pacific/Chatham',plate:'red',tape:'tape',transfer:'comb',events:[[12,'Launch']]},'2026-10-01T09:14:40Z'],['enroute',{body:'sat:48274',zone:'UTC',plate:'blueprint',transfer:'vernier',figures:'orbitron'},'2026-09-30T23:59:10Z'],
  ['fuller',{body:'sat:25544',zone:'America/New_York',home:NY,plate:'crt'},'2026-09-30T13:07:00Z'],['fuller',{body:'sun',zone:'Asia/Kathmandu',plate:'odyssey'},'2026-09-30T00:05:00Z'],
  ['fuller',{body:'moon',zone:'Pacific/Kiritimati',home:NY,plate:'airbrush',readout:'callout'},'2026-09-30T10:01:00Z'],['fuller',{body:'sat:42738',zone:'Asia/Dhaka',plate:'console'},'2026-09-28T18:00:30Z'],
  ['fuller',{body:'sat:36585',zone:'America/St_Johns',home:NY,plate:'airbrush'},'2026-09-30T05:29:00Z'],
  // (The charts that keep the most: the ISS's hour with home's circles, a callout's figures and events.)
  ['fuller',{body:'sat:25544',zone:'UTC',home:KTM,plate:'odyssey',readout:'callout',figures:'orbitron',events:[[18,'Dinner'],[4,'Indeed'],[-36,'Run'],[5,'Index'],[17,'Deed'],[8,'Dinar']]},'2026-10-01T04:30:10Z'],
  ['enroute',{body:'sat:25544',zone:'UTC',home:KTM,plate:'airbrush',readout:'callout',figures:'orbitron',tape:'clock',events:[[18,'Dinner'],[4,'Indeed']]},'2026-10-01T04:30:10Z'],['fuller',{body:'sat:43013',zone:'Australia/Eucla',home:MCM,plate:'dotmatrix',readout:'callout'},'2026-09-30T16:02:00Z'],
  // The clocks changing (the hour that comes twice, the hour that never
  // comes, a day of 25 hours and one of 23, Lord Howe's half hour), the
  // year's end and a leap day.
  ['enroute',{body:'sun',zone:'America/New_York',home:NY,readout:'callout',clock24:false},'2026-11-01T05:30:00Z'],['fuller',{body:'sun',zone:'America/New_York',home:NY,readout:'callout'},'2026-11-01T05:30:00Z'],
  ['enroute',{body:'moon',zone:'America/New_York',home:NY,readout:'callout',numerals:'colon'},'2027-03-14T06:30:00Z'],['fuller',{body:'moon',zone:'America/New_York',plate:'console'},'2027-03-14T06:30:00Z'],
  ['fuller',{body:'moon',zone:'Australia/Lord_Howe',plate:'sectional',readout:'callout'},'2026-10-03T14:10:00Z'],['enroute',{body:'sun',zone:'Australia/Lord_Howe',readout:'callout'},'2027-04-03T14:10:00Z'],
  ['enroute',{body:'sun',zone:'UTC',home:MCM,corner:'day'},'2026-12-31T23:59:10Z'],['fuller',{body:'sun',zone:'Pacific/Kiritimati',corner:'day'},'2026-12-31T09:59:10Z'],['enroute',{body:'moon',zone:'Asia/Kolkata',corner:'light'},'2028-02-29T18:20:00Z']
];
const NEW=process.env.WATCH_CASES?NEW_ALL.slice(...process.env.WATCH_CASES.split(",").map(Number)):NEW_ALL;
test('a new watch, sent what it asks for, draws its hour as the core draws the phone\'s input, in the watch\'s heap',{skip:!cc&&'no C compiler',timeout:600000},async()=>{
  for(const [face,c,iso] of NEW){
    const t=Date.parse(iso),label=what(face,c,t);c.t0=t;
    if(process.env.WATCH_VERBOSE)console.error(label);
    const {w,ph}=await fresh(face,c,t);
    assert.equal(w.state.chart,true,`${label}: the screen holds ${JSON.stringify(w.state.note)}`);
    await same(face,c,w,label);
    // The next minutes drawn over it, and the next hour's chart, are the
    // core's too; the watch asks for nothing more.
    await w.cmd('run 60');await same(face,c,w,label+' a minute on');
    await w.cmd('run 3600');await answer(w,ph);await same(face,c,w,label+' an hour on');
    assert.equal(w.requests.length,0,`${label}: asks again`);
    // Back from a notification, and its own state in the corner.
    await w.cmd('focus');await same(face,c,w,label+' after a notification');
    // Closed, it holds only the lettering's glyphs.
    assert.equal(await w.close(),GLYPHS,`${label}: memory held at the close`);
  }
});

test('every satellite draws on each face, each in every form its chart takes',{skip:!cc&&'no C compiler',timeout:900000},async()=>{
  const t=Date.parse(process.env.WATCH_NOW||'2026-09-30T13:07:00Z'),{viewOf}=await import('../src/satellites.js');
  // (The app: Groundtrack, on Enroute or the Plotboard, or Groundtrack
  // Fuller. The Sun and Moon too, on the Plotboard and marked beside.)
  for(const app of ['enroute','fuller'])for(const body of ['sun','moon',...Object.keys(TLES).map(n=>'sat:'+n)]){
    const sat=body.startsWith('sat:'),fast=viewOf(body)==='world';
    const band=[{tape:'fixed',readout:'flag'},{tape:'tape',also:['sun','moon']},{tape:'slide',also:['moon']},{tape:'clock',readout:'callout'},{tape:'route',also:['sun']}].map(f=>({face:'plotboard',...f}));
    const chart=viewOf(body)==='day'?[{span:'day'},{span:'hour',readout:'callout'}]:[{readout:'flag',also:['sun','moon']},{readout:'callout'},{readout:'off',bare:true}];
    const forms=app==='fuller'?(sat?chart:[{also:['sun','moon']}]):fast?band:sat?[...chart.map(f=>({face:'enroute',...f})),...band]:band;
    for(const form of forms){
      const c={body,zone:'America/New_York',home:NY,plate:'console',...form,t0:t},label=what(app,c,t);
      const {w}=await fresh(app,c,t);
      assert.equal(w.state.chart,true,`${label}: the screen holds ${JSON.stringify(w.state.note)}`);
      await same(app,c,w,label);
      await w.close();
    }
  }
});

test('the days go by without a blank: the watch asks before its chart runs out',{skip:!cc&&'no C compiler',timeout:900000},async()=>{
  // QZSS's day in zones whose midnight is on the six hours of its segments
  // (and one whose is not), the ISS's hours, GPS's, the Sun's days across a
  // month's end: every hour for three days and more.
  for(const [face,c,iso,hours] of [
    ['enroute',{body:'sat:42738',zone:'Asia/Dhaka'},'2026-09-29T18:00:30Z',80],['enroute',{body:'sat:42738',zone:'UTC',home:NY},'2026-09-30T00:00:30Z',60],['enroute',{body:'sat:42738',zone:'Asia/Kathmandu'},'2026-09-29T20:10:00Z',60],
    ['enroute',{body:'sat:25544',zone:'Asia/Kathmandu',home:KTM},'2026-09-29T20:10:00Z',52],['enroute',{body:'sat:36585',zone:'America/St_Johns',home:NY},'2026-09-29T20:10:00Z',52],
    ['fuller',{body:'sat:42738',zone:'Asia/Dhaka'},'2026-09-29T18:00:30Z',52],['fuller',{body:'sun',zone:'Pacific/Kiritimati',home:NY},'2026-09-29T20:10:00Z',52],['enroute',{body:'moon',zone:'America/New_York',home:NY},'2026-09-29T20:10:00Z',80]
  ]){
    const t=Date.parse(iso),label=what(face,c,t);c.t0=t;
    const {w,ph}=await fresh(face,c,t);
    assert.equal(w.state.chart,true,`${label}: ${JSON.stringify(w.state.note)}`);
    let asked=0;
    for(let h=0;h<hours;h++){
      // Minute by minute, the phone answering as it is asked: a note on the
      // screen at the minute's end is a blank.
      for(let m=0;m<60;m+=5){
        await w.cmd('run 300');
        if(w.requests.length){asked+=w.requests.length;await answer(w,ph);}
        // (The fixture's elements are good for three days from their epoch:
        // after that the phone has none to give for the fast satellites.)
        assert.equal(w.state.chart,true,`${label}: ${JSON.stringify(w.state.note)} at ${new Date(w.state.t*1000).toISOString()}`);
      }
    }
    assert.ok(asked<=hours/12+2,`${label}: asked ${asked} times in ${hours} hours`);
    await w.close();
  }
});

test('a phone with nothing to give is asked less and less, and its word stands',{skip:!cc&&'no C compiler',timeout:300000},async()=>{
  // The ISS with no elements kept and CelesTrak just tried: NO ELEMENTS.
  const t=Date.parse('2026-09-30T13:07:00Z'),c={body:'sat:25544',zone:'UTC'};
  const w=new Watch('enroute',t,c.zone),stored=storage(c,t);
  for(const k of Object.keys(stored))if(k.startsWith('tle-'))delete stored[k];
  stored['tle-tried-25544']=String(t);
  const ph=phone('enroute',stored);
  const first=await w.block();w.requests.push(...first.requests);
  ph.at(t);ph.listeners.ready({});await ph.quiet();await deliver(w,ph);
  let asked=0,sent=0;
  for(let m=0;m<120;m++){
    // (The phone has tried CelesTrak a moment ago, each time it is asked.)
    if(w.requests.length){asked+=w.requests.length;stored['tle-tried-25544']=String(w.state.t*1000);const before=ph.out.length;await answer(w,ph,1);sent+=before;}
    await w.cmd('run 60');
    if(m>2)assert.match(w.state.note,/^NO ELEMENTS: /,`at minute ${m}`);
  }
  assert.ok(asked>=4&&asked<=12,`asked ${asked} times in two hours`);
  // The Sun's and Moon's days were sent once, not with every request.
  await w.close();
  // The phone out of reach: the watch says so, asks again when it is back.
  const {w:v,ph:p2}=await fresh('enroute',{body:'sun',zone:'UTC'},t);
  const linked=v.state.hash;
  await v.cmd('link 0');assert.notEqual(v.state.hash,linked,'NO LINK in the corner');
  await v.cmd('battery 15');await v.cmd('link 1');const low=v.state.hash;assert.notEqual(low,linked,'BAT 15 in the corner');
  await v.cmd('battery 80');assert.equal(v.state.hash,linked);
  await v.close();void p2;
});

test('settings changed while a chart is being built, and a watch short of memory',{skip:!cc&&'no C compiler',timeout:300000},async()=>{
  const t=Date.parse('2026-09-30T13:07:00Z'),c={body:'sat:25544',zone:'America/New_York',home:NY,plate:'crt'};c.t0=t;
  const {w,ph}=await fresh('enroute',c,t);
  // New settings a few milliseconds into each build, over and over: the
  // last one's chart is drawn, nothing is left behind.
  const plates=['amber','airbrush','console','odyssey','crt'];
  for(let k=0;k<plates.length;k++){
    ph.at(w.state.t*1000);ph.listeners.webviewclosed({response:JSON.stringify({plate:plates[k],tape:k%2?'slide':'fixed'})});await ph.quiet();
    for(const m of ph.out.splice(0)){const key=Object.keys(m)[0];await w.cmd(`msg ${key} ${hex(m[key])}`);}
    await w.cmd('run 0');
  }
  await w.cmd('run 5');await answer(w,ph);
  assert.equal(w.state.chart,true,JSON.stringify(w.state.note));
  await same('enroute',{...c,plate:'crt',tape:'fixed'},w,'after the settings');
  assert.equal(await w.close(),GLYPHS);
  // Heaps too small for the chart: a note, not a crash, at every size; and
  // nothing held but the glyphs once closed.
  for(const face of ['enroute','fuller'])for(let heap=6000;heap<62000;heap+=3500){
    const {w:s}=await fresh(face,c,t,heap);
    assert.ok(s.state.chart||s.state.note,`${face} with ${heap} bytes`);
    assert.ok(await s.close()<=GLYPHS,`${face} with ${heap} bytes holds memory at the close`);
  }
});

// (Last: it puts the whole catalog on October's elements.)
test('the whole catalog draws: every satellite listed, on each face that can show it',{skip:!cc&&'no C compiler',timeout:1800000},async()=>{
  // CelesTrak's elements of 2 October 2026 for every satellite in the
  // catalog: the low orbits, the navigation satellites' twelve hours, the
  // geostationary ones standing still, a Molniya orbit, and the far ones
  // days long. Each is followed from a new watch on the Plotboard, on
  // Enroute where its orbit suits it, and on Groundtrack Fuller, and draws
  // what the core draws from the phone's input.
  const {CATALOG,viewOf,registerElements}=await import('../src/satellites.js');
  TLES=sets('tests/fixtures/celestrak-2026-10-02.tle');
  for(const text of Object.values(TLES))registerElements(text,'fixture');
  assert.equal(Object.keys(TLES).length,CATALOG.length);
  const t=Date.parse('2026-10-02T19:07:00Z'),tapes=['fixed','tape','slide','route','clock'];let n=0;
  for(const entry of CATALOG){
    const body='sat:'+entry.norad,fast=viewOf(body)==='world';
    const cases=[['enroute',{face:'plotboard',tape:tapes[n%5],also:n%2?['sun','moon']:[]}],['fuller',{readout:n%2?'flag':'callout',legend:n%3!==0}]];
    if(!fast)cases.push(['enroute',{face:'enroute',span:n%2?'hour':'day',readout:n%3?'flag':'callout',bare:n%4===0}]);
    n++;
    for(const [app,form] of cases){
      const c={body,zone:n%2?'Asia/Tokyo':'America/New_York',home:n%2?{lat:35.68,lon:139.69}:NY,plate:n%3?'enroute':'console',...form,t0:t},label=`${entry.code} ${what(app,c,t)}`;
      const {w}=await fresh(app,c,t);
      assert.equal(w.state.chart,true,`${label}: the screen holds ${JSON.stringify(w.state.note)}`);
      await same(app,c,w,label);
      await w.close();
    }
  }
});
