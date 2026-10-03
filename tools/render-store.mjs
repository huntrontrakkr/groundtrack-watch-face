// The store galleries: frames of each face drawn by the watch's own code
// (the core, as WebAssembly), 200x228 as the store takes them for emery,
// into docs/screenshots/store/<face>/emery_NN_<name>.png. tools/release.py
// uploads what is there with a release.
//   node tools/render-store.mjs
import {mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadCore,CoreRenderer} from '../src/core.js';
import {HOMES} from '../src/home.js';
import {W,H} from '../src/plates.js';
import {encodePNG} from './png.mjs';
import {registerElements} from '../src/satellites.js';
import {registerNominal} from '../src/nominal.js';
import {nameCode} from '../src/events.js';

// CelesTrak's elements of 29 September 2026 (tests/fixtures), and the hours
// after them; GPS and QZSS on their nominal orbits of the 27th.
registerNominal();
{const lines=readFileSync('tests/fixtures/celestrak-2026-09-29.tle','utf8').trim().split('\n');for(let i=0;i+2<lines.length;i+=3)registerElements(lines.slice(i,i+3).join('\n')+'\n','celestrak');}
const read=f=>new Uint8Array(readFileSync(f));
const core=await loadCore({wasm:read('public/core.wasm'),map:read('native/resources/map.pack'),figures:read('native/resources/figures.bin'),tables:read('native/resources/tables.bin'),grids:read('public/fuller.bin'),land:read('native/resources/land.pack')});
const zone='America/New_York',home={...HOMES[zone]},at=iso=>Date.parse(iso);
const ev=(iso,title)=>({epoch:at(iso),label:nameCode(title)});
const GALLERIES={
  enroute:[
    ['sun',{body:'sun',epoch:at('2026-09-30T17:24:00Z'),plate:'enroute',readout:'flag'}],
    ['iss',{body:'sat:25544',epoch:at('2026-09-30T13:21:00Z'),plate:'crt',readout:'flag'}],
    ['moon',{body:'moon',epoch:at('2026-09-30T02:37:00Z'),plate:'airbrush',readout:true,numerals:'colon'}],
    ['qzss',{body:'sat:42738',epoch:at('2026-09-28T22:12:00Z'),plate:'console',readout:'flag'}],
    ['clock',{body:'sat:25544',epoch:at('2026-09-30T22:48:00Z'),plate:'odyssey',tape:'clock',readout:'flag'}],
    ['survey',{body:'sat:36585',epoch:at('2026-09-28T15:09:00Z'),plate:'survey',readout:'counter',events:[ev('2026-09-28T15:40:00Z','Launch')]}],
    ['operations',{body:'sat:49260',epoch:at('2026-10-01T09:33:00Z'),plate:'operations',tape:'slide',readout:'flag',corner:'light'}],
    ['trackingboard',{body:'sat:36585',epoch:at('2026-09-28T15:09:00Z'),plate:'trackingboard',face:'plotboard',tape:'route',readout:'off',also:['sun','moon']}]
  ],
  fuller:[
    ['operations',{body:'sat:25544',epoch:at('2026-09-30T13:21:00Z'),plate:'operations',readout:'counter',numerals:'colon',corner:'light',legend:true,also:['moon']}],
    ['sun',{body:'sun',epoch:at('2026-09-30T17:24:00Z'),plate:'odyssey',readout:true}],
    ['moon',{body:'moon',epoch:at('2026-09-30T02:37:00Z'),plate:'airbrush',readout:true,numerals:'colon'}],
    ['trackingboard',{body:'sat:42738',epoch:at('2026-09-28T22:12:00Z'),plate:'trackingboard',readout:true}],
    ['noaa',{body:'sat:43013',epoch:at('2026-09-30T17:42:00Z'),plate:'blueprint',readout:'flag'}],
    ['survey',{body:'sat:36585',epoch:at('2026-09-28T15:09:00Z'),plate:'survey',readout:'counter',numerals:'even'}]
  ]
};
for(const [face,list] of Object.entries(GALLERIES)){
  const dir=join('docs/screenshots/store',face);rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
  list.forEach(([name,state],k)=>{
    const r=new CoreRenderer(core);
    const frame=r.render({timeZone:zone,clock24:true,home,numerals:'even',zone:'utc',span:'day',tape:'fixed',transfer:'off',figures:'michroma',corner:'day',projection:face==='fuller'?'fuller':'chart',...state});
    const file=join(dir,`emery_${String(k+1).padStart(2,'0')}_${name}.png`);
    writeFileSync(file,encodePNG(Buffer.from(frame.buf),W,H,1));
    console.log(file);
  });
}
