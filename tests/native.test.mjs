// The native core against the browser renderer: an exported hour, drawn by
// the C core at several minutes, must match the browser's frames. Skipped
// where no C compiler is available.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

let cc=true;try{execFileSync('make',['-s','-C','native/host','harness'],{stdio:'pipe'});}catch{cc=false;}
// Live satellites' element sets, for the world band.
const env={...process.env,TLE_FILE:'tests/fixtures/celestrak-2026-09-29.tle'};
const run=(dir,name,args,minutes,more={})=>{
  execFileSync(process.execPath,['tools/export-scene.mjs',dir,name,...args,...minutes.map(String)],{stdio:'pipe',env:{...env,...more}});
  return execFileSync('native/host/harness',[join(dir,`${name}.scene`),join(dir,name),...minutes.map(String)]).toString().trim().split('\n').map(l=>JSON.parse(l));
};

test('the native core draws the hour exactly as the browser does',{skip:!cc&&'no C compiler'},()=>{
  const dir=mkdtempSync(join(tmpdir(),'groundtrack-native-'));
  try{
    // Paper and zoned plates, night, the day/night lines, height tints, the
    // minute flag, the Moon's phase and a satellite's pass line.
    for(const [name,args,minutes,more] of [
      ['sun-enroute',['sun','2026-09-27T08:00:00Z','enroute','flag'],[0,24,59]],
      ['moon-crt',['moon','2026-09-19T09:00:00Z','crt','flag'],[0,24,47]],
      ['moon-red',['moon','2026-09-19T09:00:00Z','red','noflag'],[12,59]],
      ['moon-sunlight',['moon','2026-09-19T09:00:00Z','sunlight','flag'],[5,59]],
      ['moon-hypsometric',['moon','2026-09-19T09:00:00Z','hypsometric','noflag'],[30]],
      ['gps-crt',['sat:36585','2026-09-27T13:00:00Z','crt','flag'],[3,24,58]],
      // The world band: the tape's index and minutes, the height, home's
      // acquisition circle, the pass line; a station and polar orbits.
      ['iss-crt',['sat:25544','2026-09-30T13:00:00Z','crt','flag'],[0,17,33,59]],
      ['iss-enroute',['sat:25544','2026-09-30T02:00:00Z','enroute','noflag'],[0,21,44]],
      ['hst-sunlight',['sat:20580','2026-09-30T20:00:00Z','sunlight','flag'],[8,50]],
      ['ls9-hypsometric',['sat:49260','2026-10-01T09:00:00Z','hypsometric','flag'],[0,30,59]],
      ['n20-red',['sat:43013','2026-09-30T17:00:00Z','red','noflag'],[10,40]],
      // QZSS's day: the time callout, big and small, its leader.
      ['qzs-crt',['sat:42738','2026-09-27T05:00:00Z','crt','flag'],[0,24,59]],
      ['qzs-sunlight',['sat:42738','2026-09-27T14:00:00Z','sunlight','noflag'],[7,33]],
      ['qzs-enroute',['sat:42738','2026-09-27T19:00:00Z','enroute','noflag'],[0,45]],
      // The time callout on the hour chart, in each style; the nautical
      // zone; the 12-hour clock; QZSS's day in other styles and its hour.
      ['sun-callout-colon',['sun','2026-09-27T08:00:00Z','enroute','callout'],[0,24,59],{NUMERALS:'colon'}],
      ['moon-callout-even',['moon','2026-09-19T09:00:00Z','crt','callout'],[5,47],{NUMERALS:'even',ZONE:'body'}],
      ['sun-callout-mono',['sun','2026-06-21T13:00:00Z','sectional','callout'],[12,38],{NUMERALS:'mono'}],
      ['gps-callout-accent',['sat:36585','2026-09-27T13:00:00Z','red','callout'],[3,30],{NUMERALS:'accent',CLOCK24:'0'}],
      ['sun-callout-plain',['sun','2026-12-21T22:00:00Z','sunlight','callout'],[1,59],{NUMERALS:'plain',ZONE:'body'}],
      ['qzs-mono',['sat:42738','2026-09-27T05:00:00Z','hypsometric','noflag'],[10,50],{NUMERALS:'mono',CLOCK24:'0'}],
      ['qzs-accent',['sat:42738','2026-09-27T14:00:00Z','crt','noflag'],[20],{NUMERALS:'accent'}],
      ['qzs-hour',['sat:42738','2026-09-27T05:00:00Z','sectional','callout'],[0,30],{SPAN:'hour',NUMERALS:'colon'}],
      // The world band's sliding tape, early, mid and late in the hour.
      ['iss-tape',['sat:25544','2026-09-30T13:00:00Z','crt','flag'],[0,1,17,33,58,59],{TAPE:'tape'}],
      ['n20-tape',['sat:43013','2026-09-30T17:00:00Z','sunlight','noflag'],[5,44],{TAPE:'tape',CLOCK24:'0'}],
      // Events: their names giving way, minute by minute, to the flag, the
      // callout, the tape's minutes and figures, and to each other.
      ['sun-events',['sun','2026-09-27T08:00:00Z','enroute','flag'],[0,20,40,44,45,47,50,59],{EVENTS:JSON.stringify([{epoch:'2026-09-27T08:45:00Z',title:'Run'},{epoch:'2026-09-27T08:47:00Z',title:'Standup'},{epoch:'2026-09-27T08:20:00Z',title:'Call'}])}],
      ['moon-events',['moon','2026-09-19T09:00:00Z','console','callout'],[0,10,30,50,59],{NUMERALS:'mono',EVENTS:JSON.stringify([{epoch:'2026-09-19T09:50:00Z',title:'Run'},{epoch:'2026-09-19T09:10:00Z',title:'Lecture'},{epoch:'2026-09-19T09:30:00Z',title:'Review'}])}],
      ['iss-events',['sat:25544','2026-09-30T13:00:00Z','crt','flag'],[0,12,40,55],{EVENTS:JSON.stringify([{epoch:'2026-09-30T13:12:00Z',title:'Launch'},{epoch:'2026-09-30T13:40:00Z',title:'Call'}])}],
      ['iss-tape-events',['sat:25544','2026-09-30T13:00:00Z','sectional','noflag'],[0,30,59],{TAPE:'tape',EVENTS:JSON.stringify([{epoch:'2026-09-30T13:12:00Z',title:'Launch'},{epoch:'2026-09-30T13:05:00Z',title:'Tea'}])}],
      ['qzs-events',['sat:42738','2026-09-27T05:00:00Z','crt','noflag'],[0,30],{EVENTS:JSON.stringify([{epoch:'2026-09-27T09:00:00Z',title:'Breakfast'},{epoch:'2026-09-27T05:40:00Z',title:'Walk'}])}],
      // How the fixed tape's minutes fall on the route, in each style.
      ['iss-vernier',['sat:25544','2026-09-30T13:00:00Z','crt','flag'],[0,33],{TRANSFER:'vernier'}],
      ['n20-comb',['sat:43013','2026-09-30T17:00:00Z','enroute','noflag'],[10,40],{TRANSFER:'comb'}],
      ['ls9-chevrons',['sat:49260','2026-10-01T09:00:00Z','red','flag'],[0,59],{TRANSFER:'chevrons'}],
      ['iss-chevrons',['sat:25544','2026-09-30T02:00:00Z','console','noflag'],[21],{TRANSFER:'chevrons'}],
      // Rolling Fuller sheets, lit from their faces' grids: a satellite's
      // hour, the Sun's and QZSS's days, GPS zoomed in, one-ink plates'
      // heavier route, home's circle each minute.
      ['iss-fuller',['sat:25544','2026-09-30T13:00:00Z','crt','flag'],[0,24,59],{PROJECTION:'fuller'}],
      ['n20-fuller',['sat:43013','2026-09-30T17:00:00Z','sectional','callout'],[0,17,44],{PROJECTION:'fuller'}],
      ['ls9-fuller',['sat:49260','2026-10-01T09:00:00Z','red','noflag'],[17,59],{PROJECTION:'fuller'}],
      ['sun-fuller',['sun','2026-09-27T08:00:00Z','enroute','flag'],[0,24,59],{PROJECTION:'fuller'}],
      ['moon-fuller',['moon','2026-09-19T09:00:00Z','console','callout'],[10,50],{PROJECTION:'fuller'}],
      ['gps-fuller',['sat:36585','2026-09-27T13:00:00Z','hypsometric','flag'],[3,40],{PROJECTION:'fuller'}],
      ['qzs-fuller',['sat:42738','2026-09-27T05:00:00Z','sunlight','callout'],[0,33],{PROJECTION:'fuller'}],
      // The world sliding too: a scene for each minute.
      ['iss-slide-23',['sat:25544','2026-09-30T13:00:00Z','crt','flag'],[23],{TAPE:'slide'}],
      ['ls9-slide-47',['sat:49260','2026-10-01T09:00:00Z','hypsometric','flag'],[47],{TAPE:'slide'}],
      ['ls9-slide-0',['sat:49260','2026-10-01T09:00:00Z','console','noflag'],[0],{TAPE:'slide'}]
    ]){
      for(const f of run(dir,name,args,minutes,more))assert.equal(f.differ,0,`${name} minute ${f.minute}: first difference at ${f.first}`);
    }
    // Console's ink changes with night, and the browser inks some symbols
    // by one point's night: the watch does too.
    for(const f of run(dir,'moon-console',['moon','2026-09-19T09:00:00Z','console','noflag'],[0,12,24,36,47,59]))assert.equal(f.differ,0,`moon-console minute ${f.minute}: first difference at ${f.first}`);
    for(const f of run(dir,'iss-console',['sat:25544','2026-09-30T02:00:00Z','console','flag'],[0,20,40]))assert.equal(f.differ,0,`iss-console minute ${f.minute}: first difference at ${f.first}`);
    for(const f of run(dir,'sun-console',['sun','2026-09-27T20:00:00Z','console','callout'],[0,30,59]))assert.equal(f.differ,0,`sun-console minute ${f.minute}: first difference at ${f.first}`);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a minute drawn over the last draws only what changed, and the same pixels',{skip:!cc&&'no C compiler'},()=>{
  const dir=mkdtempSync(join(tmpdir(),'groundtrack-update-'));
  try{
    // Every plate, the Sun at noon and the Moon at nightfall, a satellite:
    // each minute over the one before (and over a jump of five) must be the
    // minute drawn whole.
    for(const [name,args,more={}] of [
      ['sun-enroute',['sun','2026-09-27T08:00:00Z','enroute','flag']],['sun-sectional',['sun','2026-06-21T13:00:00Z','sectional','flag']],
      ['moon-console',['moon','2026-09-19T09:00:00Z','console','flag']],['moon-hypsometric',['moon','2026-09-19T09:00:00Z','hypsometric','noflag']],
      ['moon-red',['moon','2026-09-19T09:00:00Z','red','noflag']],['moon-crt',['moon','2026-09-19T09:00:00Z','crt','flag']],
      ['moon-sunlight',['moon','2026-09-19T09:00:00Z','sunlight','flag']],['gps-crt',['sat:36585','2026-09-27T13:00:00Z','crt','flag']],
      ['iss-crt',['sat:25544','2026-09-30T13:00:00Z','crt','flag']],['ls9-console',['sat:49260','2026-10-01T09:00:00Z','console','flag']],
      ['qzs-hypsometric',['sat:42738','2026-09-27T05:00:00Z','hypsometric','noflag']],
      ['sun-callout',['sun','2026-09-27T08:00:00Z','enroute','callout'],{NUMERALS:'accent'}],
      // Console, the night crossing this hour's and the next hour's
      // stations.
      ['sun-console',['sun','2026-09-27T20:00:00Z','console','flag']],['iss-console',['sat:25544','2026-09-30T02:00:00Z','console','flag']],
      ['iss-tape',['sat:25544','2026-09-30T13:00:00Z','crt','flag'],{TAPE:'tape'}],['iss-fuller',['sat:25544','2026-09-30T13:00:00Z','sunlight','flag'],{PROJECTION:'fuller'}],['sun-fuller',['sun','2026-09-27T08:00:00Z','console','callout'],{PROJECTION:'fuller'}],['n20-comb',['sat:43013','2026-09-30T17:00:00Z','sunlight','flag'],{TRANSFER:'comb'}],
      ['sun-events',['sun','2026-09-27T08:00:00Z','enroute','flag'],{EVENTS:JSON.stringify([{epoch:'2026-09-27T08:45:00Z',title:'Run'},{epoch:'2026-09-27T08:47:00Z',title:'Standup'}])}],
      ['moon-events',['moon','2026-09-19T09:00:00Z','console','callout'],{EVENTS:JSON.stringify([{epoch:'2026-09-19T09:50:00Z',title:'Run'},{epoch:'2026-09-19T09:10:00Z',title:'Lecture'}])}],['moon-callout',['moon','2026-09-19T09:00:00Z','crt','callout'],{NUMERALS:'mono'}]
    ]){
      execFileSync(process.execPath,['tools/export-scene.mjs',dir,name,...args,'0'],{stdio:'pipe',env:{...env,...more}});
      const r=JSON.parse(execFileSync('native/host/harness',[join(dir,`${name}.scene`),join(dir,name),'-u']).toString());
      assert.equal(r.differ,0,`${name}: ${r.differ} pixels differ`);
      assert.ok(r.drawn<200*228,`${name}: every pixel drawn again`);
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('night decided by fixed point first is night decided by the double sums, every minute',{skip:!cc&&'no C compiler'},()=>{
  execFileSync('make',['-s','-C','native/host','harness-exact'],{stdio:'pipe'});
  const dir=mkdtempSync(join(tmpdir(),'groundtrack-fast-'));
  try{
    // Every plate's kind of night: zones, the dot screen, scan lines, the
    // drawn terminator; the terminator across the world band.
    for(const [name,args] of [
      ['moon-crt',['moon','2026-09-19T09:00:00Z','crt','flag']],['moon-sunlight',['moon','2026-09-19T09:00:00Z','sunlight','flag']],
      ['moon-sectional',['moon','2026-09-19T09:00:00Z','sectional','flag']],['moon-console',['moon','2026-09-19T09:00:00Z','console','flag']],
      ['sun-red',['sun','2026-06-21T13:00:00Z','red','noflag']],['iss-enroute',['sat:25544','2026-09-30T02:00:00Z','enroute','noflag']],
      ['n20-crt',['sat:43013','2026-09-30T17:00:00Z','crt','noflag']],['ls9-sunlight',['sat:49260','2026-10-01T09:00:00Z','sunlight','flag']]
    ]){
      execFileSync(process.execPath,['tools/export-scene.mjs',dir,name,...args,'0'],{stdio:'pipe',env});
      const scene=join(dir,`${name}.scene`),a=execFileSync('native/host/harness',[scene,'-','-a'],{maxBuffer:1<<24}),b=execFileSync('native/host/harness-exact',[scene,'-','-a'],{maxBuffer:1<<24});
      assert.ok(a.equals(b),`${name}: the fast night differs`);
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the watch app type-checks against the SDK signatures',{skip:!cc&&'no C compiler'},()=>{
  // A stand-in pebble.h (native/host/stub) declares what main.c uses; the
  // real check is the Pebble SDK build.
  for(const f of ['main.c','watch_data.c'])execFileSync('cc',['-std=gnu11','-Wall','-Wextra','-Werror','-Wno-unused-parameter','-Inative/host/stub','-Inative/src/c','-DENR_FLOAT','-fsyntax-only','native/src/c/'+f],{stdio:'pipe'});
});
