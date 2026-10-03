import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PLATES,CONTOURS,ACQUISITION,SCALE,W,H} from '../src/plates.js';
import {localDate} from '../src/chart-text.js';
import {decodeRelief,reliefAt,reliefMeters,RELIEF_BYTES} from '../src/relief.js';
import {civilHour} from '../src/chart-render.js';
import {MINUTE} from '../src/ephemeris.js';
import meta from '../data/relief.json' with {type:'json'};
import {renderer,theCore} from './core-fixture.mjs';
import {MEASURE} from '../src/core.js';

const atlas=new Uint8Array(readFileSync('public/land.bin')),bytes=new Uint8Array(readFileSync('public/relief.bin')),meters=decodeRelief(bytes);
const SUN=Date.parse('2026-09-27T08:24:00Z'),MOON_DAY=Date.parse('2026-09-15T12:24:00Z'),MOON_DUSK=Date.parse('2026-09-19T09:24:00Z'),ISS=Date.parse('2019-06-05T12:24:00Z');
const scene=(body,epoch,extra={})=>({body,epoch,timeZone:'America/New_York',clock24:false,plate:'enroute',...extra});
const draw=async state=>{const r=await renderer();return {r,out:r.render(state)};};
const disjoint=(a,b)=>a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y;
// The class plane's ground: water 0, land 1, space 2, land tints 3-7, depths 8-9.
const isLand=g=>g===1||(g>=3&&g<8);

test('the relief grid is public-domain ETOPO1 and GMTED2010, aligned with the coastline atlas',()=>{
  assert.equal(bytes.length,RELIEF_BYTES);assert.equal(meta.bytes,RELIEF_BYTES);
  assert.deepEqual(Object.keys(meta.imagerySources).sort(),['etopo1','gmted']);
  assert.equal(reliefMeters(0),-11000);assert.equal(reliefMeters(64),0);assert.equal(reliefMeters(255),8850);
  for(let c=1;c<256;c++)assert.ok(reliefMeters(c)>=reliefMeters(c-1));
  // Known places, allowing for quarter-degree averaging.
  assert.ok(reliefAt(meters,32,88)>4000,'Tibetan plateau');assert.ok(reliefAt(meters,-16,-69)>3000,'Altiplano');
  assert.ok(Math.abs(reliefAt(meters,52.3,5.3))<50,'Netherlands');assert.ok(reliefAt(meters,-3,-60)<200,'Amazon basin');
  assert.ok(reliefAt(meters,11.35,142.2)<-7000,'Mariana Trench');assert.ok(reliefAt(meters,30,-45)<-2000,'Atlantic floor');
  let land=0,agree=0;for(let i=0;i<RELIEF_BYTES;i++)if((atlas[i>>3]>>(i&7))&1){land++;if(meters[i]>=-20)agree++;}
  assert.ok(agree/land>.99,`${agree}/${land}`);
});

test('contours ring the high side of each level, on land only',async()=>{
  const {out}=await draw(scene('sun',Date.parse('2026-06-21T06:24:00Z'))),core=await theCore();
  let lines=0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const cls=core.classAt(out.slot,x,y);if(cls>>4!==1)continue;lines++;
    assert.ok(isLand(cls&15),`a contour at ${x},${y} off land`);
  }
  assert.ok(lines>200,'the Himalaya is contoured');
  assert.equal(CONTOURS.length,6);assert.ok(out.buf.length===W*H*3);
});

test('every pixel is a native RGB222 color, on every plate, body and clock format',async()=>{
  for(const [body,epoch] of [['sun',SUN],['moon',MOON_DUSK],['iss',ISS]])for(const plate of Object.keys(PLATES))for(const clock24 of [false,true]){
    const {out}=await draw(scene(body,epoch,{plate,clock24})),colors=new Set();
    for(let i=0;i<out.buf.length;i+=3){for(let k=0;k<3;k++)assert.equal(out.buf[i+k]%85,0);colors.add(out.buf.slice(i,i+3).join());}
    // (A plate of few inks, Graphite's four greys, draws few colours.)
    const inks=new Set(Object.values(PLATES[plate]).flatMap(v=>Array.isArray(v)?(Array.isArray(v[0])?v:[v]):[]).filter(c=>Array.isArray(c)&&c.length===3).map(c=>c.join()));
    assert.ok(colors.size>(PLATES[plate].mono?1:inks.size<6?2:5)&&colors.size<=64,`${body}/${plate}: ${colors.size}`);
  }
});

