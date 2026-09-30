// The core (the watch's code, compiled to WebAssembly) draws the study's
// frames: for the hours and options the native tests cover, the core's
// frame is the JavaScript renderer's, pixel for pixel. The core is built by
// tools/build-core.sh; skipped without public/core.wasm.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {loadCore,CoreRenderer} from '../src/core.js';
import {EnrouteRenderer} from '../src/enroute-render.js';
import {decodeRelief} from '../src/relief.js';
import {decodeFullerPack} from '../src/fuller-ground.js';
import {HOMES} from '../src/home.js';
import {MINUTE} from '../src/ephemeris.js';
import {registerLiveFixture} from './tle-fixture.mjs';
import {STUDY_EVENTS} from '../src/events.js';
import {registerNominal} from '../src/nominal.js';

const wasm='public/core.wasm';
test('the core draws the study\'s frames',{skip:!existsSync(wasm)&&'no core.wasm (tools/build-core.sh)'},async()=>{
  registerLiveFixture();registerNominal();
  const read=f=>new Uint8Array(readFileSync(f));
  const core=await loadCore({wasm:read(wasm),map:read('native/resources/map.pack'),figures:read('native/resources/figures.bin'),tables:read('native/resources/tables.bin'),grids:read('public/fuller.bin'),land:read('public/land.bin')});
  const atlas=read('public/land.bin'),meters=decodeRelief(read('public/relief.bin')),grids=decodeFullerPack(read('public/fuller.bin'));
  const js=new EnrouteRenderer(atlas,meters,grids),c=new CoreRenderer(core);
  const cases=[
    ['sun','2026-09-27T08:00:00Z','enroute','America/New_York',{readout:'flag'},[0,24,59]],
    ['moon','2026-09-19T09:00:00Z','crt','America/New_York',{readout:true,numerals:'mono'},[5,47]],
    ['moon','2026-09-19T09:00:00Z','red','UTC',{},[12,59]],
    ['sat:36585','2026-09-27T13:00:00Z','sectional','America/New_York',{readout:'flag'},[3,58]],
    ['sat:25544','2026-09-30T13:00:00Z','crt','America/New_York',{readout:'flag',events:STUDY_EVENTS},[0,33,59]],
    ['sat:43013','2026-09-30T17:00:00Z','sunlight','UTC',{tape:'tape',clock24:false},[5,44]],
    ['sat:25544','2026-09-30T13:00:00Z','console','America/New_York',{transfer:'comb'},[17]],
    ['sat:25544','2026-09-30T13:00:00Z','crt','America/New_York',{tape:'slide'},[23]],
    ['sat:42738','2026-09-27T05:00:00Z','crt','America/New_York',{readout:'flag'},[0,24]],
    ['sat:42738','2026-09-27T05:00:00Z','sectional','America/New_York',{span:'hour',readout:true},[30]],
    ['sat:25544','2026-09-30T13:00:00Z','crt','America/New_York',{projection:'fuller',readout:'flag'},[0,24,59]],
    ['sun','2026-09-27T08:00:00Z','enroute','UTC',{projection:'fuller',readout:'flag'},[24]],
    ['sat:36585','2026-09-27T13:00:00Z','hypsometric','America/New_York',{projection:'fuller'},[40]],
  ];
  for(const [body,iso,plate,timeZone,more,minutes] of cases){
    const start=Date.parse(iso),clock24=more.clock24!==false;
    for(const m of minutes){
      const state={body,epoch:start+m*MINUTE,timeZone,clock24,plate,home:HOMES[timeZone]||null,...more};
      const a=js.render(state),b=c.render(state);
      let first=-1;for(let i=0;i<a.buf.length;i++)if(a.buf[i]!==b.buf[i]){first=i;break;}
      assert.equal(first,-1,`${body} ${iso} ${plate} ${JSON.stringify(more)} minute ${m}: first difference at pixel ${(first/3|0)%200},${Math.floor(first/3/200)}`);
      assert.equal(b.start,a.start);assert.equal(b.time,a.time);
      assert.deepEqual(b.stationsOnRoute.map(s=>[s.x,s.y]),a.stationsOnRoute.map(s=>[Math.round(s.x),Math.round(s.y)]));
    }
  }
});
