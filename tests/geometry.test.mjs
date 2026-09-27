import test from 'node:test';
import assert from 'node:assert/strict';
import {direction,globeCamera,angularDistance,interpolate,lonLat} from '../src/geometry.js';
test('orthographic forward and inverse agree, including rolled views and polar centers',()=>{
  for(const lat of [-90,-65,0,70,90])for(const lon of [-179,0,178])for(const roll of [-30,0,63]){
    const cam=globeCamera({lat,lon,roll,radius:120});
    for(const [x,y] of [[100,112],[80,90],[180,150],[30,145]]){
      const d=cam.inverse(x,y),p=cam.project(d);
      assert.ok(p.visible);assert.ok(Math.abs(p.x-x)<1e-8);assert.ok(Math.abs(p.y-y)<1e-8);
      assert.ok(Math.abs(Math.hypot(...d)-1)<1e-12);
    }
  }
});
test('the hidden hemisphere is not projected as visible land',()=>{
  const cam=globeCamera({lat:0,lon:0});
  assert.equal(cam.project(direction(0,180)).visible,false);assert.equal(cam.inverse(0,-20),null);
});
test('short Cartesian interpolation takes the short route across the dateline',()=>{
  const a=direction(10,179),b=direction(10,-179),mid=interpolate(a,b,.5);
  assert.ok(Math.abs(lonLat(mid).lon)>179.99);assert.ok(angularDistance(a,mid)<.02);
});
