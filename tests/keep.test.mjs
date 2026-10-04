// The ground kept between builds (native/src/c/chart.c keep_try, keep_step): a
// chart built again takes its runs from the store, and is the chart it was.
// The core keeps them in memory here (core_keep); the watch, in its
// persistent storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CoreRenderer} from '../src/core.js';
import {HOMES} from '../src/home.js';
import {registerElements} from '../src/satellites.js';
import {registerNominal} from '../src/nominal.js';
import {theCore} from './core-fixture.mjs';

registerNominal();
for(const f of ['celestrak-2026-09-29.tle','celestrak-2026-10-02.tle']){const l=readFileSync(new URL('./fixtures/'+f,import.meta.url),'utf8').trim().split('\n');for(let i=0;i+2<l.length;i+=3)try{registerElements(l.slice(i,i+3).join('\n')+'\n','fixture');}catch{}}
const zone='America/New_York',home={...HOMES[zone]},at=iso=>Date.parse(iso);
const base={timeZone:zone,clock24:true,home,plate:'console',readout:'flag'};
// One chart of each kind: the hour chart (with a shaded plate, which makes
// its ground again lighter if need be, and a lattice), the world band,
// a polar hour, a Fuller sheet of an hour and of a day.
const CASES={
  'the Sun on Console':{body:'sun',epoch:at('2026-09-30T17:24:00Z')},
  'GPS on Airbrush (shaded)':{body:'sat:36585',epoch:at('2026-09-28T15:09:00Z'),plate:'airbrush'},
  'the Moon on Dot matrix (a lattice)':{body:'moon',epoch:at('2026-09-30T02:37:00Z'),plate:'dotmatrix'},
  'the Space Station on the world band':{body:'sat:25544',epoch:at('2026-09-30T13:21:00Z'),face:'plotboard',tape:'slide'},
  'GLONASS over the Arctic':{body:'sat:57517',epoch:at('2026-10-02T20:24:00Z'),plate:'hypsometric'},
  'a Fuller sheet of an hour':{body:'sat:25544',epoch:at('2026-09-30T13:21:00Z'),projection:'fuller'},
  'a Fuller sheet of a day':{body:'sun',epoch:at('2026-09-30T17:24:00Z'),projection:'fuller',plate:'engraved'},
  'a zoomed Fuller sheet':{body:'sat:25544',epoch:at('2026-09-30T13:21:00Z'),projection:'fuller',plate:'planetary',legend:true}
};
// (Three minutes of one hour: the store holds the latest chart.)
const frames=(r,state)=>[3,23,43].map(m=>Buffer.from(r.render({...base,...state,epoch:Math.floor(state.epoch/3600e3)*3600e3+m*60e3}).buf));

test('a chart built again from its kept ground is the chart it was',async()=>{
  const core=await theCore(),r=new CoreRenderer(core);
  core.x.core_keep(1);
  try{
    for(const [name,state] of Object.entries(CASES)){
      core.slots.clear();let written=core.x.core_kept();
      const first=frames(r,state);
      assert.ok(core.x.core_kept()>written+2,`${name}: the first build keeps its ground`);
      written=core.x.core_kept();core.slots.clear();
      const again=frames(r,state);
      assert.equal(core.x.core_kept(),written,`${name}: the second build takes the kept ground, and keeps nothing`);
      first.forEach((f,k)=>assert.ok(f.equals(again[k]),`${name}: minute ${[3,23,43][k]} differs`));
    }
  }finally{core.x.core_keep(0);}
});

test('a ground kept is taken only by the chart it was made for',async()=>{
  const core=await theCore(),r=new CoreRenderer(core);
  core.x.core_keep(1);
  try{
    const state=CASES['the Sun on Console'],reference=frames(r,state);let written=core.x.core_kept();
    // The plate, the hour, the body and the face each make another chart.
    for(const other of [{plate:'engraved'},{epoch:state.epoch+3600e3},{body:'moon'},{face:'plotboard'},{projection:'fuller'}]){
      core.slots.clear();const out=frames(r,{...state,...other});
      assert.ok(core.x.core_kept()>written,`${JSON.stringify(other)} took the kept ground, and is not that chart`);written=core.x.core_kept();
      assert.ok(!out[0].equals(reference[0]),`${JSON.stringify(other)} drew the same`);
    }
    // And the first is gone: the store holds the latest.
    core.slots.clear();frames(r,state);assert.ok(core.x.core_kept()>written,'the store holds the latest chart');
  }finally{core.x.core_keep(0);}
});
