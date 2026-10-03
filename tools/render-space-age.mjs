// The release's three plates, with the counter readout, drawn by the watch's
// core. Exact 200x228 frames enlarged 2x, with labels outside the frames.
// node tools/render-space-age.mjs
import {readFileSync,writeFileSync} from 'node:fs';
import {W,H,PLATES} from '../src/plates.js';
import {loadCore,CoreRenderer} from '../src/core.js';
import {registerNominal} from '../src/nominal.js';
import {encodePNG} from './png.mjs';
import fonts from '../data/draft-font.json' with {type:'json'};

registerNominal();
const read=f=>new Uint8Array(readFileSync(f));
const core=await loadCore({wasm:read('public/core.wasm'),map:read('native/resources/map.pack'),figures:read('native/resources/figures.bin'),tables:read('native/resources/tables.bin'),grids:read('public/fuller.bin'),land:read('native/resources/land.pack')});
const plates=['trackingboard','survey','operations'],gap=18,label=32;
const width=gap+3*(W+gap),height=gap+2*(H+label+gap);
const sheet=new Uint8ClampedArray(width*height*3),paper=[235,233,224],ink=[31,59,58];
for(let i=0;i<sheet.length;i+=3)sheet.set(paper,i);
function text(value,x,baseline){
  for(const c of value){const g=fonts.small[c]||fonts.small['?'];for(const [rx,ry,len] of g.r)for(let k=0;k<len;k++)sheet.set(ink,((baseline-g.t+ry)*width+x+g.l+rx+k)*3);x+=g.a;}
}
const rows=[
  {name:'GPS / ENROUTE',body:'sat:36585',epoch:Date.parse('2026-09-27T13:24:00Z'),projection:'chart'},
  {name:'ISS / FULLER',body:'iss',epoch:Date.parse('2019-06-05T12:24:00Z'),projection:'fuller'}
];
rows.forEach((state,row)=>plates.forEach((plate,col)=>{
  const x=gap+col*(W+gap),y=gap+label+row*(H+label+gap);
  text(PLATES[plate].name.toUpperCase(),x,y-18);text(state.name+' / MINUTE 24',x,y-5);
  const out=new CoreRenderer(core).render({...state,timeZone:'UTC',clock24:true,plate,readout:'counter',corner:'light',figures:plate==='survey'?'b612':'michroma',home:null});
  for(let dy=0;dy<H;dy++)sheet.set(out.buf.subarray(dy*W*3,(dy+1)*W*3),((y+dy)*width+x)*3);
}));
const file='docs/screenshots/space-age-v0.3.0.png';
writeFileSync(file,encodePNG(sheet,width,height,2));console.log(file);
