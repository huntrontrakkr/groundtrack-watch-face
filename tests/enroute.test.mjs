import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EnrouteRenderer,renderEnroute,reliefLayer,contourLevel,localDate,PLATES,CONTOURS,ACQUISITION,SCALE,SPAN,W,H} from '../src/enroute-render.js';
import {decodeRelief,reliefAt,reliefMeters,RELIEF_BYTES} from '../src/relief.js';
import {chartCamera,groundLayer,lightLayer,civilHour,LAND} from '../src/chart-render.js';
import {position,MINUTE} from '../src/ephemeris.js';
import {dot} from '../src/geometry.js';
import {SUNRISE_SINE,CIVIL_TWILIGHT_SINE} from '../src/solar.js';
import meta from '../data/relief.json' with {type:'json'};

const atlas=new Uint8Array(readFileSync('public/land.bin')),bytes=new Uint8Array(readFileSync('public/relief.bin')),meters=decodeRelief(bytes);
const SUN=Date.parse('2026-09-27T08:24:00Z'),MOON_DAY=Date.parse('2026-09-15T12:24:00Z'),MOON_DUSK=Date.parse('2026-09-19T09:24:00Z'),ISS=Date.parse('2019-06-05T12:24:00Z');
const scene=(body,epoch,extra={})=>({body,epoch,timeZone:'America/New_York',clock24:false,plate:'enroute',...extra});
const draw=state=>{const r=new EnrouteRenderer(atlas,meters);return {r,out:r.render(state)};};
const disjoint=(a,b)=>a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y;

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

test('contours ring the high side of each level, on land only, with the lowest dotted',()=>{
  const {r,out}=draw(scene('sun',Date.parse('2026-06-21T06:24:00Z')));
  const land=r.ground.material.map(m=>m===LAND?1:0);let lines=0;
  for(let i=0;i<W*H;i++){
    const level=contourLevel(r.relief,land,i);if(!level)continue;lines++;
    assert.equal(land[i],1);assert.ok(r.relief[i]>=level);
    assert.ok([i-1,i+1,i-W,i+W].some(j=>land[j]&&r.relief[j]<level),'a contour borders lower ground');
  }
  assert.ok(lines>200,'the Himalaya is contoured');
  // Synthetic cone: one ring per level, none in the sea.
  const cone=new Float32Array(W*H),flat=new Uint8Array(W*H).fill(1);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)cone[y*W+x]=6000-60*Math.hypot(x-100,y-114);
  const found=new Set();for(let i=0;i<W*H;i++){const l=contourLevel(cone,flat,i);if(l)found.add(l);}
  assert.deepEqual([...found].sort((a,b)=>a-b),CONTOURS);
  assert.equal(contourLevel(cone,new Uint8Array(W*H),100*W+100),0);
  assert.ok(out.buf.length===W*H*3);
});

test('every pixel is a native RGB222 color, on every plate, body and clock format',()=>{
  for(const [body,epoch] of [['sun',SUN],['moon',MOON_DUSK],['iss',ISS]])for(const plate of Object.keys(PLATES))for(const clock24 of [false,true]){
    const {out}=draw(scene(body,epoch,{plate,clock24})),colors=new Set();
    for(let i=0;i<out.buf.length;i+=3){for(let k=0;k<3;k++)assert.equal(out.buf[i+k]%85,0);colors.add(out.buf.slice(i,i+3).join());}
    assert.ok(colors.size>(PLATES[plate].mono?1:5)&&colors.size<=64,`${body}/${plate}: ${colors.size}`);
  }
});

