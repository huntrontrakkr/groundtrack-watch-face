// The store galleries: frames of each face drawn by the watch's own code
// (the core, as WebAssembly), 200x228 as the store takes them for emery,
// into docs/screenshots/store/<face>/emery_NN_<name>.png, led by a reel,
// emery_00_reel.gif: the face's range, plates and features, half a second
// a frame (tools/gif.mjs). tools/release.py uploads what is there with a
// release.
//   node tools/render-store.mjs
import {mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadCore,CoreRenderer} from '../src/core.js';
import {HOMES} from '../src/home.js';
import {W,H} from '../src/plates.js';
import {encodePNG} from './png.mjs';
import {encodeGIF} from './gif.mjs';
import {registerElements,elementsFor} from '../src/satellites.js';
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
    ['moon',{body:'moon',epoch:at('2026-09-30T02:37:00Z'),plate:'engraved',readout:true,numerals:'colon'}],
    ['qzss',{body:'sat:42738',epoch:at('2026-09-28T22:12:00Z'),plate:'staratlas',readout:'flag'}],
    ['clock',{body:'sat:25544',epoch:at('2026-09-30T22:48:00Z'),plate:'raster',tape:'clock',readout:'flag'}],
    ['terrain',{body:'sat:36585',epoch:at('2026-09-28T15:09:00Z'),plate:'terrain',readout:'counter',events:[ev('2026-09-28T15:40:00Z','Launch')]}],
    ['nightside',{body:'sat:25544',epoch:at('2026-09-30T02:21:00Z'),plate:'nightside',readout:'flag'}],
    ['infrared',{body:'sat:36585',epoch:at('2026-09-28T15:09:00Z'),plate:'infrared',readout:'counter',numerals:'plain'}],
    ['rodgeryoung',{body:'sat:36585',epoch:at('2026-09-28T15:09:00Z'),plate:'rodgeryoung',face:'plotboard',tape:'route',readout:'off',also:['sun','moon']}]
  ],
  fuller:[
    ['operations',{body:'sat:25544',epoch:at('2026-09-30T13:21:00Z'),plate:'operations',readout:'counter',numerals:'colon',corner:'light',legend:true,also:['moon']}],
    ['sun',{body:'sun',epoch:at('2026-09-30T17:24:00Z'),plate:'odyssey',readout:true}],
    ['moon',{body:'moon',epoch:at('2026-09-30T02:37:00Z'),plate:'airbrush',readout:true,numerals:'colon'}],
    ['synthetic',{body:'sat:42738',epoch:at('2026-09-28T22:12:00Z'),plate:'synthetic',readout:true}],
    ['noaa',{body:'sat:43013',epoch:at('2026-09-30T17:42:00Z'),plate:'planetary',readout:'flag'}],
    ['moonlit',{body:'sat:36585',epoch:at('2026-09-28T15:09:00Z'),plate:'moonlit',readout:'counter',numerals:'even'}]
  ]
};
// The reels: chosen for each face's range (its views, readouts, the Sun and
// Moon marked, a polar chart) and its plates at their best, the charts' and
// the instruments' more than the novelties, each in its colours next to
// another's.
const REELS={
  enroute:[
    {body:'sun',epoch:at('2026-09-30T03:30:00Z'),plate:'enroute',readout:'flag',also:['moon']},
    {body:'moon',epoch:at('2026-09-30T02:37:00Z'),plate:'engraved',readout:'callout',numerals:'colon',also:['sun']},
    {body:'sat:36585',epoch:at('2026-09-28T15:09:00Z'),plate:'infrared',readout:'counter',numerals:'plain'},
    {body:'sat:42738',epoch:at('2026-09-28T22:12:00Z'),plate:'staratlas',readout:'flag'},
    {body:'sun',epoch:at('2026-09-30T17:20:00Z'),plate:'airbrush',readout:'counter'},
    {body:'sat:25544',epoch:at('2026-09-30T18:33:00Z'),plate:'blueprint',face:'plotboard',tape:'route',readout:'flag',also:['sun','moon']},
    {body:'sat:57517',epoch:at('2026-10-02T20:24:00Z'),plate:'hypsometric',readout:'flag'},
    {body:'sat:36585',epoch:at('2026-09-28T13:10:00Z'),plate:'survey',readout:'counter',numerals:'colon'},
    {body:'sat:36585',epoch:at('2026-09-28T19:40:00Z'),plate:'voldenuit',readout:'flag'},
    {body:'sat:25544',epoch:at('2026-09-30T13:21:00Z'),plate:'planetary',face:'plotboard',readout:'flag',also:['sun','moon']},
    {body:'sat:57517',epoch:at('2026-10-02T19:24:00Z'),plate:'terrain',readout:'counter'},
    {body:'sat:25544',epoch:at('2026-09-30T22:48:00Z'),plate:'survey',face:'plotboard',tape:'clock',readout:'flag'}
  ],
  fuller:[
    {body:'sun',epoch:at('2026-09-30T17:24:00Z'),plate:'engraved',readout:'flag'},
    {body:'sat:25544',epoch:at('2026-09-30T13:21:00Z'),plate:'operations',readout:'counter',numerals:'colon',corner:'light',legend:true,also:['moon']},
    {body:'moon',epoch:at('2026-09-30T02:37:00Z'),plate:'airbrush',readout:'flag',numerals:'colon'},
    {body:'sat:25544',epoch:at('2026-09-30T02:21:00Z'),plate:'nightside',readout:'flag'},
    {body:'sun',epoch:at('2026-09-30T10:20:00Z'),plate:'sectional',readout:'flag'},
    {body:'sat:42738',epoch:at('2026-09-28T22:12:00Z'),plate:'synthetic',readout:'flag'},
    {body:'sat:43013',epoch:at('2026-09-30T17:42:00Z'),plate:'planetary',readout:'flag'},
    {body:'moon',epoch:at('2026-09-30T05:44:00Z'),plate:'voldenuit',readout:'flag',also:['sun']},
    {body:'sat:25544',epoch:at('2026-09-30T09:10:00Z'),plate:'hypsometric',readout:'flag',also:['sun']},
    {body:'sun',epoch:at('2026-09-30T03:30:00Z'),plate:'globus',readout:'flag',also:['moon']},
    {body:'sat:25544',epoch:at('2026-09-30T22:48:00Z'),plate:'survey',readout:'callout'},
    {body:'sat:25544',epoch:at('2026-09-30T15:05:00Z'),plate:'infrared',readout:'counter'}
  ]
};
const draw=(face,state)=>new CoreRenderer(core).render({timeZone:zone,clock24:true,home,numerals:'even',zone:'utc',span:'day',tape:'fixed',transfer:'off',figures:'michroma',corner:'day',projection:face==='fuller'?'fuller':'chart',...state});
for(const [face,list] of Object.entries(GALLERIES)){
  const dir=join('docs/screenshots/store',face);rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
  list.forEach(([name,state],k)=>{
    const frame=draw(face,state);
    const file=join(dir,`emery_${String(k+1).padStart(2,'0')}_${name}.png`);
    writeFileSync(file,encodePNG(Buffer.from(frame.buf),W,H,1));
    console.log(file);
  });
}
// The reels take CelesTrak's elements of 2 October for the rest (GLONASS
// turning over the Arctic; GPS and QZSS as they were, not nominal).
{const lines=readFileSync('tests/fixtures/celestrak-2026-10-02.tle','utf8').trim().split('\n');for(let i=0;i+2<lines.length;i+=3){const b='sat:'+Number(lines[i+1].slice(2,7));if(!elementsFor(b)||elementsFor(b).source==='nominal')registerElements(lines.slice(i,i+3).join('\n')+'\n','celestrak');}}
for(const [face,list] of Object.entries(REELS)){
  const reel=join('docs/screenshots/store',face,'emery_00_reel.gif');
  writeFileSync(reel,encodeGIF(list.map(state=>Buffer.from(draw(face,state).buf)),W,H,50));
  console.log(reel);
}
