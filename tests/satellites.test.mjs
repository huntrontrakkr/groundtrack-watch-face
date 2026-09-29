import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseTLE,registerElements,satellitePosition,checksum,bodyId,CATALOG,FRESH} from '../src/satellites.js';
import {position} from '../src/ephemeris.js';
import {chartCamera,civilHour} from '../src/chart-render.js';
import {EnrouteRenderer,W,H} from '../src/enroute-render.js';
import {decodeRelief} from '../src/relief.js';
import {fixtureTLE} from './tle-fixture.mjs';
import iss from '../data/iss.json' with {type:'json'};

const NOW=Date.parse('2026-09-29T14:37:00Z');

test('element sets are parsed and checked before use',()=>{
  const t=parseTLE(`ISS (ZARYA)\n${iss.tle.join('\n')}\n`);
  assert.equal(t.norad,25544);assert.equal(new Date(t.epoch).toISOString().slice(0,16),'2019-06-05T12:12');
  for(const line of iss.tle)assert.equal(checksum(line),Number(line[68]));
  const broken=iss.tle[1].slice(0,20)+'9'+iss.tle[1].slice(21);
  assert.throws(()=>parseTLE(`${iss.tle[0]}\n${broken}`),/checksum/);
  assert.throws(()=>parseTLE('<html>Forbidden</html>'),/two-line/);
  assert.equal(new Set(CATALOG.map(c=>c.norad)).size,CATALOG.length);
});

test('live elements propagate near their epoch and are refused when stale',()=>{
  registerElements(fixtureTLE(NOW-3600000,20580,'HST'),'test');
  // The fixture re-epochs the 2019 ISS orbit: the propagated state must match.
  const moved=satellitePosition(bodyId(20580),NOW-3600000+12*60000);
  assert.ok(moved.altitude>350&&moved.altitude<480&&Math.abs(moved.lat)<=52);
  assert.deepEqual(position(bodyId(20580),NOW),satellitePosition(bodyId(20580),NOW));
  assert.throws(()=>position(bodyId(20580),NOW+FRESH+3600000),/three days/);
  assert.throws(()=>position(bodyId(43013),NOW),/No elements/);
});

test('a live satellite gets the world band, its symbol, track and element note',()=>{
  const atlas=new Uint8Array(readFileSync('public/land.bin')),meters=decodeRelief(new Uint8Array(readFileSync('public/relief.bin')));
  for(const norad of [25544,49260]){
    registerElements(fixtureTLE(NOW-7200000,norad),'test');
    const r=new EnrouteRenderer(atlas,meters),out=r.render({body:bodyId(norad),epoch:NOW,timeZone:'UTC',clock24:true,plate:'enroute'});
    assert.equal(out.world,true);assert.deepEqual([out.figure.hour,out.figure.next],['14','15']);
    assert.ok(out.figure.index.y<r.camera.band.top);
    for(let i=0;i<out.buf.length;i++)assert.equal(out.buf[i]%85,0);
  }
  assert.equal(chartCamera(bodyId(25544),civilHour(NOW,'UTC')).world,true);
  assert.equal(W*H,45600);
});
