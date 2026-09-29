import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rollCamera,W,H} from '../src/roll.js';
import {NEIGHBORS,F} from '../src/fuller.js';
import {EnrouteRenderer} from '../src/enroute-render.js';
import {decodeRelief} from '../src/relief.js';
import {civilHour} from '../src/chart-render.js';
import {angularDistance,direction} from '../src/geometry.js';

const ISS=Date.parse('2019-06-05T12:24:00Z'),SUN=Date.parse('2026-09-27T08:24:00Z');

test('the rolled route is continuous: it never crosses a cut',()=>{
  for(const [body,epoch] of [['iss',ISS],['iss',ISS-10*3600000],['sun',SUN],['moon',Date.parse('2026-09-15T12:24:00Z')]]){
    const cam=rollCamera(body,civilHour(epoch,'UTC'));
    for(let i=1;i<cam.track.length;i++){
      const a=cam.track[i-1],b=cam.track[i];
      assert.ok(Math.hypot(b.x-a.x,b.y-a.y)<6,`${body} jump at ${i}`);
      // Consecutive samples share a face or truly adjacent faces.
      assert.ok(a.tile===b.tile||NEIGHBORS[a.tile.face].includes(b.tile.face)||F[a.tile.face].some(v=>F[b.tile.face].includes(v)));
    }
  }
});

test('the hour runs left to right, on a floating net with no cuts',()=>{
  for(let hour=-12;hour<12;hour++){
    const epoch=ISS+hour*3600000,cam=rollCamera('iss',civilHour(epoch,'UTC')),[s0,s1]=cam.stations;
    assert.ok(Math.abs(s1.x-s0.x-180)<1e-6&&Math.abs(s1.y-s0.y)<1e-6);
    // Every edge inside the net is a true fold; the rest is the net's outline.
    const edges=cam.tiles.flatMap(t=>t.edges);
    assert.equal(edges.filter(e=>e.cut).length,0);assert.ok(edges.some(e=>e.outline)&&edges.some(e=>!e.outline));
    // A true net: each face printed once, so no place appears beside a copy
    // of itself.
    const faces=cam.tiles.map(t=>t.face);assert.equal(new Set(faces).size,faces.length);
    // Inside the net, screen positions invert to the right place on Earth;
    // outside it is plain paper.
    let paper=0;for(let y=0;y<H;y+=3)for(let x=0;x<W;x+=3){if(cam.outside(x+.5,y+.5))paper++;}
    assert.ok(paper>0);
    for(const p of cam.track.filter((p,i)=>i%7===0&&!cam.outside(p.x,p.y))){const g=cam.toGround(p.x,p.y);assert.ok(angularDistance(direction(g.lat,g.lon),p.dir)<.01);}
  }
});

test('the Enroute renderer draws a Fuller sheet in native colors, rose turned to north',()=>{
  const atlas=new Uint8Array(readFileSync('public/land.bin')),meters=decodeRelief(new Uint8Array(readFileSync('public/relief.bin')));
  for(const [body,epoch] of [['iss',ISS],['sun',SUN]]){
    const out=new EnrouteRenderer(atlas,meters).render({body,epoch,timeZone:'UTC',clock24:false,plate:'plotboard',projection:'fuller'});
    for(let i=0;i<out.buf.length;i++)assert.equal(out.buf[i]%85,0);
    assert.ok(out.figure.index.x>=out.figure.scale.x0&&out.figure.index.x<=out.figure.scale.x1);
    assert.ok(out.figure.scale.x1>out.figure.scale.x0);
  }
});

test('the Sun and Moon roll out a whole local day, midnight to midnight, on screen',async()=>{
  const {localDay}=await import('../src/enroute-render.js');
  for(const [body,t,tz] of [['sun','2026-09-27T08:24:00Z','America/New_York'],['sun','2026-06-21T08:24:00Z','UTC'],['moon','2026-09-19T09:24:00Z','Asia/Kolkata'],['sun','2026-03-08T12:00:00Z','America/New_York']]){
    const epoch=Date.parse(t),day=localDay(epoch,tz),cam=rollCamera(body,civilHour(epoch,tz),{span:192,day});
    // One hour mark per local hour (23 or 25 across a DST change).
    assert.equal(cam.day.hours.length,Math.round((day.end-day.start)/3600000)+1);
    const xs=cam.track.map(p=>p.x),ys=cam.track.map(p=>p.y);
    assert.ok(Math.min(...xs)>=3.9&&Math.max(...xs)<=196.1&&Math.min(...ys)>=0&&Math.max(...ys)<=H,`${body} ${t}`);
    assert.ok(cam.track[0].x<cam.track.at(-1).x,'time runs left to right');
    for(let i=1;i<cam.track.length;i++)assert.ok(Math.hypot(cam.track[i].x-cam.track[i-1].x,cam.track[i].y-cam.track[i-1].y)<4);
  }
  // Local midnight in any zone, including across both daylight-saving changes.
  for(const [t,z,start,hours] of [['2026-03-08T12:00:00Z','America/New_York','2026-03-08T05:00:00.000Z',23],['2026-11-01T12:00:00Z','America/New_York','2026-11-01T04:00:00.000Z',25],
    ['2026-09-27T08:24:00Z','Asia/Kolkata','2026-09-26T18:30:00.000Z',24],['2026-03-29T12:00:00Z','Europe/London','2026-03-29T00:00:00.000Z',23],['2026-09-27T23:59:00Z','UTC','2026-09-27T00:00:00.000Z',24]]){
    const d=localDay(Date.parse(t),z);assert.equal(new Date(d.start).toISOString(),start,`${t} ${z}`);assert.equal((d.end-d.start)/3600000,hours,`${t} ${z}`);
  }
});

test('the day strip carries the time in full, hours and minutes, clear of the strip',()=>{
  const atlas=new Uint8Array(readFileSync('public/land.bin')),meters=decodeRelief(new Uint8Array(readFileSync('public/relief.bin')));
  for(const [body,t,tz,clock24,time] of [['sun','2026-09-27T08:24:00Z','America/New_York',false,'4:24'],['moon','2026-09-15T12:24:00Z','UTC',true,'12:24'],['sun','2026-09-27T08:07:00Z','UTC',false,'8:07']]){
    const r=new EnrouteRenderer(atlas,meters),out=r.render({body,epoch:Date.parse(t),timeZone:tz,clock24,plate:'enroute',projection:'fuller'});
    assert.equal(out.figure.time,time);
    const {box}=out.figure;assert.ok(box.x>=4&&box.x+box.w<=196&&box.y>=0);
    // The figure never lands on the rolled route.
    for(const p of r.camera.track)assert.ok(!(p.x>=box.x&&p.x<box.x+box.w&&p.y>=box.y&&p.y<box.y+box.h),`${body} ${t}`);
  }
});
