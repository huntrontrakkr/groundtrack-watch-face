import test from 'node:test';
import assert from 'node:assert/strict';
import {PLATES,H} from '../src/plates.js';
import {localDay} from '../src/chart-text.js';
import {renderer,theCore} from './core-fixture.mjs';

const ISS=Date.parse('2019-06-05T12:24:00Z'),SUN=Date.parse('2026-09-27T08:24:00Z');
const sheet=(body,epoch,more={})=>({body,epoch,timeZone:'UTC',clock24:false,plate:'console',projection:'fuller',...more});

test('the rolled route is continuous: it never crosses a cut',async()=>{
  const r=await renderer();
  for(const [body,epoch] of [['iss',ISS],['iss',ISS-10*3600000],['sun',SUN],['moon',Date.parse('2026-09-15T12:24:00Z')]]){
    r.render(sheet(body,epoch));
    for(let i=1;i<r.camera.track.length;i++){const a=r.camera.track[i-1],b=r.camera.track[i];assert.ok(Math.hypot(b.x-a.x,b.y-a.y)<6,`${body} jump at ${i}`);}
  }
});

test('the hour runs left to right, on a floating net with no cuts',async()=>{
  const r=await renderer(),core=await theCore();
  for(let hour=-12;hour<12;hour++){
    const out=r.render(sheet('iss',ISS+hour*3600000)),[s0,s1]=r.camera.stations;
    assert.ok(Math.abs(s1.x-s0.x-180)<=1&&Math.abs(s1.y-s0.y)<=1);
    // A true net: each face printed once, so no place appears beside a copy
    // of itself.
    const faces=r.camera.tiles.map(t=>t.face);assert.ok(faces.length>0);assert.equal(new Set(faces).size,faces.length);
    // Outside the net is plain paper.
    let paper=0;for(let y=0;y<H;y+=3)for(let x=0;x<200;x+=3)if((core.classAt(out.slot,x,y)&15)===2)paper++;
    assert.ok(paper>0);
  }
});

test('the Enroute renderer draws a Fuller sheet in native colors, rose turned to north',async()=>{
  const r=await renderer();
  for(const [body,epoch] of [['iss',ISS],['sun',SUN]]){
    const out=r.render(sheet(body,epoch));
    for(let i=0;i<out.buf.length;i++)assert.equal(out.buf[i]%85,0);
    assert.ok(out.figure.index.x>=out.figure.scale.x0&&out.figure.index.x<=out.figure.scale.x1);
    assert.ok(out.figure.scale.x1>out.figure.scale.x0);
  }
});

test('the Sun and Moon roll out a whole local day, midnight to midnight, on screen',async()=>{
  const r=await renderer();
  for(const [body,t,tz] of [['sun','2026-09-27T08:24:00Z','America/New_York'],['sun','2026-06-21T08:24:00Z','UTC'],['moon','2026-09-19T09:24:00Z','Asia/Kolkata'],['sun','2026-03-08T12:00:00Z','America/New_York']]){
    const epoch=Date.parse(t),day=localDay(epoch,tz);r.render(sheet(body,epoch,{timeZone:tz}));const cam=r.camera;
    // One hour mark per local hour (23 or 25 across a DST change).
    assert.equal(cam.day.hours.length,Math.round((day.end-day.start)/3600000)+1);
    const xs=cam.track.map(p=>p.x),ys=cam.track.map(p=>p.y);
    assert.ok(Math.min(...xs)>=3&&Math.max(...xs)<=197&&Math.min(...ys)>=0&&Math.max(...ys)<=H,`${body} ${t}`);
    assert.ok(cam.track[0].x<cam.track.at(-1).x,'time runs left to right');
    for(let i=1;i<cam.track.length;i++)assert.ok(Math.hypot(cam.track[i].x-cam.track[i-1].x,cam.track[i].y-cam.track[i-1].y)<4);
  }
  // Local midnight in any zone, including across both daylight-saving changes.
  for(const [t,z,start,hours] of [['2026-03-08T12:00:00Z','America/New_York','2026-03-08T05:00:00.000Z',23],['2026-11-01T12:00:00Z','America/New_York','2026-11-01T04:00:00.000Z',25],
    ['2026-09-27T08:24:00Z','Asia/Kolkata','2026-09-26T18:30:00.000Z',24],['2026-03-29T12:00:00Z','Europe/London','2026-03-29T00:00:00.000Z',23],['2026-09-27T23:59:00Z','UTC','2026-09-27T00:00:00.000Z',24]]){
    const d=localDay(Date.parse(t),z);assert.equal(new Date(d.start).toISOString(),start,`${t} ${z}`);assert.equal((d.end-d.start)/3600000,hours,`${t} ${z}`);
  }
});

test('the day strip carries a time callout, hours and minutes, clear of the strip',async()=>{
  const r=await renderer();
  for(const [body,t,tz,clock24,time] of [['sun','2026-09-27T08:24:00Z','America/New_York',false,'4:24'],['moon','2026-09-15T12:24:00Z','UTC',true,'12:24'],['sun','2026-09-27T08:07:00Z','UTC',false,'8:07']]){
    const out=r.render({body,epoch:Date.parse(t),timeZone:tz,clock24,plate:'enroute',projection:'fuller'});
    assert.equal(out.figure.time,time);
    const {box}=out.figure;assert.ok(box.x>=4&&box.x+box.w<=196&&box.y>=0);
    // The figure never lands on the rolled route.
    for(const p of r.camera.track)assert.ok(!(p.x>=box.x&&p.x<box.x+box.w&&p.y>=box.y&&p.y<box.y+box.h),`${body} ${t}`);
    // A leader ties it to the body: ink in every row between the two.
    const {x:mx,y:my}=out.marker,inkColor=PLATES.enroute.ink[0].join(),above=box.y<my,[y0,y1]=above?[box.y+box.h+4,Math.round(my)-10]:[Math.round(my)+10,box.y-4];
    for(let y=y0;y<=y1;y++){let hit=false;for(let x=Math.round(mx)-14;x<=Math.round(mx)+14;x++){const i=(y*200+x)*3;if([out.buf[i],out.buf[i+1],out.buf[i+2]].join()===inkColor)hit=true;}assert.ok(hit,`${body} ${t} leader row ${y}`);}
  }
});
