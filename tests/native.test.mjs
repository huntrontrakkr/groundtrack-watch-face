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
const run=(dir,name,args,minutes)=>{
  execFileSync(process.execPath,['tools/export-scene.mjs',dir,name,...args,...minutes.map(String)],{stdio:'pipe'});
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
      ['gps-crt',['sat:36585','2026-09-27T13:00:00Z','crt','flag'],[3,24,58]]
    ]){
      for(const f of run(dir,name,args,minutes))assert.equal(f.differ,0,`${name} minute ${f.minute}: first difference at ${f.first}`);
    }
    // Plotboard's inks change with night; the browser colors a symbol by
    // the zone at its anchor, the native core pixel by pixel, so the two
    // may differ where a symbol straddles the terminator, and nowhere else.
    for(const f of run(dir,'moon-plotboard',['moon','2026-09-19T09:00:00Z','plotboard','noflag'],[0,47]))assert.ok(f.differ<=0.002*200*228,`minute ${f.minute}: ${f.differ}`);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the watch app type-checks against the SDK signatures',{skip:!cc&&'no C compiler'},()=>{
  // A stand-in pebble.h (native/host/stub) declares what main.c uses; the
  // real check is the Pebble SDK build.
  for(const f of ['main.c','watch_data.c'])execFileSync('cc',['-std=gnu11','-Wall','-Wextra','-Werror','-Wno-unused-parameter','-Inative/host/stub','-Inative/src/c','-DENR_FLOAT','-fsyntax-only','native/src/c/'+f],{stdio:'pipe'});
});