test('the time figure reads the hour and minute for a whole day and clears the rose and route',()=>{
  for(const clock24 of [false,true]){
    const r=new EnrouteRenderer(atlas,meters);
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

test('the time scale reads like an instrument tape, running the way the route runs',()=>{
  for(const [body,epoch] of [['sun',SUN],['moon',MOON_DUSK],['iss',ISS]]){
    const r=new EnrouteRenderer(atlas,meters),start=civilHour(epoch,'America/New_York');let last=null;
    for(let m=0;m<60;m++){
      const out=r.render(scene(body,start+m*MINUTE)),{index}=out.figure,[s0,s1]=out.stationsOnRoute,forward=s1.x>s0.x;
      // Even graduations from this hour's end: two pixels a minute over the
      // zoomed route, whose ends are the stations; three on the ISS band.
      const {x0,x1}=out.figure.scale,step=(x1-x0)/60;assert.ok(Number.isInteger(step));
      assert.equal(index.x,forward?x0+step*m:x1-step*m,`${body} ${m}`);
      if(!out.world){
        assert.deepEqual([x0,x1],[Math.min(s0.x,s1.x),Math.max(s0.x,s1.x)].map(Math.round));
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
  const on=draw(scene('sun',SUN,{readout:true})).out;
  // The time callout hangs below the route, clear of the hour figures and
  // the date line, and reads the time in full.
  assert.equal(on.figure.time,'4:24');
  assert.ok(on.figure.readout.y>=on.figure.index.y+26&&on.figure.readout.y+on.figure.readout.h<=H-12);
  for(const b of [on.figure.box,on.figure.nextBox])assert.ok(disjoint(on.figure.readout,b));
  // On the world band nothing hides under the scale's panel.
  const band=draw(scene('iss',ISS));for(const s of band.out.stations)assert.ok(s.y>SCALE.panel);
});

test('the margin date is local, with the day of the year',()=>{
  assert.deepEqual(localDate(SUN,'America/New_York'),{year:2026,month:9,day:27,dayOfYear:270});
  assert.equal(localDate(Date.parse('2026-01-01T12:00:00Z'),'UTC').dayOfYear,1);
  assert.equal(localDate(Date.parse('2024-12-31T12:00:00Z'),'UTC').dayOfYear,366);
  assert.deepEqual(localDate(Date.parse('2026-03-01T02:00:00Z'),'America/New_York'),{year:2026,month:2,day:28,dayOfYear:59});
  assert.equal(localDate(Date.parse('2026-12-31T20:00:00Z'),'Asia/Kolkata').year,2027);
});

test('the marker travels from this hour toward the next',()=>{
  for(const [body,epoch] of [['sun',SUN],['moon',MOON_DUSK],['iss',ISS]]){
    const r=new EnrouteRenderer(atlas,meters),start=civilHour(epoch,'America/New_York');let last=-1;
    for(let m=0;m<60;m++){
      const out=r.render(scene(body,start+m*MINUTE)),route=r.camera.track.filter(p=>p.hour);
      const index=route.reduce((best,p,i)=>Math.hypot(p.x-out.marker.x,p.y-out.marker.y)<Math.hypot(route[best].x-out.marker.x,route[best].y-out.marker.y)?i:best,0);
      assert.ok(index>=last,`${body} ${m}`);last=index;
    }
  }
});

test('tracking stations appear where they stood, labelled without collisions',()=>{
  const codes=out=>out.stations.map(s=>s.code);
  assert.ok(codes(draw(scene('moon',MOON_DAY)).out).includes('TAN'),'Tananarive, Madagascar');
  assert.ok(codes(draw(scene('sun',SUN)).out).includes('ZZB'),'Zanzibar');
  const iss=draw(scene('iss',ISS)).out;assert.ok(iss.stations.length>=5);
  for(const out of [iss,draw(scene('moon',MOON_DAY)).out])out.stations.forEach((a,i)=>out.stations.slice(i+1).forEach(b=>assert.ok(disjoint(a.box,b.box),`${a.code}/${b.code}`)));
  // A 410 km orbit clears a five-degree mask about 15.6 degrees from a station.
  assert.ok(Math.abs(ACQUISITION-15.6)<.1,String(ACQUISITION));
});

test('paper plates print night as a dot screen that deepens through twilight',()=>{
  const state=scene('moon',MOON_DUSK,{plate:'sectional'}),{r,out}=draw(state),sun=position('sun',state.epoch).dir,ink=PLATES.sectional.screen.join();
  const bands={day:[0,0],night:[0,0]};
  for(let y=4;y<H-4;y++)for(let x=4;x<W-4;x++){
    const i=y*W+x;if(Math.abs(y-r.camera.stations[0].y)<50)continue;
    // Lettering knocks the screen out; measure the open chart only.
    if([out.figure.box,out.figure.nextBox,...out.stations.map(s=>s.box)].some(b=>x>=b.x-2&&x<b.x+b.w+2&&y>=b.y-2&&y<b.y+b.h+2))continue;
    const a=dot(r.ground.dirs[i],sun),band=a>=SUNRISE_SINE?'day':a<CIVIL_TWILIGHT_SINE?'night':null;if(!band)continue;
    bands[band][0]++;if(out.buf.slice(i*3,i*3+3).join()===ink)bands[band][1]++;
  }
  assert.ok(bands.day[1]/bands.day[0]<.01,`day ${bands.day}`);
  assert.ok(Math.abs(bands.night[1]/bands.night[0]-.25)<.04,`night ${bands.night}`);
  // The Console plate keeps flat light zones instead.
  const board=draw({...state,plate:'console'}).out,zones=lightLayer(r.ground,state.epoch);
  assert.ok(zones.some(z=>z===2));assert.notDeepEqual(board.buf,out.buf);
});

test('the ISS gets the world band, with its archive noted',()=>{
  const {r,out}=draw(scene('iss',ISS));
  assert.equal(out.world,true);assert.equal(out.rose,null);
  assert.ok(out.figure.box.y+out.figure.box.h<r.camera.band.top&&out.figure.nextBox.y+out.figure.nextBox.h<r.camera.band.top);
  assert.throws(()=>draw(scene('iss',ISS+3*86400000)),RangeError);
});

test('caches follow the clock: chart by the hour, light by the minute, plate last',()=>{
  const r=new EnrouteRenderer(atlas,meters),state=scene('moon',MOON_DUSK);r.render(state);const first={...r.stats};
  r.render(state);assert.deepEqual(r.stats,first);
  r.render({...state,epoch:state.epoch+MINUTE});assert.equal(r.stats.geometryBuilds,first.geometryBuilds);assert.equal(r.stats.lightBuilds,first.lightBuilds+1);
  const minute={...r.stats};r.render({...state,epoch:state.epoch+MINUTE,plate:'console'});assert.equal(r.stats.lightBuilds,minute.lightBuilds);assert.equal(r.stats.renders,minute.renders+1);
  r.render({...state,epoch:state.epoch+60*MINUTE});assert.equal(r.stats.geometryBuilds,first.geometryBuilds+1);
  // A standalone render of the cached layers matches the renderer.
  const camera=chartCamera('moon',civilHour(state.epoch,state.timeZone),{span:SPAN}),ground=groundLayer(camera,atlas);
  const direct=renderEnroute({camera,ground,relief:reliefLayer(camera,meters),light:lightLayer(ground,state.epoch),plate:'enroute',epoch:state.epoch,timeZone:state.timeZone,clock24:false});
  assert.deepEqual(direct.buf,new EnrouteRenderer(atlas,meters).render(state).buf);
});

test('the dark plates draw the terminator: dashed at sunset, dotted where twilight ends',()=>{
  // Each scene drawn with and without the terminator: it adds a line at
  // nightfall and nothing in full daylight.
  const changed=(state,plate)=>{
    const pal=PLATES[plate],keep=pal.terminator,dots=pal.nightDots,a=draw(scene(...state,{plate})).out.buf;
    pal.terminator=null;pal.nightDots=null;let b;try{b=draw(scene(...state,{plate})).out.buf;}finally{pal.terminator=keep;pal.nightDots=dots;}
    let n=0;for(let i=0;i<a.length;i+=3)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2])n++;return n;
  };
  for(const plate of ['red','crt']){
    assert.ok(changed(['moon',MOON_DUSK],plate)>100,plate);
    assert.equal(changed(['sun',SUN],plate),0,plate);
  }
});

test('Zulu time sits in the bottom margin, clear of the date and the pass',async()=>{
  const {HOMES}=await import('../src/home.js');
  for(const [body,epoch,projection,home] of [['sun',SUN,'chart',null],['moon',MOON_DUSK,'fuller',HOMES.UTC],['iss',ISS,'chart',HOMES['Europe/London']],['iss',ISS,'chart',null],['iss',ISS+3600000,'fuller',HOMES['America/New_York']]]){
    const r=new EnrouteRenderer(atlas,meters),out=r.render({body,epoch,timeZone:'Asia/Kolkata',clock24:false,plate:'enroute',projection,home});
    const d=new Date(epoch);assert.equal(out.zulu.text,`${String(d.getUTCHours()).padStart(2,'0')}${String(d.getUTCMinutes()).padStart(2,'0')}Z`);
    const z=out.zulu.box;assert.ok(z.y>=H-14&&z.y+z.h<=H&&z.x>=6&&z.x+z.w<=W-6,`${body} ${projection}`);
    for(const b of out.margins)assert.ok(disjoint(z,{x:b.x-3,y:b.y,w:b.w+6,h:b.h}),`${body} ${projection}: Zulu touches the margin`);
  }
});
