// Proofs of the world band's tape-to-route strips (renderEnroute's `transfer`):
// each style on a station's hour and two polar orbits', side by side, at
// 2x. Writes test-results/transfer-proofs.png.
//
//   node tools/transfer-proofs.mjs
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {EnrouteRenderer,W,H} from '../src/enroute-render.js';
import {decodeRelief} from '../src/relief.js';
import {registerElements} from '../src/satellites.js';
import {HOMES} from '../src/home.js';
import {encodePNG} from './png.mjs';
import {decodeFullerPack} from '../src/fuller-ground.js';

const lines=readFileSync('tests/fixtures/celestrak-2026-09-29.tle','utf8').trim().split('\n');
for(let i=0;i+2<lines.length;i+=3)registerElements(lines.slice(i,i+3).join('\n')+'\n','fixture');
const r=new EnrouteRenderer(new Uint8Array(readFileSync('public/land.bin')),decodeRelief(new Uint8Array(readFileSync('public/relief.bin'))),decodeFullerPack(new Uint8Array(readFileSync('public/fuller.bin'))));
const hours=[['sat:25544','2026-09-30T13:24:00Z','crt'],['sat:43013','2026-09-30T17:24:00Z','enroute'],['sat:49260','2026-10-01T09:40:00Z','red']];
const styles=['off','vernier','comb','chevrons'],gap=12,sheetW=styles.length*(W+gap)-gap,sheetH=hours.length*(H+gap)-gap;
const sheet=Buffer.alloc(sheetW*sheetH*3,255);
hours.forEach(([body,iso,plate],row)=>styles.forEach((transfer,col)=>{
  const out=r.render({body,epoch:Date.parse(iso),timeZone:'America/New_York',clock24:true,plate,home:HOMES['America/New_York'],transfer});
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)for(let k=0;k<3;k++)sheet[((row*(H+gap)+y)*sheetW+col*(W+gap)+x)*3+k]=out.buf[(y*W+x)*3+k];
}));
mkdirSync('test-results',{recursive:true});writeFileSync('test-results/transfer-proofs.png',encodePNG(sheet,sheetW,sheetH,2));
console.log('test-results/transfer-proofs.png: columns',styles.join(', '));
