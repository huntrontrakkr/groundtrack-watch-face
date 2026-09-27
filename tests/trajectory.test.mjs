import test from 'node:test';
import assert from 'node:assert/strict';
import {BODIES,position} from '../src/ephemeris.js';
import {packTrack,unpackTrack,cachedPosition,measureTrack} from '../src/trajectory.js';
import {angularDistance} from '../src/geometry.js';
test('trajectory packet roundtrip and expired-cache handling',()=>{
  const start=BODIES.iss.demo,bytes=packTrack('iss',start),track=unpackTrack(bytes);
  assert.equal(bytes.length,1106);assert.equal(track.knots.length,181);
  assert.equal(cachedPosition(track,start-1),null);assert.equal(cachedPosition(track,track.end+1),null);
  for(const t of [start,start+55000,track.end])assert.ok(angularDistance(cachedPosition(track,t),position('iss',t).dir)<.0004);
});
test('truncated, malformed and degenerate packets fail closed',()=>{
  const bytes=packTrack('sun',BODIES.sun.demo);
  assert.throws(()=>unpackTrack(bytes.slice(0,-1)),RangeError);
  const wrong=bytes.slice();wrong[2]=90;assert.throws(()=>unpackTrack(wrong),RangeError);
  const zero=bytes.slice();zero.fill(0,20,26);assert.throws(()=>unpackTrack(zero),RangeError);
  assert.throws(()=>packTrack('sun',BODIES.sun.demo,60,7),RangeError);
});
test('selected interpolation intervals keep tested six-hour windows within a quarter pixel at 400px radius',()=>{
  for(const body of Object.keys(BODIES)){
    const result=measureTrack(body,BODIES[body].demo,body==='iss'?2:10);
    assert.ok(result.maxProjectedPixelsUpperBound<.25,JSON.stringify(result));
  }
});
test('five-minute knots are visibly less suitable for the fast ISS than two-minute knots',()=>{
  const two=measureTrack('iss',BODIES.iss.demo,2),five=measureTrack('iss',BODIES.iss.demo,5);
  assert.ok(five.maxProjectedPixelsUpperBound>two.maxProjectedPixelsUpperBound*4);
});
