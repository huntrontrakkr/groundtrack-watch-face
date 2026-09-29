// Study 05 proofs rendered in Node, without a browser: the same renderer the
// page uses, written as native-size PNGs and one captioned contact sheet.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {ChartRenderer,CHARTS,W,H} from '../src/chart-render.js';
import {encodePNG} from './png.mjs';
import fonts from '../data/draft-font.json' with {type:'json'};

const atlas=new Uint8Array(readFileSync('public/land.bin'));
const zone='America/New_York';
export const SCENES=[
  {name:'sun',caption:'SUN / 04:24',body:'sun',epoch:Date.parse('2026-09-27T08:24:00Z')},
  {name:'moon-day',caption:'MOON BY DAY / 04:24',body:'moon',epoch:Date.parse('2026-09-17T08:24:00Z')},
  {name:'moon-dusk',caption:'MOON AT NIGHTFALL / 05:24',body:'moon',epoch:Date.parse('2026-09-19T09:24:00Z')},
  {name:'iss',caption:'ISS ARCHIVE / 08:24',body:'iss',epoch:Date.parse('2019-06-05T12:24:00Z')}
];
mkdirSync('docs/screenshots',{recursive:true});
const themes=Object.keys(CHARTS),gap=24,label=18,cols=themes.length;
const sheetW=gap+cols*(W+gap),sheetH=gap+SCENES.length*(H+gap+label),sheet=new Uint8ClampedArray(sheetW*sheetH*3);
const paper=[235,233,224],ink=[31,59,58];
for(let i=0;i<sheet.length;i+=3)sheet.set(paper,i);
const text=(value,x,baseline)=>{
  for(const c of value){const g=fonts.small[c]||fonts.small['?'];for(const [rx,ry,len] of g.r)for(let k=0;k<len;k++)sheet.set(ink,((baseline-g.t+ry)*sheetW+x+g.l+rx+k)*3);x+=g.a;}
};
SCENES.forEach((scene,row)=>themes.forEach((theme,col)=>{
  const r=new ChartRenderer(atlas).render({body:scene.body,epoch:scene.epoch,timeZone:zone,clock24:false,theme});
  writeFileSync(`docs/screenshots/study-05-${scene.name}-${theme}.png`,encodePNG(r.buf,W,H));
  const x0=gap+col*(W+gap),y0=gap+row*(H+gap+label)+label;
  text(`${scene.caption} / ${CHARTS[theme].name.toUpperCase()}`,x0,y0-8);
  for(let y=0;y<H;y++)sheet.set(r.buf.subarray(y*W*3,(y+1)*W*3),((y0+y)*sheetW+x0)*3);
}));
writeFileSync('docs/screenshots/study-05-contact-sheet.png',encodePNG(sheet,sheetW,sheetH));
// A 2x enlargement of the default face, with whole-pixel scaling.
const hero=new ChartRenderer(atlas).render({body:'sun',epoch:SCENES[0].epoch,timeZone:zone,clock24:false,theme:'shore'});
writeFileSync('docs/screenshots/study-05-sun-2x.png',encodePNG(hero.buf,W,H,2));
console.log(`Wrote ${SCENES.length*themes.length} native proofs, a contact sheet and a 2x enlargement.`);
