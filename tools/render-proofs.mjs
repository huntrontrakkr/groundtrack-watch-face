// Study 05 and Study 06 proofs rendered in Node, without a browser: the same
// renderers the pages use, written as native-size PNGs, one captioned
// contact sheet per study and a 2x enlargement of each default face.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {ChartRenderer,CHARTS,W,H} from '../src/chart-render.js';
import {EnrouteRenderer,PLATES} from '../src/enroute-render.js';
import {decodeRelief} from '../src/relief.js';
import {encodePNG} from './png.mjs';
import {HOMES} from '../src/home.js';
import fonts from '../data/draft-font.json' with {type:'json'};

const atlas=new Uint8Array(readFileSync('public/land.bin')),meters=decodeRelief(new Uint8Array(readFileSync('public/relief.bin')));
const zone='America/New_York',home=HOMES[zone];
mkdirSync('docs/screenshots',{recursive:true});

function contactSheet(study,scenes,styles,draw){
  const gap=24,label=18,sheetW=gap+styles.length*(W+gap),sheetH=gap+scenes.length*(H+gap+label),sheet=new Uint8ClampedArray(sheetW*sheetH*3);
  const paper=[235,233,224],ink=[31,59,58];
  for(let i=0;i<sheet.length;i+=3)sheet.set(paper,i);
  const text=(value,x,baseline)=>{
    for(const c of value){const g=fonts.small[c]||fonts.small['?'];for(const [rx,ry,len] of g.r)for(let k=0;k<len;k++)sheet.set(ink,((baseline-g.t+ry)*sheetW+x+g.l+rx+k)*3);x+=g.a;}
  };
  scenes.forEach((scene,row)=>styles.forEach(([style,name],col)=>{
    const buf=draw(scene,style);
    writeFileSync(`docs/screenshots/${study}-${scene.name}-${style}.png`,encodePNG(buf,W,H));
    const x0=gap+col*(W+gap),y0=gap+row*(H+gap+label)+label;
    text(`${scene.caption} / ${name.toUpperCase()}`,x0,y0-8);
    for(let y=0;y<H;y++)sheet.set(buf.subarray(y*W*3,(y+1)*W*3),((y0+y)*sheetW+x0)*3);
  }));
  writeFileSync(`docs/screenshots/${study}-contact-sheet.png`,encodePNG(sheet,sheetW,sheetH));
  writeFileSync(`docs/screenshots/${study}-${scenes[0].name}-2x.png`,encodePNG(draw(scenes[0],styles[0][0]),W,H,2));
  return scenes.length*styles.length;
}

const chart=contactSheet('study-05',[
  {name:'sun',caption:'SUN / 04:24',body:'sun',epoch:Date.parse('2026-09-27T08:24:00Z')},
  {name:'moon-day',caption:'MOON BY DAY / 04:24',body:'moon',epoch:Date.parse('2026-09-17T08:24:00Z')},
  {name:'moon-dusk',caption:'MOON AT NIGHTFALL / 05:24',body:'moon',epoch:Date.parse('2026-09-19T09:24:00Z')},
  {name:'iss',caption:'ISS ARCHIVE / 08:24',body:'iss',epoch:Date.parse('2019-06-05T12:24:00Z')}
],Object.entries(CHARTS).map(([k,v])=>[k,v.name]),(scene,theme)=>new ChartRenderer(atlas).render({body:scene.body,epoch:scene.epoch,timeZone:zone,clock24:false,theme}).buf);

const enroute=contactSheet('study-06',[
  {name:'sun',caption:'SUN / 04:24',body:'sun',epoch:Date.parse('2026-09-27T08:24:00Z')},
  {name:'moon-day',caption:'MOON BY DAY / 08:24',body:'moon',epoch:Date.parse('2026-09-15T12:24:00Z')},
  {name:'moon-dusk',caption:'MOON AT NIGHTFALL / 05:24',body:'moon',epoch:Date.parse('2026-09-19T09:24:00Z')},
  {name:'iss',caption:'ISS ARCHIVE / 08:24',body:'iss',epoch:Date.parse('2019-06-05T12:24:00Z')}
],Object.entries(PLATES).map(([k,v])=>[k,v.name]),(scene,plate)=>new EnrouteRenderer(atlas,meters).render({body:scene.body,epoch:scene.epoch,timeZone:zone,clock24:false,plate,home}).buf);

// Spike: the same faces on a rolling Fuller sheet.
const fuller=contactSheet('study-06-fuller',[
  {name:'iss',caption:'ISS ARCHIVE / 08:24',body:'iss',epoch:Date.parse('2019-06-05T12:24:00Z')},
  {name:'iss-later',caption:'ISS ARCHIVE / 09:24',body:'iss',epoch:Date.parse('2019-06-05T13:24:00Z')},
  {name:'sun',caption:'SUN / 04:24',body:'sun',epoch:Date.parse('2026-09-27T08:24:00Z')},
  {name:'moon-day',caption:'MOON BY DAY / 08:24',body:'moon',epoch:Date.parse('2026-09-15T12:24:00Z')}
],Object.entries(PLATES).map(([k,v])=>[k,v.name]),(scene,plate)=>new EnrouteRenderer(atlas,meters).render({body:scene.body,epoch:scene.epoch,timeZone:zone,clock24:false,plate,projection:'fuller',home}).buf);

console.log(`Wrote ${chart} Study 05, ${enroute} Study 06 and ${fuller} rolling-Fuller native proofs, three contact sheets and three 2x enlargements.`);
