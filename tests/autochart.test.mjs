// The watch chooses the chart an hour can be drawn on: a satellite sent to
// the hour chart that runs further in the hour than the chart can hold has
// that hour on the world band.
import test from 'node:test';
import assert from 'node:assert/strict';
import {chartInput} from '../src/chart-input.js';
import {HOMES} from '../src/home.js';
import {registerLiveFixture} from './tle-fixture.mjs';
import {registerNominal} from '../src/nominal.js';
import {theCore} from './core-fixture.mjs';

registerNominal();registerLiveFixture();
const start=Date.parse('2026-09-30T13:00:00Z'),zone='America/New_York';
const input=(body,more={})=>chartInput({body,start,plate:'console',zone,home:HOMES[zone],flag:true,...more});

test('an hour too long for the hour chart is drawn on the world band',async()=>{
  const core=await theCore();
  // GPS's hour (some 30 degrees of the world) stays on the hour chart.
  assert.equal(core.build(input('sat:36585'),0).view,0);
  // The ISS, told to draw its hour on the hour chart (three quarters of
  // the way round the world): the watch draws the world band, and the
  // same frame as if it had been told so.
  const asked=input('sat:25544'),told=asked.replace(/^view 1$/m,'view 0');
  assert.notEqual(told,asked);
  assert.equal(core.build(told,0).view,1);
  const a=Buffer.from(core.render(20,0));
  core.build(asked,0);
  assert.ok(a.equals(Buffer.from(core.render(20,0))));
});
