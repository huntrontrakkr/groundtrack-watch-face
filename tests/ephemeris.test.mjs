import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {position,moonLight,BODIES,sampleTrack,MINUTE} from '../src/ephemeris.js';
import {sunDirection} from '../src/solar.js';
import {angularDistance,direction} from '../src/geometry.js';
import {landAt,clockParts,cameraFor} from '../src/render.js';
test('solar groundpoint agrees with the separate almanac implementation across seasons',()=>{
  for(const iso of ['2026-03-20T12:00:00Z','2026-06-21T00:00:00Z','2026-09-27T09:24:00Z','2026-12-21T18:00:00Z']){
    const date=new Date(iso),p=position('sun',+date);
    assert.ok(angularDistance(p.dir,sunDirection(date))*180/Math.PI<.1);
  }
});
test('lunar phase distinguishes known new and full moons',()=>{
  assert.ok(moonLight(Date.parse('2024-04-08T18:21:00Z')).fraction<.01);
  assert.ok(moonLight(Date.parse('2024-03-25T07:00:00Z')).fraction>.99);
});
test('ISS sample stays near its real archived epoch',()=>{
  const p=position('iss',BODIES.iss.demo);assert.ok(p.altitude>300&&p.altitude<600);
  assert.ok(Math.abs(p.lat)<=51.7);
  assert.throws(()=>position('iss',BODIES.sun.demo),/archived epoch/);
});
test('invalid inputs are rejected instead of producing unbounded samples',()=>{
  assert.throws(()=>sampleTrack('sun',0,100,0),RangeError);
  assert.throws(()=>sampleTrack('sun',0,1e20,1),RangeError);
  assert.throws(()=>position('no-such-body',0),RangeError);
});
test('offline atlas has land, water, and Antarctic pole orientation correct',()=>{
  const atlas=readFileSync('public/land.bin');assert.equal(atlas.length,129600);
  for(const [lat,lon,expected] of [[30,15,1],[40,-100,1],[-25,135,1],[-85,0,1],[0,-140,0],[40,-40,0],[89,0,0]])assert.equal(landAt(atlas,direction(lat,lon)),expected,`${lat},${lon}`);
});
test('clock labels handle dates, DST, and non-integer UTC offsets',()=>{
  assert.equal(clockParts(Date.parse('2026-01-01T00:15:00Z'),'America/New_York').text,'19:15');
  assert.equal(clockParts(Date.parse('2026-09-27T09:24:00Z'),'Asia/Kolkata').text,'14:54');
  assert.equal(clockParts(Date.parse('2026-11-01T05:59:00Z'),'America/New_York').text,'01:59');
  assert.equal(clockParts(Date.parse('2026-11-01T06:00:00Z'),'America/New_York').text,'01:00');
});
test('camera stays fixed between scheduled page changes',()=>{
  const a=cameraFor('sun',BODIES.sun.demo,'landscape'),b=cameraFor('sun',BODIES.sun.demo+60000,'landscape');
  assert.equal(a.key,b.key);
  assert.notEqual(a.key,cameraFor('sun',BODIES.sun.demo+30*60000,'landscape').key);
});
test('current body stays within the readable map for every scrubber minute in all three views',()=>{
  for(const body of Object.keys(BODIES))for(const view of ['landscape','oblique','globe'])for(let offset=-60;offset<=60;offset++){
    const epoch=BODIES[body].demo+offset*MINUTE,p=cameraFor(body,epoch,view).camera.project(position(body,epoch).dir);
    assert.ok(p.visible&&p.x>=5&&p.x<=195&&p.y>=33&&p.y<=192,`${body}/${view}/${offset}: ${JSON.stringify(p)}`);
  }
});
