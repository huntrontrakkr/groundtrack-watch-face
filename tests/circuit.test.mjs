import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {circuitPath,EnrouteRenderer} from '../src/enroute-render.js';
import {registerNominal} from '../src/nominal.js';
import {decodeRelief} from '../src/relief.js';

test('leaders run like circuit traces: a 45° run, then straight, nothing else',()=>{
  for(const [a,b] of [[{x:0,y:0},{x:10,y:26}],[{x:50,y:50},{x:6,y:40}],[{x:5,y:5},{x:5,y:-20}],[{x:0,y:0},{x:-30,y:30}],[{x:10,y:10},{x:40,y:12}]]){
    const p=circuitPath(a,b);assert.deepEqual(p[0],[Math.round(a.x),Math.round(a.y)]);assert.deepEqual(p.at(-1),[b.x,b.y]);
    const steps=p.slice(1).map((q,i)=>[q[0]-p[i][0],q[1]-p[i][1]]);
    for(const [dx,dy] of steps)assert.ok(Math.abs(dx)<=1&&Math.abs(dy)<=1&&(dx||dy));
    // Diagonal steps first, then one straight direction: a single bend.
    const kinds=steps.map(([dx,dy])=>dx&&dy?'d':dx?'h':'v'),changes=kinds.filter((k,i)=>i&&k!==kinds[i-1]).length;
    assert.ok(changes<=1&&(kinds[0]==='d'||!kinds.includes('d')),JSON.stringify(kinds));
  }
  // The start's knockout is left clear.
  assert.ok(circuitPath({x:0,y:0},{x:20,y:20},9).every(([x,y])=>Math.hypot(x,y)>=9));
});

test('QZSS switches between its whole day and this hour',()=>{
  registerNominal();
  const atlas=new Uint8Array(readFileSync('public/land.bin')),meters=decodeRelief(new Uint8Array(readFileSync('public/relief.bin'))),r=new EnrouteRenderer(atlas,meters);
  const state={body:'sat:42738',epoch:Date.parse('2026-09-27T05:24:00Z'),timeZone:'Asia/Tokyo',clock24:true,plate:'enroute'};
  r.render(state);assert.equal(r.camera.day.hours.length,25);
  const out=r.render({...state,span:'hour'}),[s0,s1]=r.camera.stations;
  assert.equal(r.camera.day,null);assert.ok(Math.abs(Math.hypot(s1.x-s0.x,s1.y-s0.y)-120)<1);assert.equal(out.figure.hour,'14');
  // The switch has no effect on the Sun, which is always on the hour chart.
  r.render({body:'sun',epoch:state.epoch,timeZone:'UTC',clock24:true,plate:'enroute',span:'day'});assert.equal(r.camera.day,null);
});
