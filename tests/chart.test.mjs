import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ChartRenderer,chartCamera,groundLayer,labelMask,shadowOffset,sunAt,civilHour,CHARTS,W,H,LAND,SPACE,DAY,DUSK,NIGHT,SPAN,TRACK_Y} from '../src/chart-render.js';
import {position,MINUTE} from '../src/ephemeris.js';
import {direction,dot} from '../src/geometry.js';
import {landAt} from '../src/render.js';
import {SUNRISE_SINE,CIVIL_TWILIGHT_SINE} from '../src/solar.js';

const atlas=new Uint8Array(readFileSync('public/land.bin'));
const SUN=Date.parse('2026-09-27T08:24:00Z'),MOON_DAY=Date.parse('2026-09-17T08:24:00Z'),MOON_DUSK=Date.parse('2026-09-19T09:24:00Z'),MOON_NIGHT=Date.parse('2026-09-20T10:24:00Z'),ISS=Date.parse('2019-06-05T12:24:00Z');
const scene=(body,epoch,extra={})=>({body,epoch,timeZone:'America/New_York',clock24:false,theme:'shore',...extra});
const draw=(state)=>{const r=new ChartRenderer(atlas);return {r,out:r.render(state)};};

test('every pixel is an opaque native RGB222 color, in every palette and view',()=>{
  for(const [body,epoch] of [['sun',SUN],['moon',MOON_DUSK],['iss',ISS]])for(const theme of Object.keys(CHARTS))for(const clock24 of [false,true]){
    const {out}=draw(scene(body,epoch,{theme,clock24})),colors=new Set();
    for(let i=0;i<out.buf.length;i++)assert.equal(out.buf[i]%85,0);
    for(let i=0;i<out.rgba.length;i+=4){assert.equal(out.rgba[i+3],255);colors.add(out.rgba.slice(i,i+3).join());}
    assert.ok(colors.size>4&&colors.size<=64,`${body}/${theme}: ${colors.size} colors`);
  }
});

test('north stays up and the hour stations sit one span apart on the route line',()=>{
  for(const [body,epoch] of [['sun',SUN],['moon',MOON_DAY]]){
    const camera=chartCamera(body,civilHour(epoch,'UTC')),[a,b]=camera.stations;
    assert.ok(Math.abs(Math.hypot(b.x-a.x,b.y-a.y)-SPAN)<1.5,`${body}: ${Math.hypot(b.x-a.x,b.y-a.y)}`);
    assert.ok(Math.abs((a.y+b.y)/2-TRACK_Y)<1);
    // Both bodies travel west: the next hour lies to the left.
    assert.ok(b.x<a.x);
    const p=camera.toGround(100,100),north=camera.toScreen(p.lat+1,p.lon),east=camera.toScreen(p.lat,p.lon+1);
    assert.ok(north.y<100&&Math.abs(north.x-100)<1e-9&&east.x>100&&Math.abs(east.y-100)<1e-9);
    for(const [x,y] of [[3,7],[100,114],[197,220]]){const g=camera.toGround(x,y),q=camera.toScreen(g.lat,g.lon);assert.ok(Math.hypot(q.x-x,q.y-y)<1e-9);}
  }
});

test('shorelines are smoothed from the atlas, not invented',()=>{
  for(const [body,epoch] of [['sun',SUN],['moon',MOON_DAY],['iss',ISS]]){
    const camera=chartCamera(body,civilHour(epoch,'UTC')),ground=groundLayer(camera,atlas);
    let smooth=0,nearest=0,n=0;
    for(let i=0;i<W*H;i++){if(ground.material[i]===SPACE)continue;n++;smooth+=ground.material[i]===LAND;nearest+=landAt(atlas,ground.dirs[i]);}
    assert.ok(Math.abs(smooth-nearest)/n<.02,`${body}: ${smooth} vs ${nearest}`);
  }
});

test('the numerals name this hour and the next, solid then outlined, clear of the route',()=>{
  for(const body of ['sun','moon'])for(const clock24 of [true,false]){
    const r=new ChartRenderer(atlas);
    for(let hour=0;hour<24;hour++){
      const out=r.render(scene(body,Date.parse('2026-09-21T00:24:00Z')+hour*3600000,{timeZone:'UTC',clock24}));
      const name=h=>String(clock24?h%24:h%12||12);
      assert.deepEqual(out.hours.map(h=>h.value),[name(hour),name(hour+1)]);
      assert.deepEqual(out.hours.map(h=>h.next),[false,true]);
      const [a,b]=out.hours.map(h=>h.box);
      for(const box of [a,b])assert.ok(box.x>=4&&box.x+box.w<=196&&box.y>=4&&box.y+box.h<=224,JSON.stringify(box));
      assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x,'numerals must not overlap');
      const route=r.camera.track.filter(p=>p.hour);
      for(const label of r.labels){
        const mask=labelMask(label,true);let nearest=Infinity;
        for(let i=0;i<W*H;i++)if(mask[i])for(const p of route)nearest=Math.min(nearest,Math.hypot(i%W-p.x,Math.floor(i/W)-p.y));
        assert.ok(nearest>=8,`${body} ${hour}: numeral ${label.text} is ${nearest.toFixed(1)}px from the route`);
      }
    }
  }
});

