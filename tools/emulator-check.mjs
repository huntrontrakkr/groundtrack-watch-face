// The watch app in the Pebble emulator against the browser renderer: takes
// a screenshot of the emulator, renders the browser's frame for the same
// minute and compares them pixel for pixel. Writes watch | browser | the
// pixels that differ (red) side by side at 2x.
//
//   node tools/emulator-check.mjs <out-dir> [body] [plate] [flag|noflag|callout] [zone]
//
// NUMERALS, MARGIN, SPAN, TAPE and CLOCK24 give the phone's other settings
// (native/pkjs/main.js; defaults even, utc, day, fixed, 1), EVENTS_STORED its
// events as it keeps them.
//
// The settings must be the phone's (native/pkjs/main.js: sun, enroute and
// the flag by default, in the phone's own time zone); home is the zone's
// preset. The emulator must be running the app with its scene received.
// PEBBLE names the pebble command (default: tools/emulator.sh). TLE_FILE
// registers an element set first, the one the phone used for a satellite.
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildScene} from './export-scene.mjs';
import {civilHour} from '../src/chart-render.js';
import {HOMES} from '../src/home.js';
import {MINUTE} from '../src/ephemeris.js';
import {W,H} from '../src/enroute-render.js';
import {decodePNG,encodePNG} from './png.mjs';
import {registerElements} from '../src/satellites.js';
if(process.env.TLE_FILE)registerElements(readFileSync(process.env.TLE_FILE,'utf8'),'celestrak');

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
const e=process.env,{renderer,state}=buildScene({body,start,plate,readout:flagArg==='noflag'?false:flagArg,numerals:e.NUMERALS||'even',zone:e.MARGIN||'utc',span:e.SPAN||'day',tape:e.TAPE||'fixed',minute,events:e.EVENTS_STORED?JSON.parse(e.EVENTS_STORED):[],clock24:e.CLOCK24!=='0',timeZone:zone,home:HOMES[zone]||null});
const ref=Buffer.from(renderer.render({...state,epoch:start+minute*MINUTE}).buf);

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
