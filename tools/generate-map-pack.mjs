// The watch's map resource (tools/map-pack.mjs): land bits and relief
// levels in tiles at 0.25°, 0.5° and 1°, pole to pole, then the same of the
// two polar caps. The world band, about a pixel a degree, reads its 1° cells.
//
//   node tools/generate-map-pack.mjs
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {encodePack,cellsOf,mipOf} from './map-pack.mjs';
import {reliefMeters} from '../src/relief.js';

// Pole to pole: a satellite's hour chart can reach either (GLONASS's runs
// to the North Pole where the orbit turns), and the world band to 84°. (The
// pack was once cut at 79°N and 66°S, as far as the Sun's, the Moon's and
// GPS's charts went; a chart past the cut drew its last row again and again,
// in stripes. The rest is 10 KB.)
export const NORTH=90,SOUTH=-90;
// A mip's rows between the two latitudes (cell size d degrees).
export const rowsOf=m=>{const d=0.25*2**m,first=Math.floor((90-NORTH)/d),last=Math.ceil((90-SOUTH)/d);return {first,rows:last-first};};
// Then the two polar caps, the north's and the south's, each at the same
// three resolutions: the map on a polar stereographic projection, for the
// hour charts near a pole (chart.c). A cap is a square grid of the plane
// in degrees of arc at the pole (2 tan(c/2), c the angle from the pole, in
// degrees), CAP of them each way from the pole, row 0 at the top. East is
// to the right seen from outside the Earth: the plane's point for latitude
// and longitude is X = r sin(lon), Y = -r cos(lon) in the north, Y = r cos(lon)
// in the south. CAP reaches 70° from the pole on the axes: GLONASS's hour
// charts, the widest that turn to a pole, reach 70 out.
export const CAP=72;
const RAD=Math.PI/180;
export function capOf(world,pole,cell=.25){
  const n=Math.round(2*CAP/cell),land=new Uint8Array(n*n),level=new Uint8Array(n*n);
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){
    // The world's 0.25° cell nearest the cell's centre.
    const X=-CAP+(i+.5)*cell,Y=CAP-(j+.5)*cell,c=2*Math.atan(Math.hypot(X,Y)*RAD/2)/RAD,lat=pole*(90-c),lon=Math.atan2(X,-pole*Y)/RAD;
    const y=Math.min(719,Math.floor((90-lat)*4)),x=(Math.floor((lon+180)*4)%1440+1440)%1440;
    land[j*n+i]=world.land[y*1440+x];level[j*n+i]=world.level[y*1440+x];
  }
  return {width:n,height:n,land,level};
}
export function mips(){
  const relief=new Uint8Array(readFileSync(new URL('../public/relief.bin',import.meta.url))),atlas=new Uint8Array(readFileSync(new URL('../public/land.bin',import.meta.url)));
  const out=[],world=cellsOf(relief,atlas,1440,720,reliefMeters);let cells=world;
  for(let m=0;m<3;m++){out.push({cells,...rowsOf(m),resolution:m});if(m<2)cells=mipOf(cells);}
  for(const pole of [1,-1]){cells=capOf(world,pole);for(let m=0;m<3;m++){out.push({cells,first:0,rows:cells.height,resolution:m});if(m<2)cells=mipOf(cells);}}
  return out;
}
if(process.argv[1]===new URL(import.meta.url).pathname){
  const all=mips(),dir=new URL('../native/resources/',import.meta.url);mkdirSync(dir,{recursive:true});
  for(const [name,list] of [['map.pack',all]]){
    const pack=encodePack(list);writeFileSync(new URL(name,dir),pack);
    console.log(`native/resources/${name}: ${pack.length} bytes (${list.map(m=>`${m.cells.width}x${m.rows} cells`).join(', ')})`);
  }
}
