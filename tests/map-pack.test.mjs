// The watch's map pack: tiles of land bits and relief levels at three
// resolutions, reproducible, decoded identically by the JavaScript reference
// and the watch's C, and covering every latitude the watch's views can show.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {encodePack,readPack,decodeTile,levelOf,LEVELS,HEIGHTS,T} from '../tools/map-pack.mjs';
import {mips,rowsOf,NORTH,SOUTH} from '../tools/generate-map-pack.mjs';
import {chartCamera,WORLD} from '../src/chart-render.js';
import {registerNominal} from '../src/nominal.js';
import {CONTOURS,SHELF,PLATES,H} from '../src/plates.js';

const committed=new Uint8Array(readFileSync('native/resources/map.pack'));
const all=mips();

test('the committed map packs are the ones the generator writes',()=>{
  assert.ok(Buffer.from(encodePack(all)).equals(Buffer.from(committed)),'run npm run generate:map-pack');
  // The levels are every height the plates read: the shelf, the contours, the tints.
  const read=new Set([SHELF,...CONTOURS,...Object.values(PLATES).flatMap(p=>[...(p.tints||[]),...(p.depths||[])].map(([l])=>l).filter(Number.isFinite))]);
  for(const l of read)assert.ok(LEVELS.includes(l),`${l} m is not a level`);
  for(let k=0;k<HEIGHTS.length;k++)assert.equal(levelOf(HEIGHTS[k]),k);
});

test('every tile decodes to its cells, in JavaScript and in C, and the packs fit beside the type',()=>{
  const p=readPack(committed);
  for(let m=0;m<3;m++){
    const mip=p.mips[m],{cells,first}=all[m],raw=new Uint8Array(mip.width*mip.rows);
    for(let ty=0;ty<mip.trows;ty++)for(let tx=0;tx<mip.cols;tx++){
      const t=decodeTile(p,m,tx,ty);
      for(let cy=0;cy<T;cy++)for(let cx=0;cx<T;cx++){
        const x=tx*T+cx,y=ty*T+cy;if(x>=mip.width||y>=mip.rows)continue;raw[y*mip.width+x]=t[cy*T+cx];
        const want=cells.land[(first+y)*cells.width+x]<<4|cells.level[(first+y)*cells.width+x];
        if(t[cy*T+cx]!==want)assert.fail(`mip ${m}, tile ${tx},${ty}, cell ${cx},${cy}`);
      }
    }
    if(cc){const c=execFileSync('native/host/map_test',['native/resources/map.pack',String(m)],{maxBuffer:1<<26});assert.ok(Buffer.from(raw).equals(c),`mip ${m}: the C decoder differs`);}
  }
  // The app store allows 256 KB of resources; the type and grids need some.
  assert.ok(committed.length<=64*1024,`${committed.length} bytes`);
});
let cc=true;try{execFileSync('make',['-s','-C','native/host','map_test'],{stdio:'pipe'});}catch{cc=false;}

test('every latitude the watch can show is in the pack',()=>{
  registerNominal();
  // The rows a chart's pixels read: bilinear sampling takes the cell centre
  // row either side of a pixel's latitude, at the 0.25° cells.
  const {first,rows}=rowsOf(0),top=first,bottom=first+rows-1;
  const at=cam=>{const n=cam.toGround(0,.5).lat,s=cam.toGround(0,H-.5).lat;return [Math.floor((90-n)*4-.5),Math.floor((90-s)*4-.5)+1];};
  const HOUR=3600000,check=(what,cam)=>{const [a,b]=at(cam);assert.ok(a>=top&&b<=bottom,`${what}: rows ${a} to ${b} outside ${top} to ${bottom}`);};
  // The Sun through a year; the Moon near its widest range (2025-26); GPS
  // through its twelve-hour orbit, twice over.
  for(let t=Date.parse('2026-01-01T00:00:00Z');t<Date.parse('2027-01-01T00:00:00Z');t+=73*HOUR)check('sun',chartCamera('sun',t));
  for(const t of [Date.parse('2025-12-06T00:00:00Z'),Date.parse('2025-12-19T00:00:00Z'),Date.parse('2026-06-05T00:00:00Z')])for(let h=0;h<48;h+=3)check('moon',chartCamera('moon',t+h*HOUR));
  for(let t=Date.parse('2026-09-27T00:00:00Z');t<Date.parse('2026-09-28T00:00:00Z');t+=HOUR)check('gps',chartCamera('sat:36585',t));
  // The world band's fixed latitudes, for any satellite.
  assert.ok(WORLD.north<=NORTH&&WORLD.south>=SOUTH);
});

test('the coastline pack is what the packer writes, and every row decodes to land.bin',async()=>{
  const {packLand,landRow,ROWS}=await import('../tools/land-pack.mjs');
  const bits=new Uint8Array(readFileSync('public/land.bin')),pack=new Uint8Array(readFileSync('native/resources/land.pack'));
  assert.ok(Buffer.from(packLand(bits)).equals(Buffer.from(pack)),'run node tools/land-pack.mjs');
  for(let y=0;y<ROWS;y++)assert.ok(Buffer.from(landRow(pack,y)).equals(Buffer.from(bits.subarray(y*180,(y+1)*180))),`row ${y}`);
});
