// The core (the watch's code as WebAssembly) with the watch's resources,
// loaded once for the tests; a renderer over it for each.
import {readFileSync} from 'node:fs';
import {loadCore,CoreRenderer} from '../src/core.js';
let core=null;
const read=f=>new Uint8Array(readFileSync(f));
export async function theCore(){
  if(!core)core=await loadCore({wasm:read('public/core.wasm'),map:read('native/resources/map.pack'),figures:read('native/resources/figures.bin'),tables:read('native/resources/tables.bin'),grids:read('public/fuller.bin'),land:read('native/resources/land.pack')});
  return core;
}
export async function renderer(){return new CoreRenderer(await theCore());}