test('the time figure reads the hour and minute for a whole day and clears the rose and route',async()=>{
  for(const clock24 of [false,true]){
    const r=await renderer();
    for(let hour=0;hour<24;hour++)for(const minute of [0,7,38,59]){
      const epoch=Date.parse('2026-09-21T00:00:00Z')+hour*3600000+minute*60000,out=r.render(scene('sun',epoch,{timeZone:'UTC',clock24}));
      const name=h=>String(clock24?h%24:h%12||12);
      assert.equal(out.figure.hour,name(hour));assert.equal(out.figure.minute,String(minute).padStart(2,'0'));assert.equal(out.figure.next,name(hour+1));
      const {box,nextBox}=out.figure,rose={x:out.rose.x-out.rose.r,y:out.rose.y-out.rose.r-4,w:2*out.rose.r+1,h:2*out.rose.r+5};
      for(const b of [box,nextBox])assert.ok(b.x>=4&&b.x+b.w<=196&&b.y>=4&&b.y+b.h<=out.stationsOnRoute[0].y-8,JSON.stringify(b));
      assert.ok(disjoint(box,nextBox),'figures must not touch');assert.ok(disjoint(box,rose),`hour ${hour}: figure over the rose`);
    }
  }
});

test('the time scale reads like an instrument tape, running the way the route runs',async()=>{
  for(const [body,epoch] of [['sun',SUN],['moon',MOON_DUSK],['iss',ISS]]){
    const r=await renderer(),start=civilHour(epoch,'America/New_York');let last=null;
    for(let m=0;m<60;m++){
      const out=r.render(scene(body,start+m*MINUTE)),{index}=out.figure,[s0,s1]=out.stationsOnRoute,forward=s1.x>s0.x;
      // Even graduations from this hour's end: two pixels a minute over the
      // zoomed route, whose ends are the stations; three on the ISS band.
      const {x0,x1}=out.figure.scale,step=(x1-x0)/60;assert.ok(Number.isInteger(step));
      assert.equal(index.x,forward?x0+step*m:x1-step*m,`${body} ${m}`);
      if(!out.world){
        assert.deepEqual([x0,x1],[Math.min(s0.x,s1.x),Math.max(s0.x,s1.x)]);
        // The index stands over the body on the route.
        assert.ok(Math.abs(index.x-out.marker.x)<=2,`${body} ${m}: index ${index.x}, body ${out.marker.x}`);
      }
      if(last!==null)assert.equal(Math.sign(index.x-last),forward?1:-1);last=index.x;
      // This hour's figure stands at this hour's end, the next at the other.
      const {box,nextBox}=out.figure;assert.ok(forward?box.x<nextBox.x:box.x>nextBox.x);
      for(const b of [box,nextBox])assert.ok(b.y>=2&&b.y+b.h<index.y-6&&b.x>=4&&b.x+b.w<=196);
      // Each figure is centred over its own end mark.
      assert.ok(Math.abs(box.x+box.w/2-(forward?x0:x1))<=Math.max(3,box.x<6||box.x+box.w>194?20:3));
      assert.equal(out.figure.readout,null);
    }
  }
  const on=(await draw(scene('sun',SUN,{readout:true}))).out;
  // The time callout hangs below the route, clear of the hour figures and
  // the date line, and reads the time in full.
  assert.equal(on.figure.time,'4:24');
  assert.ok(on.figure.readout.y>=on.figure.index.y+26&&on.figure.readout.y+on.figure.readout.h<=H-12);
  for(const b of [on.figure.box,on.figure.nextBox])assert.ok(disjoint(on.figure.readout,b));
  // On the world band nothing hides under the scale's panel.
  const band=await draw(scene('iss',ISS));for(const s of band.out.stations)assert.ok(s.y>SCALE.panel);
});

