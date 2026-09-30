// The watch's map pack: lossless, reproducible, decoded identically by the
// JavaScript reference and the watch's C, and covering every latitude the
// watch's views can show.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {encodePack,readPack,decodeStrip} from '../tools/relief-pack.mjs';
import {MAP_ROWS} from '../tools/generate-map-pack.mjs';
import {chartCamera,WORLD} from '../src/chart-render.js';
import {registerNominal} from '../src/nominal.js';
import {W,H} from '../src/enroute-render.js';

const relief=new Uint8Array(readFileSync('public/relief.bin')),land=new Uint8Array(readFileSync('public/land.bin'));
const committed=new Uint8Array(readFileSync('native/resources/map.pack'));

test('the committed map pack is the one the generator writes',()=>{
  assert.ok(Buffer.from(encodePack(relief,land,MAP_ROWS)).equals(Buffer.from(committed)),'run npm run generate:map-pack');
});

test('the map pack decodes to every land bit and relief code, and fits beside the type',()=>{
  const p=readPack(committed);
  for(let k=0;k<p.offsets.length-1;k++){
    const {relief:r,land:l}=decodeStrip(p,k),base=(p.first+k*p.strip)*p.width;
    for(let i=0;i<r.length;i++){
      const g=base+i;
      if(r[i]!==relief[g]||l[i]!==((land[g>>3]>>(g&7))&1))assert.fail(`strip ${k}, cell ${i}`);
    }
  }
  // The app store allows 256 KB of resources; keep 16 KB for the rest.
  assert.ok(committed.length<=240*1024,`${committed.length} bytes`);
});

let cc=true;try{execFileSync('make',['-s','-C','native/host','map_test'],{stdio:'pipe'});}catch{cc=false;}
test('the watch decoder reads the same cells',{skip:!cc&&'no C compiler'},()=>{
  const out=JSON.parse(execFileSync('native/host/map_test',['native/resources/map.pack','public/relief.bin','public/land.bin']).toString());
  assert.equal(out.differ,0);assert.equal(out.rows,MAP_ROWS.rows);
  // From the middle of a strip, as a chart asks.
  const part=JSON.parse(execFileSync('native/host/map_test',['native/resources/map.pack','public/relief.bin','public/land.bin','203','271']).toString());
  assert.equal(part.differ,0);assert.equal(part.rows,68);
});

test('every latitude the watch can show is in the pack',()=>{
  registerNominal();
  // The rows a chart's pixels read: bilinear sampling takes the cell centre
  // row either side of a pixel's latitude.
  const top=MAP_ROWS.first,bottom=MAP_ROWS.first+MAP_ROWS.rows-1;
  const rows=cam=>{const n=cam.toGround(0,.5).lat,s=cam.toGround(0,H-.5).lat;return [Math.floor((90-n)*4-.5),Math.floor((90-s)*4-.5)+1];};
  const HOUR=3600000,check=(what,cam)=>{const [a,b]=rows(cam);assert.ok(a>=top&&b<=bottom,`${what}: rows ${a} to ${b} outside ${top} to ${bottom}`);};
  // The Sun through a year; the Moon near its widest range (2025-26); GPS
  // through its twelve-hour orbit, twice over.
  for(let t=Date.parse('2026-01-01T00:00:00Z');t<Date.parse('2027-01-01T00:00:00Z');t+=73*HOUR)check('sun',chartCamera('sun',t));
  for(const t of [Date.parse('2025-12-06T00:00:00Z'),Date.parse('2025-12-19T00:00:00Z'),Date.parse('2026-06-05T00:00:00Z')])for(let h=0;h<48;h+=3)check('moon',chartCamera('moon',t+h*HOUR));
  for(let t=Date.parse('2026-09-27T00:00:00Z');t<Date.parse('2026-09-28T00:00:00Z');t+=HOUR)check('gps',chartCamera('sat:36585',t));
  // The world band's fixed latitudes, for any satellite.
  assert.ok((90-WORLD.north)*4-1>=top&&(90-WORLD.south)*4+1<=bottom);
  assert.equal(W,200);
});
