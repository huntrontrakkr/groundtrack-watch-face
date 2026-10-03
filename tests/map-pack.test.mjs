// The watch's map pack: tiles of land bits and relief levels at three
// resolutions, reproducible, decoded identically by the JavaScript reference
// and the watch's C, and covering the Earth from pole to pole.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {encodePack,readPack,decodeTile,levelOf,LEVELS,HEIGHTS,T} from '../tools/map-pack.mjs';
import {mips,rowsOf,NORTH,SOUTH,CAP} from '../tools/generate-map-pack.mjs';
import {CONTOURS,SHELF,PLATES} from '../src/plates.js';

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
  assert.equal(p.mips.length,9);
  for(let m=0;m<9;m++){
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
  // The app store allows 256 KB of resources; the type and tables need 40
  // KB of them.
  assert.ok(committed.length<=112*1024,`${committed.length} bytes`);
});
let cc=true;try{execFileSync('make',['-s','-C','native/host','map_test'],{stdio:'pipe'});}catch{cc=false;}

test('the pack is the whole Earth, pole to pole, and both polar caps, at each resolution',()=>{
  // A chart can reach either pole (GLONASS's hour does, where the orbit
  // turns north) and the world band 84°: a pack cut short of them drew its
  // last row again and again beyond, in stripes (tests/poles.test.mjs).
  assert.deepEqual([NORTH,SOUTH],[90,-90]);
  for(let m=0;m<3;m++)assert.deepEqual(rowsOf(m),{first:0,rows:720>>m});
  const p=readPack(committed),n=Math.round(2*CAP/.25);
  for(let m=0;m<3;m++)assert.deepEqual([p.mips[m].first,p.mips[m].rows],[0,720>>m]);
  // The caps: square, the north's then the south's, CAP as the watch has it.
  for(let m=3;m<9;m++)assert.deepEqual([p.mips[m].resolution,p.mips[m].width,p.mips[m].first,p.mips[m].rows],[(m-3)%3,n>>(m-3)%3,0,n>>(m-3)%3]);
  assert.match(readFileSync('native/src/c/map_pack.h','utf8'),new RegExp(`#define MAP_CAP ${CAP}\\b`));
  // The cap's cell under a place is the world's: the North Pole's sea, the
  // South Pole's ice, Greenland's and Antarctica's shores where they are.
  const cell=(m,lat,lon,pole)=>{const r=2*Math.tan((90-pole*lat)*Math.PI/360)*180/Math.PI,X=r*Math.sin(lon*Math.PI/180),Y=-pole*r*Math.cos(lon*Math.PI/180),i=Math.floor((X+CAP)/.25),j=Math.floor((CAP-Y)/.25);return all[m].cells.land[j*n+i];};
  const world=(lat,lon)=>all[0].cells.land[Math.floor((90-lat)*4)*1440+Math.floor((lon+180)*4)];
  for(const [lat,lon] of [[89.9,0],[72,-40],[75,-30],[81,-40],[85,-150],[65,-150],[62,100],[60,-30]])assert.equal(cell(3,lat,lon,1),world(lat,lon),`${lat} ${lon}`);
  for(const [lat,lon] of [[-89.9,0],[-75,0],[-80,100],[-85,-150],[-60,-120],[-50,-100]])assert.equal(cell(6,lat,lon,-1),world(lat,lon),`${lat} ${lon}`);
});

test('the coastline pack is what the packer writes, and every row decodes to land.bin',async()=>{
  const {packLand,landRow,ROWS}=await import('../tools/land-pack.mjs');
  const bits=new Uint8Array(readFileSync('public/land.bin')),pack=new Uint8Array(readFileSync('native/resources/land.pack'));
  assert.ok(Buffer.from(packLand(bits)).equals(Buffer.from(pack)),'run node tools/land-pack.mjs');
  for(let y=0;y<ROWS;y++)assert.ok(Buffer.from(landRow(pack,y)).equals(Buffer.from(bits.subarray(y*180,(y+1)*180))),`row ${y}`);
});
