// Export an hour of Study 06 for the native renderer, with reference frames
// from the browser renderer for the native one to match. The scene format
// is described in src/native-scene.js.
//
//   node tools/export-scene.mjs <out-dir> <name> <body> <hour ISO> <plate> flag|noflag|callout [minutes...]
//
// TLE_FILE names element sets (three lines each) for live satellites.
// NUMERALS (colon, plain, even, mono, accent), ZONE (utc, body), SPAN (day,
// hour), TAPE (fixed, tape, slide) and CLOCK24 (1, 0) set the browser's
// other options. With TAPE=slide the scene is for the first minute given.
// EVENTS gives events as JSON [{epoch (ISO), title}], named as the study
// names them (src/events.js).
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildScene as build} from '../src/native-scene.js';
import {decodeRelief} from '../src/relief.js';
import {MINUTE} from '../src/ephemeris.js';
import {HOMES} from '../src/home.js';
import {registerElements} from '../src/satellites.js';
import {nameCode} from '../src/events.js';

let atlas,meters;
// The tools' scenes: UTC, with New York as home.
export function buildScene(options){
  atlas??=new Uint8Array(readFileSync(new URL('../public/land.bin',import.meta.url)));
  meters??=decodeRelief(new Uint8Array(readFileSync(new URL('../public/relief.bin',import.meta.url))));
  const {scene,...rest}=build({atlas,meters,home:HOMES['America/New_York'],...options});
  return {scene:Buffer.from(scene),...rest};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(process.env.TLE_FILE){const lines=readFileSync(process.env.TLE_FILE,'utf8').trim().split('\n');for(let i=0;i+2<lines.length;i+=3)registerElements(lines.slice(i,i+3).join('\n')+'\n','file');}
  const [out,name,body,hourIso,plateKey,flagArg,...minuteArgs]=process.argv.slice(2);
  const minutes=minuteArgs.length?minuteArgs.map(Number):[0,7,24,38,59],start=Date.parse(hourIso);
  const e=process.env,{scene,renderer,state}=buildScene({body,start,plate:plateKey,readout:flagArg==='noflag'?false:flagArg,
    numerals:e.NUMERALS||'even',zone:e.ZONE||'utc',span:e.SPAN||'day',tape:e.TAPE||'fixed',minute:minutes[0],events:e.EVENTS?JSON.parse(e.EVENTS).map(v=>({epoch:Date.parse(v.epoch),title:v.title,label:nameCode(v.title)})):[],clock24:e.CLOCK24!=='0'});
  mkdirSync(out,{recursive:true});writeFileSync(`${out}/${name}.scene`,scene);
  for(const m of minutes){const o=renderer.render({...state,epoch:start+m*MINUTE});writeFileSync(`${out}/${name}-${String(m).padStart(2,'0')}.rgb`,Buffer.from(o.buf));}
  console.log(`${name}: ${scene.length} scene bytes, ${minutes.length} reference frames`);
}
