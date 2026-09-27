import test from 'node:test';
import assert from 'node:assert/strict';
import {artCamera,ART_DEMOS,civilHour,mapNorth} from '../src/art-camera.js';
import {solarLight,castSunShadow,sunPlaneHit,segmentHitsMask,sunVolumeHit} from '../src/art-light.js';
import {position,MINUTE} from '../src/ephemeris.js';
import {clockParts} from '../src/render.js';
import {dot,norm,direction,lonLat} from '../src/geometry.js';

test('perspective geography roundtrips at every lens and both slow bodies',()=>{
  for(const body of ['sun','moon'])for(const lens of ['above','oblique','low']){
    const camera=artCamera(body,ART_DEMOS[body],'America/New_York',lens);
    for(const [x,y] of [[.5,.5],[199.5,.5],[.5,227.5],[199.5,227.5],[100,114],[40,190]]){
      const ground=camera.inverse(x,y);
      if(!ground){
        // A ray outside Earth's angular radius is sky, not projected land.
        const ray=norm(camera.look.map((v,i)=>v+camera.screenRight[i]*(x-camera.cx)/camera.focal+camera.up[i]*(camera.cy-y)/camera.focal));
        const toward=norm(camera.eye.map(v=>-v));
        assert.ok(Math.acos(dot(ray,toward))>Math.asin(1/Math.hypot(...camera.eye)));
        continue;
      }
      const p=camera.project(ground);
      assert.ok(Math.abs(Math.hypot(...ground)-1)<1e-10);
      assert.ok(p.visible);assert.ok(Math.abs(p.x-x)<1e-8);assert.ok(Math.abs(p.y-y)<1e-8);
    }
  }
});

test('the hour travels upward with a stable camera, including fractional-offset zones',()=>{
  for(const body of ['sun','moon'])for(const lens of ['above','oblique','low'])for(const zone of ['America/New_York','UTC','Asia/Kolkata','Asia/Kathmandu']){
    const c=artCamera(body,ART_DEMOS[body],zone,lens);let lastY=Infinity;
    assert.ok(Math.abs(c.project(position(body,c.start).dir).y-185)<1e-8);
    assert.ok(Math.abs(c.project(position(body,c.end).dir).y-62)<1e-8);
    assert.equal(clockParts(c.start,zone).m,'00');
    assert.equal(clockParts(c.end,zone).m,'00');
    for(let m=0;m<=60;m++){
      const p=c.project(position(body,c.start+m*MINUTE).dir);
      assert.ok(p.visible&&p.x>100&&p.x<145&&p.y<lastY);
      lastY=p.y;
    }
    assert.equal(artCamera(body,c.start+59*MINUTE,zone,lens).key,c.key);
  }
});

test('tangent-plane numerals retain the orientation and location of the ground',()=>{
  const c=artCamera('moon',ART_DEMOS.moon);
  for(const height of [0,.003]){
    const plane=c.plane(c.center,height);
    for(const [x,y] of [[0,0],[.03,.02],[-.02,-.04]]){
      const p=c.projectWorld(plane.at(x,y)),local=plane.inverse(p.x,p.y);
      assert.ok(Math.abs(local.x-x)<1e-10);assert.ok(Math.abs(local.y-y)<1e-10);
    }
    const origin=c.projectWorld(plane.origin);
    assert.ok(c.projectWorld(plane.at(.01,0)).x>origin.x);
    assert.ok(c.projectWorld(plane.at(0,.01)).y<origin.y);
  }
});

test('civil-hour origins distinguish the repeated DST hour and reject unsupported tracks',()=>{
  const a=Date.parse('2026-11-01T05:24:00Z'),b=a+60*MINUTE;
  assert.equal(civilHour(b,'America/New_York')-civilHour(a,'America/New_York'),60*MINUTE);
  assert.equal(clockParts(civilHour(a,'America/New_York'),'America/New_York').text,'01:00');
  assert.equal(clockParts(civilHour(b,'America/New_York'),'America/New_York').text,'01:00');
  assert.throws(()=>artCamera('iss',ART_DEMOS.moon),RangeError);
  assert.throws(()=>artCamera('moon',NaN),RangeError);
});

