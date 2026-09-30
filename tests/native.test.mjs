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
const run=(dir,name,args,minutes)=>{
  execFileSync(process.execPath,['tools/export-scene.mjs',dir,name,...args,...minutes.map(String)],{stdio:'pipe',env});
  return execFileSync('native/host/harness',[join(dir,`${name}.scene`),join(dir,name),...minutes.map(String)]).toString().trim().split('\n').map(l=>JSON.parse(l));
};

test('the native core draws the hour exactly as the browser does',{skip:!cc&&'no C compiler'},()=>{
  const dir=mkdtempSync(join(tmpdir(),'groundtrack-native-'));
  try{
    // Paper and zoned plates, night, the day/night lines, height tints, the
    // minute flag, the Moon's phase and a satellite's pass line.
    for(const [name,args,minutes] of [
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
      ['qzs-enroute',['sat:42738','2026-09-27T19:00:00Z','enroute','noflag'],[0,45]]
    ]){
      for(const f of run(dir,name,args,minutes))assert.equal(f.differ,0,`${name} minute ${f.minute}: first difference at ${f.first}`);
    }
    // Plotboard's inks change with night; the browser colors a symbol by
    // the zone at its anchor, the native core pixel by pixel, so the two
    // may differ where a symbol straddles the terminator, and nowhere else.
    for(const f of run(dir,'moon-plotboard',['moon','2026-09-19T09:00:00Z','plotboard','noflag'],[0,47]))assert.ok(f.differ<=0.002*200*228,`minute ${f.minute}: ${f.differ}`);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a minute drawn over the last draws only what changed, and the same pixels',{skip:!cc&&'no C compiler'},()=>{
  const dir=mkdtempSync(join(tmpdir(),'groundtrack-update-'));
  try{
    // Every plate, the Sun at noon and the Moon at nightfall, a satellite:
    // each minute over the one before (and over a jump of five) must be the
    // minute drawn whole.
    for(const [name,args] of [
      ['sun-enroute',['sun','2026-09-27T08:00:00Z','enroute','flag']],['sun-sectional',['sun','2026-06-21T13:00:00Z','sectional','flag']],
      ['moon-plotboard',['moon','2026-09-19T09:00:00Z','plotboard','flag']],['moon-hypsometric',['moon','2026-09-19T09:00:00Z','hypsometric','noflag']],
      ['moon-red',['moon','2026-09-19T09:00:00Z','red','noflag']],['moon-crt',['moon','2026-09-19T09:00:00Z','crt','flag']],
      ['moon-sunlight',['moon','2026-09-19T09:00:00Z','sunlight','flag']],['gps-crt',['sat:36585','2026-09-27T13:00:00Z','crt','flag']],
      ['iss-crt',['sat:25544','2026-09-30T13:00:00Z','crt','flag']],['ls9-plotboard',['sat:49260','2026-10-01T09:00:00Z','plotboard','flag']],
      ['qzs-hypsometric',['sat:42738','2026-09-27T05:00:00Z','hypsometric','noflag']]
    ]){
      execFileSync(process.execPath,['tools/export-scene.mjs',dir,name,...args,'0'],{stdio:'pipe',env});
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
      ['moon-sectional',['moon','2026-09-19T09:00:00Z','sectional','flag']],['moon-plotboard',['moon','2026-09-19T09:00:00Z','plotboard','flag']],
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
