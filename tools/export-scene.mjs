// Export an hour of Study 06 for the native renderer, with reference frames
// from the browser renderer for the native one to match. The scene format
// is described in src/native-scene.js.
//
//   node tools/export-scene.mjs <out-dir> <name> <body> <hour ISO> <plate> flag|noflag [minutes...]
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildScene as build} from '../src/native-scene.js';
import {decodeRelief} from '../src/relief.js';
import {MINUTE} from '../src/ephemeris.js';
import {HOMES} from '../src/home.js';

let atlas,meters;
// The tools' scenes: UTC, with New York as home.
export function buildScene(options){
  atlas??=new Uint8Array(readFileSync(new URL('../public/land.bin',import.meta.url)));
  meters??=decodeRelief(new Uint8Array(readFileSync(new URL('../public/relief.bin',import.meta.url))));
  const {scene,...rest}=build({atlas,meters,home:HOMES['America/New_York'],...options});
  return {scene:Buffer.from(scene),...rest};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [out,name,body,hourIso,plateKey,flagArg,...minuteArgs]=process.argv.slice(2);
  const minutes=minuteArgs.length?minuteArgs.map(Number):[0,7,24,38,59],start=Date.parse(hourIso);
  const {scene,renderer,state}=buildScene({body,start,plate:plateKey,flag:flagArg==='flag'});
  mkdirSync(out,{recursive:true});writeFileSync(`${out}/${name}.scene`,scene);
  for(const m of minutes){const o=renderer.render({...state,epoch:start+m*MINUTE});writeFileSync(`${out}/${name}-${String(m).padStart(2,'0')}.rgb`,Buffer.from(o.buf));}
  console.log(`${name}: ${scene.length} scene bytes, ${minutes.length} reference frames`);
}
