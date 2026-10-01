// One image of every face and configuration against every plate, rendered by
// the watch's own core: rows are what the watch shows (body, view, time
// scale, projection), columns the plate styles. For showing the range.
//   node tools/render-matrix.mjs [out.png]
import {readFileSync,writeFileSync} from 'node:fs';
import {W,H} from '../src/chart-render.js';
import {PLATES} from '../src/plates.js';
import {loadCore,CoreRenderer} from '../src/core.js';
import {encodePNG} from './png.mjs';
import {HOMES} from '../src/home.js';
import {registerNominal} from '../src/nominal.js';
registerNominal();
import fonts from '../data/draft-font.json' with {type:'json'};

const read=f=>new Uint8Array(readFileSync(f)),out=process.argv[2]||'docs/screenshots/matrix.png';
const core=await loadCore({wasm:read('public/core.wasm'),map:read('native/resources/map.pack'),figures:read('native/resources/figures.bin'),tables:read('native/resources/tables.bin'),grids:read('public/fuller.bin'),land:read('native/resources/land.pack')});
const zone='America/New_York',home=HOMES[zone],at=iso=>Date.parse(iso);
const ISS=at('2019-06-05T12:24:00Z'),SUN=at('2026-09-27T08:24:00Z'),MOON=at('2026-09-19T09:24:00Z'),GPS=at('2026-09-27T13:24:00Z'),QZSS=at('2026-09-27T05:24:00Z');
// [label lines, state]
const ROWS=[
  [['SUN','HOUR CHART','MINUTE FLAG'],{body:'sun',epoch:SUN,readout:'flag'}],
  [['MOON','HOUR CHART','TIME CALLOUT'],{body:'moon',epoch:MOON,readout:'callout',numerals:'mono'}],
  [['ISS','WORLD BAND','FIXED TAPE'],{body:'iss',epoch:ISS,readout:'flag'}],
  [['ISS','WORLD BAND','SLIDING TAPE'],{body:'iss',epoch:ISS,tape:'tape'}],
  [['ISS','WORLD BAND','WORLD SLIDING'],{body:'iss',epoch:ISS,tape:'slide'}],
  [['SUN','FULLER SHEET'],{body:'sun',epoch:SUN,projection:'fuller',readout:'flag'}],
  [['ISS','FULLER SHEET'],{body:'iss',epoch:ISS,projection:'fuller',readout:'flag'}],
  [['GPS','HOUR CHART','MINUTE FLAG'],{body:'sat:36585',epoch:GPS,readout:'flag'}],
  [['QZSS','WHOLE DAY','TIME CALLOUT'],{body:'sat:42738',epoch:QZSS,numerals:'even'}]
];
const plates=Object.entries(PLATES),gap=16,head=22,left=116,sheetW=left+gap+plates.length*(W+gap),sheetH=head+gap+ROWS.length*(H+gap);
const sheet=new Uint8ClampedArray(sheetW*sheetH*3),paper=[235,233,224],ink=[31,59,58];
for(let i=0;i<sheet.length;i+=3)sheet.set(paper,i);
const text=(value,x,baseline)=>{for(const c of value){const g=fonts.small[c]||fonts.small['?'];for(const [rx,ry,len] of g.r)for(let k=0;k<len;k++)sheet.set(ink,((baseline-g.t+ry)*sheetW+x+g.l+rx+k)*3);x+=g.a;}};
plates.forEach(([k,p],col)=>text(p.name.toUpperCase(),left+gap+col*(W+gap),head-6));
ROWS.forEach(([label,state],row)=>{
  const y0=head+gap+row*(H+gap);
  label.forEach((line,i)=>text(line,8,y0+14+i*14));
  plates.forEach(([plate],col)=>{
    const buf=new CoreRenderer(core).render({timeZone:zone,clock24:true,numerals:'even',home,plate,...state}).buf,x0=left+gap+col*(W+gap);
    for(let y=0;y<H;y++)sheet.set(buf.subarray(y*W*3,(y+1)*W*3),((y0+y)*sheetW+x0)*3);
  });
});
writeFileSync(out,encodePNG(sheet,sheetW,sheetH));
console.log(`${out}: ${ROWS.length} configurations x ${plates.length} plates, ${sheetW}x${sheetH}`);
