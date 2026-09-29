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