test('the margin date is local, with the day of the year',()=>{
  assert.deepEqual(localDate(SUN,'America/New_York'),{year:2026,month:9,day:27,dayOfYear:270});
  assert.equal(localDate(Date.parse('2026-01-01T12:00:00Z'),'UTC').dayOfYear,1);
  assert.equal(localDate(Date.parse('2024-12-31T12:00:00Z'),'UTC').dayOfYear,366);
  assert.deepEqual(localDate(Date.parse('2026-03-01T02:00:00Z'),'America/New_York'),{year:2026,month:2,day:28,dayOfYear:59});
  assert.equal(localDate(Date.parse('2026-12-31T20:00:00Z'),'Asia/Kolkata').year,2027);
});

test('the marker travels from this hour toward the next',async()=>{
  for(const [body,epoch] of [['sun',SUN],['moon',MOON_DUSK],['iss',ISS]]){
    const r=await renderer(),start=civilHour(epoch,'America/New_York');let last=-1;
    for(let m=0;m<60;m++){
      const out=r.render(scene(body,start+m*MINUTE)),route=r.camera.track.filter(p=>p.hour);
      const index=route.reduce((best,p,i)=>Math.hypot(p.x-out.marker.x,p.y-out.marker.y)<Math.hypot(route[best].x-out.marker.x,route[best].y-out.marker.y)?i:best,0);
      assert.ok(index>=last,`${body} ${m}`);last=index;
    }
  }
});

test('tracking stations appear where they stood, labelled without collisions',async()=>{
  const codes=out=>out.stations.map(s=>s.code);
  assert.ok(codes((await draw(scene('moon',MOON_DAY))).out).includes('TAN'),'Tananarive, Madagascar');
  assert.ok(codes((await draw(scene('sun',SUN))).out).includes('ZZB'),'Zanzibar');
  const iss=(await draw(scene('iss',ISS))).out;assert.ok(iss.stations.length>=5);
  for(const out of [iss,(await draw(scene('moon',MOON_DAY))).out])out.stations.forEach((a,i)=>out.stations.slice(i+1).forEach(b=>assert.ok(disjoint(a.box,b.box),`${a.code}/${b.code}`)));
  // A 410 km orbit clears a five-degree mask about 15.6 degrees from a station.
  assert.ok(Math.abs(ACQUISITION-15.6)<.1,String(ACQUISITION));
});

test('paper plates print night as a dot screen that deepens through twilight',async()=>{
  const state=scene('moon',MOON_DUSK,{plate:'sectional'}),{r,out}=await draw(state),core=await theCore(),ink=PLATES.sectional.screen.join();
  // Day and night as a zoned plate (Console) sees the same hour.
  const board=r.render({...state,plate:'console'});
  const bands={day:[0,0],night:[0,0]};
  for(let y=4;y<H-4;y++)for(let x=4;x<W-4;x++){
    const i=y*W+x;if(Math.abs(y-r.camera.stations[0].y)<50)continue;
    // Lettering knocks the screen out; measure the open chart only.
    if([out.figure.box,out.figure.nextBox,...out.stations.map(s=>s.box)].some(b=>x>=b.x-2&&x<b.x+b.w+2&&y>=b.y-2&&y<b.y+b.h+2))continue;
    const z=core.zoneAt(board.slot,board.minute,x,y),band=z===0?'day':z===2?'night':null;if(!band)continue;
    bands[band][0]++;if(out.buf.slice(i*3,i*3+3).join()===ink)bands[band][1]++;
  }
  assert.ok(bands.day[1]/bands.day[0]<.01,`day ${bands.day}`);
  assert.ok(Math.abs(bands.night[1]/bands.night[0]-.25)<.04,`night ${bands.night}`);
  // The Console plate keeps flat light zones instead.
  assert.ok(bands.night[0]>0);assert.notDeepEqual(board.buf,out.buf);
});

