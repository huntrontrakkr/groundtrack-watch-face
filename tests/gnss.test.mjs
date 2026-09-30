import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STUDY_ORBITS,registerNominal} from '../src/nominal.js';
import {parseTLE,viewOf,elementsFor,bodyId} from '../src/satellites.js';
import {position,MINUTE} from '../src/ephemeris.js';
import {EnrouteRenderer,W,H} from '../src/enroute-render.js';
import {decodeRelief} from '../src/relief.js';

registerNominal();
const atlas=new Uint8Array(readFileSync('public/land.bin')),meters=decodeRelief(new Uint8Array(readFileSync('public/relief.bin')));
const GPS='sat:36585',QZS='sat:42738',DAY=Date.parse('2026-09-27T00:00:00Z');
const overlap=(a,b)=>!(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y);

test('the nominal orbits are valid element sets of the right classes, and labelled nominal',()=>{
  for(const o of STUDY_ORBITS){const t=parseTLE(o.text);assert.equal(t.norad,o.norad);assert.equal(elementsFor(bodyId(o.norad)).source,'nominal');}
  assert.deepEqual([viewOf('sun'),viewOf('moon'),viewOf('iss'),viewOf('sat:25544'),viewOf(GPS),viewOf(QZS)],['hour','hour','world','world','hour','day']);
  // GPS: 20,200 km, tilted 55°. QZSS: a day's figure-8 about 41° north and
  // south, centred near 139°E.
  const g=[0,3,6,9].map(h=>position(GPS,DAY+h*3600000));for(const p of g)assert.ok(Math.abs(p.altitude-20200)<400&&Math.abs(p.lat)<=55.5);
  const q=Array.from({length:97},(_,i)=>position(QZS,DAY+i*15*MINUTE)),lats=q.map(p=>p.lat),lons=q.map(p=>(p.lon+360)%360);
  assert.ok(Math.max(...lats)>39&&Math.min(...lats)<-39&&Math.max(...lons)-Math.min(...lons)<40&&Math.abs((Math.max(...lons)+Math.min(...lons))/2-139)<8);
});

test('GPS stands on the hour chart: stations a route apart in any direction, figures clear of the rose',()=>{
  const r=new EnrouteRenderer(atlas,meters);
  for(let h=0;h<12;h++){
    const out=r.render({body:GPS,epoch:DAY+h*3600000+24*MINUTE,timeZone:'UTC',clock24:false,plate:'enroute'}),[s0,s1]=r.camera.stations;
    assert.equal(out.world,false);assert.ok(Math.abs(Math.hypot(s1.x-s0.x,s1.y-s0.y)-120)<1,`hour ${h}`);
    const {box,nextBox}=out.figure;
    for(const b of [box,nextBox]){assert.ok(b.x>=4&&b.x+b.w<=W-4&&b.y>=4&&b.y+b.h<=H-16,`hour ${h}`);}
    // The figure stands off the rose round this hour's station.
    const cx=Math.max(box.x,Math.min(s0.x,box.x+box.w)),cy=Math.max(box.y,Math.min(s0.y,box.y+box.h));
    assert.ok(Math.hypot(cx-s0.x,cy-s0.y)>=20||box.y<14||box.y+box.h>H-30,`hour ${h}: figure on the rose`);
  }
});

test('QZSS draws its day on one chart, the time set aside, crossing labels giving way',()=>{
  const r=new EnrouteRenderer(atlas,meters);
  for(const h of [1,5,11,14,20]){
    const out=r.render({body:QZS,epoch:DAY+h*3600000+24*MINUTE,timeZone:'Asia/Tokyo',clock24:false,plate:'enroute'}),cam=r.camera;
    assert.equal(cam.day.hours.length,25);
    const xs=cam.track.map(p=>p.x),ys=cam.track.map(p=>p.y);assert.ok(Math.min(...xs)>=W/2-20&&Math.max(...xs)<=W-4&&Math.min(...ys)>=14&&Math.max(...ys)<=H-16);
    // The callout stands in the open map left of the track.
    assert.ok(out.figure.box.x+out.figure.box.w<Math.min(...xs),`hour ${h}`);assert.match(out.figure.time,/^\d{1,2}:\d\d$/);
  }
});
