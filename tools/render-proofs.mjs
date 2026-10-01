// Study 05 and Study 06 proofs rendered in Node, without a browser: the same
// renderers the pages use, written as native-size PNGs, one captioned
// contact sheet per study and a 2x enlargement of each default face.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {ChartRenderer,CHARTS,W,H} from '../src/chart-render.js';
import {PLATES,NUMERALS,FIGURE_SETS} from '../src/plates.js';
import {loadCore,CoreRenderer} from '../src/core.js';
import {encodePNG} from './png.mjs';
import {HOMES} from '../src/home.js';
import {registerNominal} from '../src/nominal.js';
registerNominal();
import {STUDY_EVENTS as events} from '../src/events.js';
import fonts from '../data/draft-font.json' with {type:'json'};

// The core, the watch's own code, draws Study 06's proofs.
const read=f=>new Uint8Array(readFileSync(f)),core=await loadCore({wasm:read('public/core.wasm'),map:read('native/resources/map.pack'),figures:read('native/resources/figures.bin'),tables:read('native/resources/tables.bin'),grids:read('public/fuller.bin'),land:read('native/resources/land.pack')});
const atlas=read('public/land.bin'),meters=(await import('../src/relief.js')).decodeRelief(read('public/relief.bin'));
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
],Object.entries(PLATES).map(([k,v])=>[k,v.name]),(scene,plate)=>new CoreRenderer(core).render({body:scene.body,epoch:scene.epoch,timeZone:zone,clock24:true,numerals:'even',plate,home,events}).buf);

// Spike: the same faces on a rolling Fuller sheet.
const fuller=contactSheet('study-06-fuller',[
  {name:'iss',caption:'ISS ARCHIVE / 08:24',body:'iss',epoch:Date.parse('2019-06-05T12:24:00Z')},
  {name:'iss-later',caption:'ISS ARCHIVE / 09:24',body:'iss',epoch:Date.parse('2019-06-05T13:24:00Z')},
  {name:'sun',caption:'SUN / 04:24',body:'sun',epoch:Date.parse('2026-09-27T08:24:00Z')},
  {name:'moon-day',caption:'MOON BY DAY / 08:24',body:'moon',epoch:Date.parse('2026-09-15T12:24:00Z')}
],Object.entries(PLATES).map(([k,v])=>[k,v.name]),(scene,plate)=>new CoreRenderer(core).render({body:scene.body,epoch:scene.epoch,timeZone:zone,clock24:true,numerals:'even',plate,projection:'fuller',home,events}).buf);

// Experiment: the satellite scale as a sliding tape, the world sliding too.
const tape=contactSheet('study-06-tape',[
  {name:'05',caption:'ISS / 08:05',body:'iss',epoch:Date.parse('2019-06-05T12:05:00Z')},
  {name:'24',caption:'ISS / 08:24',body:'iss',epoch:Date.parse('2019-06-05T12:24:00Z')},
  {name:'47',caption:'ISS / 08:47',body:'iss',epoch:Date.parse('2019-06-05T12:47:00Z')},
  {name:'58',caption:'ISS / 08:58',body:'iss',epoch:Date.parse('2019-06-05T12:58:00Z')}
],['enroute','console','crt'].map(k=>[k,PLATES[k].name]),(scene,plate)=>new CoreRenderer(core).render({body:scene.body,epoch:scene.epoch,timeZone:zone,clock24:true,numerals:'even',plate,home,events,tape:'slide'}).buf);

// Slow orbits: nominal GPS on the hour chart, nominal QZSS's day.
const gnss=contactSheet('study-06-gnss',[
  {name:'gps',caption:'GPS / 09:24',body:'sat:36585',epoch:Date.parse('2026-09-27T13:24:00Z')},
  {name:'gps-later',caption:'GPS / 12:24',body:'sat:36585',epoch:Date.parse('2026-09-27T16:24:00Z')},
  {name:'qzss',caption:'QZSS DAY / 01:24',body:'sat:42738',epoch:Date.parse('2026-09-27T05:24:00Z')},
  {name:'qzss-later',caption:'QZSS DAY / 10:24',body:'sat:42738',epoch:Date.parse('2026-09-27T14:24:00Z')}
],['enroute','console','crt'].map(k=>[k,PLATES[k].name]),(scene,plate)=>new CoreRenderer(core).render({body:scene.body,epoch:scene.epoch,timeZone:zone,clock24:true,numerals:'even',plate,home,events}).buf);

