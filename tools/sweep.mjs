// A randomised sweep of the watch's core under the address and undefined-
// behaviour sanitizers (native/host san-* targets): hours of every body, in
// odd time zones and at awkward dates, with every setting drawn at random.
// Each is built and drawn by the app's own build (Groundtrack or Groundtrack
// Fuller); each minute drawn over the last must equal the minute drawn
// whole; the build must fit a heap 4 KB short of the watch's (modelled as
// the watch's is, first fit: native/host/heap_model.h); and a build stopped
// for want of memory at any size must fail cleanly, holding nothing.
//
//   node tools/sweep.mjs [cases=300] [seed=1]        SWEEP_JOBS=n in parallel
//   node tools/sweep.mjs --starve [cases=12] [seed]  the out-of-memory sweep
//   node tools/sweep.mjs --heap [cases=300] [seed]   the least heap each needs
// Exits 1 if any case fails, naming each (its options print as JSON, which
// `node tools/sweep.mjs --case '<json>'` runs again).
import {execFileSync,spawn} from 'node:child_process';
import os from 'node:os';
import {chartInput} from '../src/chart-input.js';
import {clockParts} from '../src/render.js';
import {PLATES,FIGURE_SETS} from '../src/plates.js';
import {registerLiveFixture} from '../tests/tle-fixture.mjs';
import {registerNominal} from '../src/nominal.js';
import {nameCode} from '../src/events.js';

registerLiveFixture();registerNominal();
const args=process.argv.slice(2),starve=args[0]==='--starve',least=args[0]==='--heap',single=args[0]==='--case'?JSON.parse(args[1]):null;
if(starve||least||single)args.shift();
const count=Number(args[0])||(starve?12:300),seed=Number(args[1])||1;
// mulberry32
let state=seed>>>0;
const rand=()=>{state=state+0x6D2B79F5|0;let t=Math.imul(state^state>>>15,1|state);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
const pick=list=>list[Math.floor(rand()*list.length)],chance=p=>rand()<p;

const SATS=['sat:25544','sat:43013','sat:49260','sat:48274','sat:20580','sat:36585','sat:42738'];
const ZONES=['UTC','America/New_York','Europe/London','Asia/Kolkata','Asia/Kathmandu','Pacific/Kiritimati','Pacific/Pago_Pago','Australia/Lord_Howe','Pacific/Chatham','America/St_Johns','Pacific/Auckland','America/Los_Angeles','Asia/Tokyo','Africa/Casablanca'];
// Dates that have bitten: the year's ends, a leap day, the clocks changing
// in New York, London, Lord Howe and Auckland, and the solstices.
const DATES=['2026-12-31T22:00Z','2027-01-01T00:00Z','2028-02-29T12:00Z','2028-12-31T23:00Z','2026-11-01T05:00Z','2026-11-01T06:00Z','2027-03-14T06:00Z','2027-03-14T07:00Z','2026-10-25T00:00Z','2026-10-25T01:00Z','2027-03-28T01:00Z',
  '2026-10-03T15:00Z','2027-04-03T15:00Z','2026-09-26T13:00Z','2027-04-03T13:00Z','2026-06-21T00:00Z','2026-12-21T12:00Z','2027-03-20T20:00Z','2038-01-19T03:00Z','2037-06-01T00:00Z'].map(d=>Date.parse(d.replace('Z',':00Z')));
const TITLES=['Run','Standup','Dinner','Launch','A very long event title indeed','x','Ünïcödé','12345','  ','Tea & cake','EVA','AOS'];
const HOMES=[[90,0],[-90,0],[89.99,179.99],[-89.99,-180],[0,0],[0,180],[0,-180],[78.22,15.65],[-77.85,166.67],[66.56,25],[40.71,-74.01],[-33.87,151.21],[51.48,0],[1.35,103.82]];

function randomCase(){
  const fuller=chance(.35),sat=chance(.55),body=sat?pick(SATS):pick(['sun','moon']),zone=pick(ZONES);
  // Satellites inside the fixture's elements' three days; the Sun and Moon
  // anywhere from 2024 to 2037, or at one of the awkward dates.
  let t=sat?Date.parse('2026-09-29T20:00:00Z')+Math.floor(rand()*60)*3600e3:chance(.4)?pick(DATES)+Math.floor(rand()*5-2)*3600e3:Date.parse('2024-01-01T00:00:00Z')+Math.floor(rand()*13*365.25*24)*3600e3;
  const c=clockParts(t,zone);t-=Number(c.m)*60e3;t-=t%60e3;
  const home=chance(.75)?(([lat,lon])=>({code:'HOM',name:'Home',lat,lon}))(chance(.5)?pick(HOMES):[Math.round((rand()*180-90)*100)/100,Math.round((rand()*360-180)*100)/100]):null;
  const events=[];
  if(chance(.4))for(let n=Math.floor(rand()*20);n>0;n--)events.push({epoch:t+Math.floor(rand()*150-45)*60e3,label:nameCode(pick(TITLES))});
  return {body,start:t,plate:pick(Object.keys(PLATES)),zone,home,projection:fuller?'fuller':'chart',readout:pick(['flag','callout',false]),numerals:pick(['colon','plain','even','mono','accent']),margin:pick(['utc','body']),
    span:pick(['day','hour']),tape:pick(['fixed','tape','slide','clock']),transfer:pick(['off','vernier','comb','chevrons']),figures:pick(FIGURE_SETS)[0],corner:pick(['day','point','light']),clock24:chance(.5),events};
}

const face=c=>c.projection==='fuller'?'fuller':'enroute';
// The watch's heap: what 128 KB leaves after each app and the system's share.
const HEAPS={enroute:62100,fuller:62700};
// What a finished chart may keep: the heap less what drawing a minute
// whole takes (about 11 KB, and 12 KB on a Fuller sheet; drawn over the
// last, 3.6 KB more) and some to spare.
const KEPT={enroute:47000,fuller:47000};
const targets=['san-harness-enroute','san-harness-fuller','san-build_check-enroute','san-build_check-fuller','build_check-enroute','build_check-fuller'];
execFileSync('make',['-s','-C','native/host',...targets],{stdio:['ignore','ignore','ignore']});

const run=(bin,argv,input,env={})=>new Promise(done=>{
  const p=spawn(`native/host/${bin}`,argv,{env:{...process.env,ASAN_OPTIONS:'detect_leaks=0',UBSAN_OPTIONS:'print_stacktrace=1',...env}});
  let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>{if(err.length<6000)err+=d;});
  p.on('close',status=>done({status,out,err}));p.stdin.on('error',()=>{});p.stdin.end(input);
});
const failures=[],runs={};let worst={enroute:{peak:0,kept:0},fuller:{peak:0,kept:0}};
const fail=(c,what)=>{failures.push([c,what]);console.log(`FAIL ${what}\n  --case '${JSON.stringify(c)}'`);};