test('the marker moves from this hour toward the next and its minute stays readable',()=>{
  for(const [body,epoch] of [['sun',SUN],['moon',MOON_DUSK],['iss',ISS]]){
    const r=new ChartRenderer(atlas),start=civilHour(epoch,'America/New_York');let last=-1;
    for(let m=0;m<60;m++){
      const out=r.render(scene(body,start+m*MINUTE)),[s0,s1]=out.stations;
      // Progress is measured along the route's own samples.
      const route=r.camera.track.filter(p=>p.hour),index=route.reduce((best,p,i)=>Math.hypot(p.x-out.marker.x,p.y-out.marker.y)<Math.hypot(route[best].x-out.marker.x,route[best].y-out.marker.y)?i:best,0);
      assert.ok(index>=last,`${body} minute ${m} went backward`);last=index;
      if(body!=='iss')assert.ok(out.marker.x<=Math.max(s0.x,s1.x)+.5&&out.marker.x>=Math.min(s0.x,s1.x)-.5);
      const box=out.minuteBox;assert.ok(box.x>=1&&box.x+box.w<=199&&box.y>=0&&box.y+box.h<=228,`${body} ${m}: ${JSON.stringify(box)}`);
      for(const h of out.hours)assert.ok(box.x+box.w<=h.box.x||h.box.x+h.box.w<=box.x||box.y+box.h<=h.box.y||h.box.y+h.box.h<=box.y,`${body} ${m}: minute over numeral`);
    }
    const samples=r.camera.track.filter(p=>p.hour).length;assert.ok(last>=(samples-1)*59/60-2,`${body}: ended at ${last} of ${samples}`);
  }
});

test('half-hour time zones move the stations and the numerals with them',()=>{
  const start=civilHour(SUN,'Asia/Kolkata');
  assert.equal(new Date(start).toISOString(),'2026-09-27T07:30:00.000Z');
  assert.deepEqual(draw(scene('sun',SUN,{timeZone:'Asia/Kolkata'})).out.hours.map(h=>h.value),['1','2']);
  assert.deepEqual(draw(scene('sun',SUN,{timeZone:'Asia/Kolkata',clock24:true})).out.hours.map(h=>h.value),['13','14']);
  assert.deepEqual(draw(scene('sun',SUN,{timeZone:'UTC'})).out.hours.map(h=>h.value),['8','9']);
});

test('day, twilight and night come from the calculated Sun at the minute',()=>{
  assert.deepEqual(draw(scene('sun',SUN)).out.zones,[W*H,0,0]);
  const night=draw(scene('moon',MOON_NIGHT)).out.zones;assert.ok(night[NIGHT]>.9*W*H,String(night));
  const {r,out}=draw(scene('moon',MOON_DUSK));assert.ok(out.zones.every(z=>z>1000),String(out.zones));
  const sun=sunAt(MOON_DUSK);
  for(let i=0;i<W*H;i++){
    const a=dot(r.ground.dirs[i],sun),z=r.light[i];
    if(a>=SUNRISE_SINE)assert.equal(z,DAY);else if(a<CIVIL_TWILIGHT_SINE)assert.equal(z,NIGHT);else assert.ok(z===DUSK||z===NIGHT);
  }
  // The ordered screen is fixed in place; a repeat render is identical.
  assert.deepEqual(new ChartRenderer(atlas).render(scene('moon',MOON_DUSK)).buf,out.buf);
});

test('numeral shadows fall away from the Sun and vanish at night',()=>{
  const camera=chartCamera('sun',civilHour(SUN,'UTC')),sun=sunAt(SUN),below=position('sun',SUN);
  const p=camera.toScreen(below.lat,below.lon);assert.deepEqual(shadowOffset(camera,p.x,p.y,sun),{dx:0,dy:0});
  // Near the subsolar point a three-pixel numeral casts almost nothing.
  const near=camera.toScreen(below.lat,below.lon-8);assert.deepEqual(shadowOffset(camera,near.x,near.y,sun),{dx:0,dy:0});
  // Farther west the Sun is low in the east, so the shadow points west.
  const west=camera.toScreen(below.lat,below.lon-45),o=shadowOffset(camera,west.x,west.y,sun);assert.ok(o.dx<0&&Math.abs(o.dy)<=1,JSON.stringify(o));
  const far=chartCamera('moon',civilHour(MOON_NIGHT,'UTC')),g=far.toGround(100,100);
  assert.ok(dot(direction(g.lat,g.lon),sunAt(MOON_NIGHT))<0);assert.equal(shadowOffset(far,100,100,sunAt(MOON_NIGHT)),null);
});

test('the ISS gets the world, with its hours above the band',()=>{
  const {r,out}=draw(scene('iss',ISS));
  assert.equal(out.world,true);assert.ok(r.camera.band.top>70&&r.camera.band.bottom<=H-8);
  for(const h of out.hours)assert.ok(h.box.y>=4&&h.box.y+h.box.h<r.camera.band.top);
  for(const s of out.stations)assert.ok(s.x>=4&&s.x<=196&&s.y>=r.camera.band.top&&s.y<=r.camera.band.bottom);
  assert.throws(()=>draw(scene('iss',ISS+3*86400000)),RangeError);
});

test('caches follow the clock: hour geometry, minute light, then palette',()=>{
  const r=new ChartRenderer(atlas),state=scene('moon',MOON_DUSK);r.render(state);
  const first={...r.stats};
  r.render(state);assert.deepEqual(r.stats,first,'an identical request draws nothing');
  r.render({...state,epoch:state.epoch+MINUTE});assert.equal(r.stats.geometryBuilds,first.geometryBuilds);assert.equal(r.stats.lightBuilds,first.lightBuilds+1);
  const minute={...r.stats};r.render({...state,epoch:state.epoch+MINUTE,theme:'survey'});
  assert.equal(r.stats.lightBuilds,minute.lightBuilds);assert.equal(r.stats.renders,minute.renders+1);
  r.render({...state,epoch:state.epoch+60*MINUTE});assert.equal(r.stats.geometryBuilds,first.geometryBuilds+1);
});
