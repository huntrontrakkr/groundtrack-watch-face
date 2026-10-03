// The watch's code on the host (native/host): every hour the faces draw,
// built from the phone's input text (src/chart-input.js) by the watch's own
// chart builder, within the watch's memory; a minute drawn over the last
// is the minute drawn whole; night decided in fixed point is night decided
// by the doubles. Skipped where no C compiler is available.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {chartInput} from '../src/chart-input.js';
import {HOMES} from '../src/home.js';
import {registerLiveFixture} from './tle-fixture.mjs';
import {registerNominal} from '../src/nominal.js';
import {nameCode} from '../src/events.js';

let cc=true;try{execFileSync('make',['-s','-C','native/host','harness','harness-exact','build_check','build_check-enroute','build_check-fuller'],{stdio:'pipe'});}catch{cc=false;}
registerLiveFixture();registerNominal();
const ev=(iso,title)=>({epoch:Date.parse(iso),label:nameCode(title)});
const input=(body,iso,plate,zone,more={})=>{const home=zone?HOMES[zone]||null:null;return chartInput({body,start:Date.parse(iso),plate,zone:zone||'UTC',home,...more});};
// The hours: the Sun and Moon on every plate, GPS's slow orbit, the world
// band's satellites (from CelesTrak's elements of 29 September 2026, in
// tests/fixtures), QZSS's day and hour, the callout's styles, the nautical
// zone, the 12-hour clock, events, the tapes and the tape-to-route strips,
// and rolling Fuller sheets of all of them.
const HOURS=[
  ['sun','2026-09-27T08:00:00Z','enroute','UTC',{flag:true}],['sun','2026-06-21T13:00:00Z','sectional','America/New_York',{flag:true}],
  ['sun','2026-12-21T22:30:00Z','hypsometric','Asia/Kolkata',{}],['sun','2027-01-31T23:00:00Z','sunlight','Europe/London',{flag:true}],
  ['moon','2026-09-19T09:00:00Z','crt','America/New_York',{flag:true}],['moon','2026-03-10T05:00:00Z','red','UTC',{}],
  ['moon','2025-12-06T02:30:00Z','console','Asia/Kolkata',{flag:true}],['sun','2026-03-20T11:00:00Z','console',null,{}],
  ['sat:36585','2026-09-27T13:00:00Z','crt','America/New_York',{flag:true}],['sat:36585','2026-09-28T02:00:00Z','sectional','America/New_York',{}],
  ['sat:25544','2026-09-30T13:00:00Z','crt','America/New_York',{flag:true}],['sat:25544','2026-09-30T02:00:00Z','enroute','UTC',{}],
  ['sat:48274','2026-10-01T06:30:00Z','hypsometric','Asia/Kolkata',{flag:true}],['sat:20580','2026-09-30T20:00:00Z','sunlight','Europe/London',{flag:true}],
  ['sat:49260','2026-10-01T09:00:00Z','console','America/New_York',{flag:true}],['sat:43013','2026-09-30T17:00:00Z','red',null,{}],
  ['sat:49260','2026-09-30T16:00:00Z','crt','America/New_York',{flag:true}],['sun','2026-09-27T08:00:00Z','blueprint','America/New_York',{flag:true}],['sat:25544','2026-09-30T13:00:00Z','amber','America/New_York',{tape:'slide'}],
  ['sat:25544','2026-09-30T13:00:00Z','crt','America/New_York',{tape:'clock'}],['sat:43013','2026-09-30T17:00:00Z','enroute','UTC',{tape:'clock',numerals:'even',clock24:false}],['sat:25544','2026-09-30T02:00:00Z','console','UTC',{tape:'clock',numerals:'accent',figures:'b612'}],
  ['moon','2026-09-19T09:00:00Z','dotmatrix','America/New_York',{readout:'callout'}],['sat:25544','2026-09-30T13:00:00Z','dotmatrix','America/New_York',{projection:'fuller',flag:true}],['sat:42738','2026-09-27T05:00:00Z','dotmatrix','America/New_York',{}],
  ['sun','2026-09-27T08:00:00Z','airbrush','America/New_York',{flag:true}],['sat:25544','2026-09-30T13:00:00Z','airbrush','America/New_York',{tape:'tape'}],['sun','2026-09-27T08:00:00Z','airbrush','UTC',{projection:'fuller'}],
  ['sun','2026-09-27T08:00:00Z','odyssey','America/New_York',{flag:true}],['moon','2026-09-19T09:00:00Z','odyssey','America/New_York',{readout:'callout'}],['sat:25544','2026-09-30T13:00:00Z','odyssey','America/New_York',{projection:'fuller',flag:true}],
  ['sat:42738','2026-09-27T05:00:00Z','crt','America/New_York',{flag:true}],['sat:42738','2026-09-27T14:00:00Z','sunlight','UTC',{}],
  ['sat:42738','2026-09-26T20:30:00Z','hypsometric','Asia/Kolkata',{readout:'callout',numerals:'mono'}],['sat:42738','2026-09-27T05:00:00Z','sectional','America/New_York',{span:'hour',readout:'callout'}],
  ['sun','2026-09-27T08:00:00Z','enroute','America/New_York',{readout:'callout',numerals:'colon'}],['moon','2026-09-19T09:00:00Z','crt','America/New_York',{readout:'callout',numerals:'mono',margin:'body'}],
  ['sun','2026-06-21T13:00:00Z','sectional','America/New_York',{readout:'callout',numerals:'accent',clock24:false}],['sun','2026-12-21T22:00:00Z','sunlight','UTC',{readout:'callout',numerals:'plain',margin:'body'}],
  ['sun','2026-09-27T08:00:00Z','enroute','America/New_York',{flag:true,events:[ev('2026-09-27T08:45:00Z','Run'),ev('2026-09-27T08:47:00Z','Standup'),ev('2026-09-27T09:20:00Z','Dinner')]}],
  ['moon','2026-09-19T09:00:00Z','console','UTC',{readout:'callout',events:[ev('2026-09-19T09:50:00Z','Run'),ev('2026-09-19T09:10:00Z','Lecture')]}],
  ['sat:25544','2026-09-30T13:00:00Z','crt','America/New_York',{flag:true,events:[ev('2026-09-30T13:12:00Z','Launch'),ev('2026-09-30T13:40:00Z','Call')]}],
  ['sat:25544','2026-09-30T13:00:00Z','crt','America/New_York',{tape:'tape'}],['sat:43013','2026-09-30T17:00:00Z','console','UTC',{tape:'tape',clock24:false}],
  ['sat:25544','2026-09-30T13:00:00Z','sectional','America/New_York',{tape:'tape',events:[ev('2026-09-30T13:12:00Z','Launch'),ev('2026-09-30T13:05:00Z','Tea')]}],
  ['sat:25544','2026-09-30T13:00:00Z','crt','America/New_York',{tape:'slide'}],['sat:49260','2026-10-01T09:00:00Z','console','America/New_York',{tape:'slide'}],
  ['sat:25544','2026-09-30T13:00:00Z','crt','America/New_York',{transfer:'vernier'}],['sat:43013','2026-09-30T17:00:00Z','enroute','UTC',{transfer:'comb'}],['sat:49260','2026-10-01T09:00:00Z','red','America/New_York',{transfer:'chevrons'}],
  ['sat:25544','2026-09-30T13:00:00Z','crt','America/New_York',{projection:'fuller',flag:true}],['sat:48274','2026-10-01T06:30:00Z','sectional','Asia/Kolkata',{projection:'fuller',flag:true}],
  ['sat:20580','2026-09-30T20:00:00Z','hypsometric','Europe/London',{projection:'fuller',readout:'callout'}],['sat:49260','2026-10-01T09:00:00Z','red','America/New_York',{projection:'fuller',flag:true}],
  ['sat:43013','2026-09-30T17:00:00Z','sunlight','UTC',{projection:'fuller',events:[ev('2026-09-30T17:20:00Z','Launch')]}],['sat:36585','2026-09-27T13:00:00Z','hypsometric','America/New_York',{projection:'fuller',flag:true}],
  ['sun','2026-09-27T08:00:00Z','enroute','UTC',{projection:'fuller',flag:true}],['moon','2026-09-19T09:00:00Z','console','America/New_York',{projection:'fuller',readout:'callout',numerals:'mono'}],
  ['sun','2026-12-21T22:30:00Z','crt','Asia/Kolkata',{projection:'fuller',clock24:false}],['sat:42738','2026-09-27T05:00:00Z','crt','America/New_York',{projection:'fuller',readout:'callout'}],
  ['sat:42738','2026-09-27T05:00:00Z','sectional','America/New_York',{projection:'fuller',span:'hour'}]
];
const label=([body,iso,plate,zone,more])=>`${body} ${iso} ${plate} ${JSON.stringify(more)}`;
// The new plates, and the fixed ticker on each kind of chart, including a
// map whose columns wrap under it and a day sheet with a moving callout.
for(const plate of ['trackingboard','survey','operations'])HOURS.push(
  ['sun','2026-09-27T08:00:00Z',plate,'America/New_York',{ticker:true}],
  ['moon','2026-09-19T09:00:00Z',plate,'America/New_York',{ticker:true,readout:'callout'}],
  ['sat:42738','2026-09-27T05:00:00Z',plate,'America/New_York',{ticker:true}],
  ['sat:25544','2026-09-30T13:00:00Z',plate,'America/New_York',{ticker:true,tape:'slide',corner:'light',events:[ev('2026-09-30T13:12:00Z','Launch')]}],
  ['sat:25544','2026-09-30T13:00:00Z',plate,'Asia/Kathmandu',{ticker:true,tape:'clock'}],
  ['sat:25544','2026-09-30T13:00:00Z',plate,'America/New_York',{ticker:true,projection:'fuller',flag:true,corner:'light'}],
  ['sun','2026-09-27T08:00:00Z',plate,'America/New_York',{ticker:true,projection:'fuller'}]
);