// Workshop: the callout's time in each style, 24-hour.
const NAMES={colon:'colon',plain:'no colon',even:'four figures',mono:'departure',accent:'route ink'};
const numerals=contactSheet('study-06-numerals',[
  {name:'sun-day',caption:'SUN DAY / 14:24',body:'sun',epoch:Date.parse('2026-09-27T18:24:00Z'),projection:'fuller',plate:'enroute'},
  {name:'qzss',caption:'QZSS DAY / 14:24 JST',body:'sat:42738',epoch:Date.parse('2026-09-27T05:24:00Z'),plate:'console',timeZone:'Asia/Tokyo'},
  {name:'moon',caption:'MOON / 08:24',body:'moon',epoch:Date.parse('2026-09-15T12:24:00Z'),plate:'sectional',readout:true}
],NUMERALS.map(k=>[k,NAMES[k]]),(scene,style)=>new CoreRenderer(core).render({timeZone:zone,clock24:true,home,events,...scene,numerals:style}).buf);

// The minute flag across the hour.
const flag=contactSheet('study-06-flag',[4,24,44,58].map(m=>({name:`m${m}`,caption:`SUN / 04:${String(m).padStart(2,'0')}`,body:'sun',epoch:Date.parse('2026-09-27T08:00:00Z')+m*60000})),
  ['enroute','console','red'].map(k=>[k,PLATES[k].name]),(scene,plate)=>new CoreRenderer(core).render({body:scene.body,epoch:scene.epoch,timeZone:zone,clock24:true,plate,home,events,readout:'flag'}).buf);

// Plotboard's panel as a clock, in each of the callout's styles.
const clock=contactSheet('study-06-clock',[
  {name:'iss',caption:'ISS / 08:24',body:'iss',epoch:Date.parse('2019-06-05T12:24:00Z'),plate:'crt'},
  {name:'iss-12',caption:'ISS / 8:24, 12-HOUR',body:'iss',epoch:Date.parse('2019-06-05T12:24:00Z'),plate:'enroute',clock24:false}
],NUMERALS.map(k=>[k,NAMES[k]]),(scene,numerals)=>new CoreRenderer(core).render({timeZone:zone,clock24:true,home,events,...scene,numerals,tape:'clock'}).buf);

// The figure sets: each in the hour figures, a time callout, the world
// band's tape and a Fuller day's callout.
const figureSets=contactSheet('study-06-figures',[
  {name:'sun',caption:'SUN / 04:24',body:'sun',epoch:Date.parse('2026-09-27T08:24:00Z'),plate:'enroute',readout:'flag'},
  {name:'moon',caption:'MOON CALLOUT / 05:24',body:'moon',epoch:Date.parse('2026-09-19T09:24:00Z'),plate:'console',readout:'callout'},
  {name:'iss',caption:'ISS / 08:24',body:'iss',epoch:Date.parse('2019-06-05T12:24:00Z'),plate:'crt'},
  {name:'sun-day',caption:'SUN DAY / 14:24',body:'sun',epoch:Date.parse('2026-09-27T18:24:00Z'),plate:'odyssey',projection:'fuller'}
],FIGURE_SETS.map(([k,name])=>[k,name]),(scene,figures)=>new CoreRenderer(core).render({timeZone:zone,clock24:true,numerals:'even',home,events,...scene,figures}).buf);

console.log(`Wrote ${chart} Study 05, ${enroute} Study 06, ${fuller} rolling-Fuller, ${tape} tape, ${gnss} GPS/QZSS, ${numerals} numeral, ${flag} flag, ${figureSets} figure-set and ${clock} clock native proofs, nine contact sheets and nine 2x enlargements.`);
