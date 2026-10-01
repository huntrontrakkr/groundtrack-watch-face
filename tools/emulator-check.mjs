// The watch app in the Pebble emulator against the core (the watch's own
// code, as WebAssembly): takes
// a screenshot of the emulator, renders the browser's frame for the same
// minute and compares them pixel for pixel. Writes watch | browser | the
// pixels that differ (red) side by side at 2x.
//
//   node tools/emulator-check.mjs <out-dir> [body] [plate] [flag|noflag|callout] [zone]
//
// NUMERALS, MARGIN, SPAN, TAPE, TRANSFER, CLOCK24 and PROJECTION (chart,
// fuller: Groundtrack Fuller) give the phone's other settings
// (native/pkjs/main.js; defaults even, utc, day, fixed, 1), EVENTS_STORED its
// events as it keeps them.
//
// The settings must be the phone's (native/pkjs/main.js: sun, enroute and
// the flag by default, in the phone's own time zone); home is the zone's
// preset. The emulator must be running the app with its scene received.
// PEBBLE names the pebble command (default: tools/emulator.sh). TLE_FILE
// registers element sets first (three lines each), the ones the phone used.
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {civilHour} from '../src/chart-render.js';
import {loadCore,CoreRenderer} from '../src/core.js';
import {HOMES} from '../src/home.js';
import {MINUTE} from '../src/ephemeris.js';
import {W,H} from '../src/plates.js';
import {decodePNG,encodePNG} from './png.mjs';
import {registerElements} from '../src/satellites.js';
// NOMINAL=1: GPS and QZSS on their nominal orbits, as the phone falls back
// to when it has no fresh elements for them.
import {registerNominal} from '../src/nominal.js';
if(process.env.NOMINAL)registerNominal();
if(process.env.TLE_FILE){const lines=readFileSync(process.env.TLE_FILE,'utf8').trim().split('\n');for(let i=0;i+2<lines.length;i+=3)registerElements(lines.slice(i,i+3).join('\n')+'\n','celestrak');}

const [outArg='test-results/emulator',body='sun',plate='enroute',flagArg='flag',zone=Intl.DateTimeFormat().resolvedOptions().timeZone]=process.argv.slice(2);
const out=resolve(outArg);mkdirSync(out,{recursive:true});
const pebble=process.env.PEBBLE||fileURLToPath(new URL('emulator.sh',import.meta.url)),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const shotFile=join(out,`${body.replace(/\W/g,'-')}-${plate}-watch.png`);

// Capture within one minute, clear of the minute change and its redraw.
let at=null;
for(let attempt=0;attempt<3&&at===null;attempt++){
  while(new Date().getSeconds()<3||new Date().getSeconds()>50)await sleep(500);
  const before=Date.now();
  execFileSync(pebble,['screenshot','--emulator','emery','--no-open','--no-correction',shotFile],{stdio:'pipe',timeout:60000});
  if(Math.floor(before/MINUTE)===Math.floor(Date.now()/MINUTE))at=before;
}
if(at===null)throw new Error('No screenshot within one minute');

const shot=decodePNG(readFileSync(shotFile));
if(shot.width!==W||shot.height!==H)throw new Error(`Screenshot is ${shot.width}x${shot.height}, not ${W}x${H}`);
const start=civilHour(at,zone),minute=Math.floor((at-start)/MINUTE);
// The core, the watch's own code, draws the reference frame.
const read=f=>new Uint8Array(readFileSync(f)),core=await loadCore({wasm:read('public/core.wasm'),map:read('native/resources/map.pack'),figures:read('native/resources/figures.bin'),tables:read('native/resources/tables.bin'),grids:read('public/fuller.bin'),land:read('public/land.bin')});
const e=process.env,state={body,epoch:start+minute*MINUTE,plate,readout:flagArg==='noflag'?false:flagArg==='callout'?true:flagArg,numerals:e.NUMERALS||'even',zone:e.MARGIN||'utc',span:e.SPAN||'day',tape:e.TAPE||'fixed',transfer:e.TRANSFER||'off',projection:e.PROJECTION||'chart',events:e.EVENTS_STORED?JSON.parse(e.EVENTS_STORED):[],clock24:e.CLOCK24!=='0',timeZone:zone,home:HOMES[zone]||null};
const ref=Buffer.from(new CoreRenderer(core).render(state).buf);

// Side by side: watch, browser, differences in red over a faded browser frame.
const gap=10,wide=W*3+gap*2,sheet=Buffer.alloc(wide*H*3,255);let differ=0,first=null;const where=[];
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const i=(y*W+x)*3,a=shot.rgb.subarray(i,i+3),b=ref.subarray(i,i+3),same=a.equals(b);
  if(!same){differ++;first??=[x,y];if(where.length<40)where.push(`${x},${y} watch ${[...a].join('/')} browser ${[...b].join('/')}`);}
  const put=(dx,c)=>c.forEach((v,k)=>{sheet[(y*wide+dx+x)*3+k]=v;});
  put(0,a);put(W+gap,b);put((W+gap)*2,same?[...b].map(v=>170+v/3):[255,0,0]);
}
const name=`${body.replace(/\W/g,'-')}-${plate}-${String(minute).padStart(2,'0')}`;
writeFileSync(join(out,name+'.png'),encodePNG(sheet,wide,H,2));
const result={body,plate,readout:flagArg,zone,hour:new Date(start).toISOString(),minute,differ,first,...(differ?{where}:{})};
console.log(JSON.stringify(result));
process.exitCode=differ?1:0;