test('the ISS gets the world band, with its archive noted',async()=>{
  const {r,out}=await draw(scene('iss',ISS));
  assert.equal(out.world,true);assert.equal(out.rose,null);
  assert.ok(out.figure.box.y+out.figure.box.h<r.camera.band.top&&out.figure.nextBox.y+out.figure.nextBox.h<r.camera.band.top);
  await assert.rejects(draw(scene('iss',ISS+4*86400000)),RangeError);
});

test('scenes follow the clock: an hour built once is drawn again at once, another plate is another scene',async()=>{
  const r=await renderer(),state=scene('moon',MOON_DUSK,{plate:'red'});r.render(state);const first={...r.stats};
  r.render(state);assert.equal(r.stats.geometryBuilds,first.geometryBuilds);assert.equal(r.stats.renders,first.renders+1);
  r.render({...state,epoch:state.epoch+MINUTE});assert.equal(r.stats.geometryBuilds,first.geometryBuilds);
  r.render({...state,plate:'hypsometric'});assert.equal(r.stats.geometryBuilds,first.geometryBuilds+1);
  r.render({...state,epoch:state.epoch+60*MINUTE});assert.equal(r.stats.geometryBuilds,first.geometryBuilds+2);
});

test('the dark plates draw the terminator: dashed at sunset, dotted where twilight ends',async()=>{
  // Terminator ink appears at nightfall and never in full daylight.
  // Counted over the ground only: on Night red the terminator's ink is the
  // lettering's too.
  const core=await theCore();
  const inked=async(state,plate)=>{
    const {out}=await draw(scene(...state,{plate})),ink=PLATES[plate].terminator.join();
    // The open chart: ground pixels off the margins, the body and Zulu time.
    const boxes=[core.measure(out.slot,out.minute,MEASURE.body),out.zulu.box].filter(Boolean),inside=(x,y)=>boxes.some(b=>x>=b.x-1&&x<b.x+b.w+1&&y>=b.y-1&&y<b.y+b.h+1);
    let n=0;for(let y=14;y<H-16;y++)for(let x=0;x<W;x++)if((core.classAt(out.slot,x,y)>>4)<=4&&!inside(x,y)&&out.buf.slice((y*W+x)*3,(y*W+x)*3+3).join()===ink)n++;
    return n;};
  for(const plate of ['red','crt']){
    assert.ok(await inked(['moon',MOON_DUSK],plate)>100,plate);
    assert.equal(await inked(['sun',SUN],plate),0,plate);
  }
});

test('Zulu time sits in the bottom margin, clear of the date and the pass',async()=>{
  const {HOMES}=await import('../src/home.js');
  for(const [body,epoch,projection,home] of [['sun',SUN,'chart',null],['moon',MOON_DUSK,'fuller',HOMES.UTC],['iss',ISS,'chart',HOMES['Europe/London']],['iss',ISS,'chart',null],['iss',ISS+3600000,'fuller',HOMES['America/New_York']]]){
    const r=await renderer(),out=r.render({body,epoch,timeZone:'Asia/Kolkata',clock24:false,plate:'enroute',projection,home});
    const d=new Date(epoch);assert.equal(out.zulu.text,`${String(d.getUTCHours()).padStart(2,'0')}${String(d.getUTCMinutes()).padStart(2,'0')}Z`);
    const z=out.zulu.box;assert.ok(z.y>=H-14&&z.y+z.h<=H&&z.x>=6&&z.x+z.w<=W-6,`${body} ${projection}`);
    for(const b of out.margins)assert.ok(disjoint(z,{x:b.x-3,y:b.y,w:b.w+6,h:b.h}),`${body} ${projection}: Zulu touches the margin`);
  }
});