async function check(c){
  let text;try{text=chartInput(c);}catch(e){fail(c,`chartInput threw: ${e.message}`);return;}
  const f=face(c),u=await run(`san-harness-${f}`,['-u'],text);
  if(u.status!==0){fail(c,`harness -u exit ${u.status}: ${u.err.slice(0,1500)}`);return;}
  if(u.err.trim())fail(c,`harness -u wrote: ${u.err.slice(0,1500)}`);
  const o=JSON.parse(u.out);if(o.differ)fail(c,`${o.differ} pixels differ between a minute drawn over the last and drawn whole`);
  // Built in a heap 4 KB short of the watch's, modelled as the watch's is.
  const b=await run(`build_check-${f}`,[],text,{HEAP_LIMIT:String(HEAPS[f]-4000)});
  if(b.status!==0){fail(c,`no chart in a heap of ${HEAPS[f]-4000} bytes: ${b.out}${b.err.slice(0,400)}`);return;}
  const m=JSON.parse(b.out),key=`${f} ${c.plate}`;if(!(runs[key]>=m.runs))runs[key]=m.runs;
  for(const k of ['peak','kept'])if(m[k]>worst[f][k])worst[f][k]=m[k];
  if(m.kept>KEPT[f])fail(c,`keeps ${m.kept} bytes: more than ${KEPT[f]} leaves too little to draw a minute`);
}
// A build starved at every size up to its peak: each must either build or
// fail holding nothing, with no sanitizer report.
async function starved(c){
  const text=chartInput(c),f=face(c),whole=JSON.parse((await run(`build_check-${f}`,[],text)).out);
  for(let limit=1500;limit<whole.peak+1500;limit+=Number(process.env.SWEEP_STEP)||Math.max(211,Math.floor(whole.peak/90))){
    const r=await run(`san-build_check-${f}`,[],text,{HEAP_LIMIT:String(limit)});
    if(r.err.trim()){fail(c,`starved at ${limit}: ${r.err.slice(0,1500)}`);return;}
    let o;try{o=JSON.parse(r.out);}catch{fail(c,`starved at ${limit}: output ${r.out}`);return;}
    if(!o.built&&o.held){fail(c,`starved at ${limit}: failed (${o.why}) still holding ${o.held} bytes`);return;}
  }
}

// SWEEP_PIN='{"plate":"airbrush"}' holds options fixed.
const pin=process.env.SWEEP_PIN?JSON.parse(process.env.SWEEP_PIN):{};
// The least heap (modelled as the watch's: first fit, so its being left in
// pieces counts) in which a case builds, to 256 bytes; the worst are named.
const needs=[];
async function leastHeap(c){
  const text=chartInput(c),f=face(c);let lo=20000,hi=90000;
  while(hi-lo>256){const mid=(lo+hi)>>1,r=await run(`build_check-${f}`,[],text,{HEAP_LIMIT:String(mid)});if(r.status===0)hi=mid;else lo=mid;}
  needs.push([hi,f,c]);
  if(hi>HEAPS[f]-4000)fail(c,`needs a heap of ${hi} bytes: the watch has about ${HEAPS[f]}`);
}
const cases=single?[single]:Array.from({length:count},()=>({...randomCase(),...pin})),jobs=Number(process.env.SWEEP_JOBS)||Math.max(1,os.cpus().length-2);
let next=0;
await Promise.all(Array.from({length:jobs},async()=>{while(next<cases.length){const c=cases[next++];await (starve?starved(c):least?leastHeap(c):check(c));if(next%50===0)console.error(`${next}/${cases.length}`);}}));
if(least){needs.sort((a,b)=>b[0]-a[0]);for(const [n,f,c] of needs.slice(0,6))console.log(n,f,c.body,c.plate,c.readout,c.tape,c.span,new Date(c.start).toISOString(),c.zone);
  for(const f of ['enroute','fuller']){const v=needs.filter(n=>n[1]===f).map(n=>n[0]);console.log(f,'least heap: worst',Math.max(...v),'median',v.sort((a,b)=>a-b)[v.length>>1]);}}
console.log(JSON.stringify({cases:cases.length,seed,failures:failures.length,...(starve||least?{}:{worst,runs})}));
process.exit(failures.length?1:0);
