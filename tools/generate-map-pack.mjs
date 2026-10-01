// The watch's map resource (tools/map-pack.mjs): land bits and relief
// levels in tiles at 0.25°, 0.5° and 1°, cropped to the latitudes the
// watch's views can show (tests/map-pack.test.mjs checks that they stay
// inside). The world band, about a pixel a degree, reads its 1° cells.
//
//   node tools/generate-map-pack.mjs
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {encodePack,cellsOf,mipOf} from './map-pack.mjs';
import {reliefMeters} from '../src/relief.js';

// 79°N to 66°S: GPS charts reach 77.5°N and 64.4°S; the world band 72°N to 60°S.
export const NORTH=79,SOUTH=-66;
// A mip's rows between the two latitudes (cell size d degrees).
export const rowsOf=m=>{const d=0.25*2**m,first=Math.floor((90-NORTH)/d),last=Math.ceil((90-SOUTH)/d);return {first,rows:last-first};};
export function mips(){
  const relief=new Uint8Array(readFileSync(new URL('../public/relief.bin',import.meta.url))),atlas=new Uint8Array(readFileSync(new URL('../public/land.bin',import.meta.url)));
  const out=[];let cells=cellsOf(relief,atlas,1440,720,reliefMeters);
  for(let m=0;m<3;m++){out.push({cells,...rowsOf(m),resolution:m});if(m<2)cells=mipOf(cells);}
  return out;
}
if(process.argv[1]===new URL(import.meta.url).pathname){
  const all=mips(),dir=new URL('../native/resources/',import.meta.url);mkdirSync(dir,{recursive:true});
  for(const [name,list] of [['map.pack',all]]){
    const pack=encodePack(list);writeFileSync(new URL(name,dir),pack);
    console.log(`native/resources/${name}: ${pack.length} bytes (${list.map(m=>`${m.cells.width}x${m.rows} cells`).join(', ')})`);
  }
}
