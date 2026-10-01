// Checks each built watch app: that it is an app at all (its header leads
// the binary: a link that drops it builds, and the watch refuses it), and
// its size against a budget. An emery app's code and data must fit 65,535
// bytes (its size is a 16-bit field), and every byte of it is a byte less
// heap: the budget keeps about 700 bytes under the cap (Groundtrack
// Fuller, the largest, is about 900 under; its heap is held to its own
// budget by tests/native.test.mjs).
//   node tools/check-app-size.mjs   (after npm run build:native)
import {readFileSync} from 'node:fs';
const CAP=65535,BUDGET=64800;let bad=false;
for(const face of ['native','native-fuller']){
  const bin=readFileSync(`${face}/build/emery/pebble-app.bin`);
  if(bin.toString('latin1',0,6)!=='PBLAPP'){console.log(`${face}: no app header at the start of the binary`);bad=true;continue;}
  // PebbleProcessInfo: the size the app takes in memory, loaded and zeroed.
  const size=bin.readUInt16LE(128),over=size>BUDGET;bad||=over;
  console.log(`${face}: ${size.toLocaleString()} bytes, ${(CAP-size).toLocaleString()} under the cap${over?` — over the ${BUDGET.toLocaleString()}-byte budget`:''}`);
}
process.exitCode=bad?1:0;
