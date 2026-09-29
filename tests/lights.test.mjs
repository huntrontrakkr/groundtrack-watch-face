import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import lights from '../data/lights.json' with {type:'json'};
import {EnrouteRenderer,PLATES,W,H} from '../src/enroute-render.js';
import {decodeRelief} from '../src/relief.js';
import {position} from '../src/ephemeris.js';
import {dot} from '../src/geometry.js';
import {SUNRISE_SINE} from '../src/solar.js';

const atlas=new Uint8Array(readFileSync('public/land.bin')),meters=decodeRelief(new Uint8Array(readFileSync('public/relief.bin')));
const ISS=Date.parse('2019-06-05T12:24:00Z'),SUN=Date.parse('2026-09-27T08:24:00Z');

test('the lights are real places, in three brightnesses, brightest first',()=>{
  const P=lights.points;assert.equal(P.length%3,0);assert.ok(P.length/3>3000);
  for(let k=0;k<P.length;k+=3){
    assert.ok(Math.abs(P[k])<=900&&Math.abs(P[k+1])<=1800&&[1,2,3].includes(P[k+2]));
    if(k)assert.ok(P[k+2]<=P[k-1]);
  }
  assert.match(lights.source,/public domain/);
});

test('cities light the night side only, and only the large ones at world scale',()=>{
  const r=new EnrouteRenderer(atlas,meters);
  for(const plate of ['plotboard','enroute','crt']){
    const out=r.render({body:'iss',epoch:ISS,timeZone:'UTC',clock24:false,plate});
    assert.ok(out.lights>30,`${plate}: ${out.lights}`);
    // Every pixel the lights change is ground where the Sun is down.
    const pal=PLATES[plate],keep=pal.lights;pal.lights=null;let dark;
    try{dark=new EnrouteRenderer(atlas,meters).render({body:'iss',epoch:ISS,timeZone:'UTC',clock24:false,plate}).buf;}finally{pal.lights=keep;}
    const sun=position('sun',ISS).dir;let checked=0;
    for(let i=0;i<W*H;i++)if(out.buf[i*3]!==dark[i*3]||out.buf[i*3+1]!==dark[i*3+1]||out.buf[i*3+2]!==dark[i*3+2]){
      const d=r.ground.dirs[i];assert.ok(d&&dot(d,sun)<SUNRISE_SINE,`${plate} ${i%W},${Math.floor(i/W)}`);checked++;
    }
    assert.ok(checked>0);
  }
  const big=lights.points.filter((_,k)=>k%3===2&&_>=2).length,world=r.render({body:'iss',epoch:ISS,timeZone:'UTC',clock24:false,plate:'plotboard'}).lights;
  assert.ok(world<=big);
  // The Sun's chart is all daylight; the Sunlight plate carries no lights.
  assert.equal(r.render({body:'sun',epoch:SUN,timeZone:'UTC',clock24:false,plate:'enroute'}).lights,0);
  assert.equal(r.render({body:'iss',epoch:ISS,timeZone:'UTC',clock24:false,plate:'sunlight'}).lights,0);
});