test('every hour builds within the watch\'s memory',{skip:!cc&&'no C compiler'},()=>{
  for(const h of HOURS){
    const r=spawnSync('native/host/build_check',[],{input:input(...h)});
    assert.equal(r.status,0,`${label(h)}: ${r.stdout}${r.stderr}`);
    const out=JSON.parse(r.stdout.toString());
    // The build's memory at its peak, counted as the watch's heap would
    // (with this machine's larger pointers): the watch has about 67 KB.
    // (Both faces' code together, which holds a little more than either
    // app: the apps' own builds are held to the watch's heap below.)
    assert.ok(out.peak<=58000,`${label(h)}: the build peaks at ${out.peak} bytes`);
  }
});

// Each face alone, as its watch app is built, in a heap 5 KB short of the
// watch's and modelled as the watch's is (native/host/heap_model.h: a block
// takes the first free stretch that holds it), so a build that leaves the
// heap in pieces and then wants one large block fails here as it does on
// the watch, where counting bytes alone would pass it. The watch's heap is
// what its 128 KB leaves after the app itself and the system's share. What
// the finished chart keeps leaves room to draw a minute whole (about 11 KB,
// and 12 KB on a Fuller sheet; drawn over the last, 3.6 KB more).
const HEAPS={enroute:62250,fuller:61700},KEPT={enroute:47000,fuller:47000};
test('each face builds its hours in less than the watch\'s heap, modelled as the watch\'s is',{skip:!cc&&'no C compiler'},()=>{
  const day=Date.parse('2026-09-30T00:00:00Z'),at=h=>new Date(day+h*3600e3).toISOString();
  const cases={
    enroute:[['sun',{}],['moon',{}],['sat:36585',{}],['sat:42738',{}],['sat:42738',{span:'hour'}],['sat:25544',{}],['sat:25544',{tape:'slide'}],['sat:43013',{tape:'tape'}],['sat:25544',{tape:'clock'}],['moon',{plate:'airbrush',readout:'callout'}],['sat:36585',{plate:'airbrush'}]],
    fuller:[['sat:25544',{projection:'fuller'}],['sat:43013',{projection:'fuller'}],['sun',{projection:'fuller'}],['moon',{projection:'fuller'}],['sat:36585',{projection:'fuller'}],['sat:42738',{projection:'fuller'}],['sat:25544',{projection:'fuller',plate:'airbrush',readout:'callout'}],['sat:36585',{projection:'fuller',plate:'airbrush'}]]
  };
  for(const [face,list] of Object.entries(cases))for(const [body,more] of list)for(const hour of [0,7,14,21]){
    const r=spawnSync(`native/host/build_check-${face}`,[],{input:input(body,at(hour),more.plate||'console','America/New_York',{flag:!more.readout,...more}),env:{...process.env,HEAP_LIMIT:String(HEAPS[face]-5000)}});
    const what=`${face} ${body} ${JSON.stringify(more)} hour ${hour}`;
    assert.equal(r.status,0,`${what}: no chart in a heap of ${HEAPS[face]-5000} bytes: ${r.stdout}${r.stderr}`);
    const out=JSON.parse(r.stdout.toString());
    assert.ok(out.kept<=KEPT[face],`${what}: the hour keeps ${out.kept} bytes (budget ${KEPT[face]})`);
  }
});

