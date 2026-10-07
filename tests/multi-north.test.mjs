import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chartInput} from '../src/chart-input.js';
import {renderer} from './core-fixture.mjs';
import {registerLiveFixture} from './tle-fixture.mjs';
const epoch=Date.parse('2026-09-30T13:20:00Z');
registerLiveFixture();
test('true north follows the local meridian across all 20 faces and eight rotations',()=>{
  const dir=mkdtempSync(join(tmpdir(),'groundtrack-north-'));
  try{const exe=join(dir,'north');execFileSync('cc',['-std=c11','-O2','native/host/north_test.c','native/src/c/fuller.c','native/src/c/fmath.c','-lm','-o',exe]);execFileSync(exe);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('companion markers and north survive full and partial minute redraws',async()=>{
  const r=await renderer();
  for(const projection of ['chart','fuller'])for(const tape of ['fixed','slide']){
    const state={body:'sat:25544',epoch,timeZone:'UTC',clock24:true,plate:'console',projection,tape,north:true,extra:['sat:20580','sat:48274']};
    r.render(state);const {slot}=r.last,first=r.core.render(20,slot);let frame=r.core.render(0,slot);
    for(let minute=1;minute<60;minute++){r.core.update(minute-1,minute,frame,slot);assert.deepEqual(frame,r.core.render(minute,slot),`${projection}/${tape}/${minute}`);}
    r.render({...state,extra:[]});assert.notDeepEqual(first,r.core.render(20,r.last.slot),'additional satellites must appear');
  }
});
test('companions cannot duplicate the primary, and missing orbit data leaves its chart intact',async()=>{
  const r=await renderer(),state={body:'sat:25544',epoch,timeZone:'UTC',clock24:true,plate:'console',projection:'fuller'};
  r.render(state);const base=r.last.frame;
  for(const extra of [['sat:25544'],['not-a-satellite'],['sat:999999']]){r.render({...state,extra});assert.deepEqual(r.last.frame,base);}
  r.render({...state,extra:['sat:20580']});const one=r.last.frame;
  r.render({...state,extra:['sat:20580','sat:20580']});assert.deepEqual(r.last.frame,one);
  r.render({...state,north:true});assert.notDeepEqual(r.last.frame,base);
  r.render({...state,projection:'chart'});const chart=r.last.frame;r.render({...state,projection:'chart',north:true});assert.deepEqual(r.last.frame,chart);
});

test('satellite identifiers are drawn for companions and the primary on both maps',async()=>{
  const r=await renderer();
  for(const projection of ['chart','fuller']){
    const input=chartInput({body:'sat:25544',start:epoch-20*60000,plate:'console',zone:'UTC',projection,extra:['sat:20580','sat:48274']});
    const labeled=r.core.sceneFor(input),frame=r.core.render(20,labeled.slot);
    const numeric=r.core.sceneFor(input.replace('extra_code0 HST','extra_code0 1').replace('extra_code1 CSS','extra_code1 2'));
    assert.notDeepEqual(frame,r.core.render(20,numeric.slot),'companion names must replace the old slot numbers');
    const renamed=r.core.sceneFor(input.replace('code ISS\n','code ABC\n'));
    const changed=r.core.render(20,renamed.slot);
    let count=0;
    for(let i=0;i<frame.length;i++)if(frame[i]!==changed[i]){count++;assert.ok(i%200<30,'primary identifier uses the date margin');}
    assert.ok(count>0,'primary identifier must appear on each map');
  }
});
