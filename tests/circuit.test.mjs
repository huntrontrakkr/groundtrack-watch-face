import test from 'node:test';
import assert from 'node:assert/strict';
import {registerNominal} from '../src/nominal.js';
import {renderer} from './core-fixture.mjs';

test('QZSS switches between its whole day and this hour',async()=>{
  registerNominal();
  const r=await renderer();
  const state={body:'sat:42738',epoch:Date.parse('2026-09-27T05:24:00Z'),timeZone:'Asia/Tokyo',clock24:true,plate:'enroute'};
  r.render(state);assert.equal(r.camera.day.hours.length,25);
  const out=r.render({...state,span:'hour'}),[s0,s1]=r.camera.stations;
  assert.equal(r.camera.day,null);assert.ok(Math.abs(Math.hypot(s1.x-s0.x,s1.y-s0.y)-120)<1);assert.equal(out.figure.hour,'14');
  // The switch has no effect on the Sun, which is always on the hour chart.
  r.render({body:'sun',epoch:state.epoch,timeZone:'UTC',clock24:true,plate:'enroute',span:'day'});assert.equal(r.camera.day,null);
});