// The same over hours of every body in odd zones at awkward dates with
// every setting drawn at random, under the address and undefined-behaviour
// sanitizers (tools/sweep.mjs); and builds starved of memory at every size,
// which must fail holding nothing.
test('a sweep of random hours and settings finds no fault, and starved builds fail cleanly',{skip:!cc&&'no C compiler',timeout:600000},()=>{
  // (A part of what `node tools/sweep.mjs 2000` and `--starve 60` cover.)
  for(const args of [['60','1'],['--starve','4','1']]){
    const r=spawnSync(process.execPath,['tools/sweep.mjs',...args],{maxBuffer:1<<24,env:{...process.env,SWEEP_STEP:'1499'}});
    assert.equal(r.status,0,`sweep ${args.join(' ')}: ${r.stdout.toString().slice(-3000)}`);
  }
});

test('a minute drawn over the last draws only what changed, and the same pixels',{skip:!cc&&'no C compiler'},()=>{
  for(const h of HOURS){
    const r=spawnSync('native/host/harness',['-u'],{input:input(...h)});
    assert.equal(r.status,0,`${label(h)}: ${r.stderr}`);
    const out=JSON.parse(r.stdout.toString());
    assert.equal(out.differ,0,`${label(h)}: ${out.differ} pixels differ`);
    assert.ok(out.drawn<200*228,`${label(h)}: every pixel drawn again`);
  }
});