test('illumination uses the astronomical Sun at the selected minute',()=>{
  for(const epoch of [ART_DEMOS.moon,ART_DEMOS.sun,Date.parse('2026-12-21T17:40:00Z')]){
    assert.deepEqual(solarLight(epoch+12345),position('sun',epoch).dir);
    assert.ok(Math.abs(Math.hypot(...solarLight(epoch))-1)<1e-12);
  }
});

test('solar shadows land on the sphere opposite the light; dark-side rays do not cast',()=>{
  const world=[1.003,0,0],sun=norm([1,1,0]),shadow=castSunShadow(world,sun);
  assert.ok(shadow[1]<0);assert.ok(Math.abs(Math.hypot(...shadow)-1)<1e-12);
  const travel=world.map((v,i)=>v-shadow[i]);
  assert.ok(Math.abs(dot(norm(travel),sun)-1)<1e-12);
  const noon=castSunShadow(world,[1,0,0]);assert.ok(Math.abs(noon[0]-1)<1e-12);
  assert.equal(castSunShadow(world,[-1,0,0]),null);
  assert.equal(castSunShadow(world,[0,1,0]),null);
});

test('inverse shadow sampling agrees with forward sunlight rays without screen-space clamps',()=>{
  const c=artCamera('moon',ART_DEMOS.moon),plane=c.plane(c.center,.003),sun=solarLight(ART_DEMOS.moon);
  for(const [x,y] of [[0,0],[.01,.02],[-.02,-.03]]){
    const world=plane.at(x,y),ground=castSunShadow(world,sun),hit=sunPlaneHit(ground,sun,plane);
    assert.ok(hit);assert.ok(Math.abs(hit.x-x)<1e-9);assert.ok(Math.abs(hit.y-y)<1e-9);
  }
  assert.equal(sunPlaneHit(sun.map(v=>-v),sun,plane),null);
});

test('the map compass points to geographic north in the rotated perspective',()=>{
  for(const body of ['sun','moon'])for(const lens of ['above','oblique','low']){
    const camera=artCamera(body,ART_DEMOS[body],'America/New_York',lens),x=177,y=203;
    const north=mapNorth(camera,x,y),ground=lonLat(camera.inverse(x,y));
    const higherLatitude=camera.project(direction(ground.lat+.01,ground.lon));
    const dx=higherLatitude.x-x,dy=higherLatitude.y-y,length=Math.hypot(dx,dy);
    assert.ok((north.x*dx+north.y*dy)/length>.99999);
    assert.ok(Math.abs(Math.hypot(north.x,north.y)-1)<1e-12);
  }
});

test('bitmap ray traversal catches thin walls and rejects holes and missed bounds',()=>{
  const mask={w:5,h:5,bits:Uint8Array.from({length:25},(_,i)=>i%5===2?1:0)};
  assert.equal(segmentHitsMask(mask,{x:-4,y:2},{x:8,y:2}),true);
  assert.equal(segmentHitsMask(mask,{x:1,y:-4},{x:1,y:8}),false);
  assert.equal(segmentHitsMask(mask,{x:-4,y:-1},{x:8,y:-1}),false);
  assert.equal(segmentHitsMask(mask,{x:2.5,y:2.5},{x:2.5,y:2.5}),true);
  assert.equal(segmentHitsMask(mask,{x:3.5,y:2.5},{x:3.5,y:2.5}),false);
});

test('the tower side casts a continuous shadow where a roof-only test would miss',()=>{
  const sun=norm([1,1,0]),ground=castSunShadow([1.01,0,0],sun);
  const glyph={plane:{normal:[1,0,0],origin:[1.02,0,0],u:[0,1,0],v:[0,0,1]},mask:{w:1,h:1,bits:Uint8Array.of(1)},sx:.004,sy:.004};
  const roof=sunPlaneHit(ground,sun,glyph.plane);
  assert.ok(roof.x>.002,'The ray misses the narrow roof');
  assert.equal(sunVolumeHit(ground,sun,glyph),true,'It must still hit the wall');
  assert.equal(sunVolumeHit(ground,sun.map(v=>-v),glyph),false);
});
