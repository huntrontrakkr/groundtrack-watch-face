import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {HOMES,riseSet,elevation,reach,passes,nextPass,PASS_MASK} from '../src/home.js';
import {EnrouteRenderer,localDay,riseText,passText,ACQUISITION,PLATES,W,H} from '../src/enroute-render.js';
import {decodeRelief} from '../src/relief.js';
import {position,MINUTE} from '../src/ephemeris.js';
import {direction} from '../src/geometry.js';

const NY=HOMES['America/New_York'],LONDON=HOMES['Europe/London'],ISS=Date.parse('2019-06-05T12:24:00Z');

test('sunrise and sunset at home fall where the almanac has them',()=>{
  // New York, 27 September 2026: sunrise about 06:49 EDT, sunset about 18:44.
  const day=localDay(Date.parse('2026-09-27T16:00:00Z'),'America/New_York'),{rise,set}=riseSet('sun',NY,day.start);
  assert.ok(Math.abs(rise-Date.parse('2026-09-27T10:49:00Z'))<4*MINUTE,new Date(rise).toISOString());
  assert.ok(Math.abs(set-Date.parse('2026-09-27T22:44:00Z'))<4*MINUTE,new Date(set).toISOString());
  assert.deepEqual(riseText('sun',NY,Date.parse('2026-09-27T16:00:00Z'),'America/New_York').map(t=>t.replace(/\d{4}/,'####')),['HOM SR ####','SS ####']);
  // Midsummer inside the Arctic Circle: the Sun neither rises nor sets.
  const tromso={code:'HOM',lat:69.65,lon:18.96},june=Date.parse('2026-06-21T12:00:00Z');
  assert.deepEqual(riseSet('sun',tromso,localDay(june,'UTC').start),{rise:null,set:null});
  assert.deepEqual(riseText('sun',tromso,june,'UTC'),['HOM SR ----','SS ----']);
  assert.match(riseText('moon',NY,Date.parse('2026-09-15T12:24:00Z'),'America/New_York')[0],/^HOM MR (\d{4}|----)$/);
});

test('a satellite overhead stands at 90°, and the acquisition circle matches the network’s',()=>{
  assert.ok(Math.abs(elevation(NY,{dir:direction(NY.lat,NY.lon),altitude:410})-90)<1e-6);
  assert.ok(Math.abs(reach(410,5)-ACQUISITION)<1e-9);
  assert.ok(reach(410)<reach(410,5)&&reach(800)>reach(410));
});

test('passes over home rise above the mask and set below it again',()=>{
  const list=passes('iss',LONDON,ISS);assert.ok(list.length>=2,`${list.length} passes`);
  for(const p of list.filter(p=>!p.open)){
    assert.ok(p.aos<=p.los&&p.peak>=PASS_MASK&&p.peak<=90);
    assert.ok(elevation(LONDON,position('iss',p.aos))>=PASS_MASK);
    assert.ok(elevation(LONDON,position('iss',p.aos-MINUTE/3))<PASS_MASK);
    assert.ok(elevation(LONDON,position('iss',p.los+MINUTE/3))<PASS_MASK);
  }
  const next=nextPass('iss',LONDON,ISS);assert.ok(next.los>=ISS);
  assert.match(passText('iss',LONDON,ISS,'Europe/London'),/^HOM (AOS \d{4} \d+M \d+°|IN VIEW LOS \d{4})$/);
  assert.match(passText('iss',LONDON,next.aos,'Europe/London'),/^HOM IN VIEW LOS \d{4}$/);
  // Past the archive's reach there is nothing to promise.
  assert.equal(passText('iss',LONDON,ISS+24*60*MINUTE,'UTC'),'HOM NO PASS');
});

test('home is drawn as an airport, clear of the margins and the network',()=>{
  const atlas=new Uint8Array(readFileSync('public/land.bin')),meters=decodeRelief(new Uint8Array(readFileSync('public/relief.bin')));
  const r=new EnrouteRenderer(atlas,meters);
  const cases=[['iss',ISS+2*3600000,'chart',LONDON],['moon',Date.parse('2026-09-15T12:24:00Z'),'fuller',NY],['sun',Date.parse('2026-09-27T08:24:00Z'),'fuller',NY],['iss',ISS+3600000,'fuller',LONDON]];
  let drawn=0;
  for(const [body,epoch,projection,home] of cases){
    const out=r.render({body,epoch,timeZone:'UTC',clock24:false,plate:'enroute',projection,home});
    if(!out.home)continue;drawn++;
    const {box}=out.home;assert.ok(box.y>=14&&box.y+box.h<=H-16||r.camera.world,`${body} ${projection}`);
    for(const s of out.stations)assert.ok(!(s.box.x<box.x+box.w&&box.x<s.box.x+s.box.w&&s.box.y<box.y+box.h&&box.y<s.box.y+s.box.h),`${s.code} over home`);
    // The ring and its ticks are in the mark ink.
    const at=(x,y)=>[...out.buf.slice((y*W+x)*3,(y*W+x)*3+3)].join(),mark=PLATES.enroute.mark[0].join(),{x,y}=out.home;
    // Drawn last, so nothing crosses it.
    const inked=[[0,-5],[5,0],[0,5],[-5,0],[0,-3],[3,0],[-3,0],[0,3]].filter(([dx,dy])=>at(x+dx,y+dy)===mark).length;
    assert.ok(inked===8,`${body} ${projection}: ${inked} of 8`);
    assert.notEqual(at(x,y),mark);
  }
  assert.ok(drawn>=3,`home drawn in ${drawn} views`);
  // No home, no home lettering.
  const plain=r.render({body:'sun',epoch:Date.parse('2026-09-27T08:24:00Z'),timeZone:'UTC',clock24:false,plate:'enroute',projection:'chart'});
  assert.equal(plain.home,null);
});