test('night decided by fixed point first is night decided by the double sums, every minute',{skip:!cc&&'no C compiler'},()=>{
  // Every plate's kind of night: zones, the dot screen, scan lines, the
  // drawn terminator; the terminator across the world band and a Fuller sheet.
  for(const h of [
    ['moon','2026-09-19T09:00:00Z','crt','America/New_York',{flag:true}],['moon','2026-09-19T09:00:00Z','sunlight','America/New_York',{flag:true}],
    ['moon','2026-09-19T09:00:00Z','sectional','America/New_York',{flag:true}],['moon','2026-09-19T09:00:00Z','console','America/New_York',{flag:true}],
    ['sun','2026-06-21T13:00:00Z','red','America/New_York',{}],['sat:25544','2026-09-30T02:00:00Z','enroute','UTC',{}],
    ['sat:43013','2026-09-30T17:00:00Z','crt','UTC',{}],['sat:49260','2026-10-01T09:00:00Z','sunlight','America/New_York',{flag:true}],
    ['sat:25544','2026-09-30T13:00:00Z','red','America/New_York',{projection:'fuller'}],['sun','2026-09-27T08:00:00Z','crt','UTC',{projection:'fuller'}],
    ['moon','2026-09-19T09:00:00Z','blueprint','America/New_York',{flag:true}],['sat:25544','2026-09-30T13:00:00Z','amber','America/New_York',{projection:'fuller'}],
    ['moon','2026-09-19T09:00:00Z','dotmatrix','America/New_York',{flag:true}],['sat:25544','2026-09-30T02:00:00Z','dotmatrix','UTC',{}],['moon','2026-09-19T09:00:00Z','airbrush','America/New_York',{flag:true}],['moon','2026-09-19T09:00:00Z','odyssey','America/New_York',{flag:true}]
  ]){
    const text=input(...h),a=spawnSync('native/host/harness',['-a'],{input:text,maxBuffer:1<<24}),b=spawnSync('native/host/harness-exact',['-a'],{input:text,maxBuffer:1<<24});
    assert.equal(a.status,0,`${label(h)}: ${a.stderr}`);
    assert.ok(a.stdout.equals(b.stdout),`${label(h)}: the fast night differs`);
  }
});

test('the watch app type-checks against the SDK signatures',{skip:!cc&&'no C compiler'},()=>{
  // A stand-in pebble.h (native/host/stub) declares what main.c uses; the
  // real check is the Pebble SDK build. Each face's build, and the host's.
  for(const face of [[],['-DFACE_ENROUTE'],['-DFACE_FULLER']])for(const f of ['main.c','watch_data.c'])execFileSync('cc',['-std=gnu11','-Wall','-Wextra','-Werror','-Wno-unused-parameter','-Inative/host/stub','-Inative/src/c','-DENR_FLOAT',...face,'-fsyntax-only','native/src/c/'+f],{stdio:'pipe'});
});
