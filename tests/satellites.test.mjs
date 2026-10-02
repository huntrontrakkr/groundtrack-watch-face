import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTLE,registerElements,satellitePosition,checksum,bodyId,CATALOG,FRESH} from '../src/satellites.js';
import {position} from '../src/ephemeris.js';
import {chartCamera,civilHour} from '../src/chart-render.js';
import {W,H} from '../src/plates.js';
import {renderer} from './core-fixture.mjs';
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
  // Drawn from segments fitted to SGP4 (segments.js), within a few
  // hundredths of a degree of it.
  for(let t=NOW-3000000;t<NOW+7200000;t+=137000){
    const p=position(bodyId(20580),t),q=satellitePosition(bodyId(20580),t);
    assert.ok(Math.abs(p.lat-q.lat)<0.05&&Math.abs(((p.lon-q.lon+540)%360)-180)<0.1&&Math.abs(p.altitude-q.altitude)<0.5,new Date(t).toISOString());
    assert.equal(p.dir.length,3);
  }
  assert.throws(()=>position(bodyId(20580),NOW+FRESH+3600000),/too far from this time/);
  assert.throws(()=>position(bodyId(43013),NOW),/No elements/);
});

test('a live satellite gets the world band, its symbol, track and element note',async()=>{
  for(const norad of [25544,49260]){
    registerElements(fixtureTLE(NOW-7200000,norad),'test');
    const r=await renderer(),out=r.render({body:bodyId(norad),epoch:NOW,timeZone:'UTC',clock24:true,plate:'enroute'});
    assert.equal(out.world,true);assert.deepEqual([out.figure.hour,out.figure.next],['14','15']);
    assert.ok(out.figure.index.y<r.camera.band.top);
    for(let i=0;i<out.buf.length;i++)assert.equal(out.buf[i]%85,0);
  }
  assert.equal(chartCamera(bodyId(25544),civilHour(NOW,'UTC')).world,true);
  assert.equal(W*H,45600);
});

test('an orbit\'s period decides its chart, the catalog\'s periods being the live ones',async()=>{
  const {chartFor,periodOf,viewOf,CATALOG,bodyId,registerElements}=await import('../src/satellites.js');
  const {readFileSync}=await import('node:fs');
  assert.deepEqual([90,224,226,718,1300,1436,1500,1600].map(chartFor),['world','world','hour','hour','hour','day','day','hour']);
  assert.deepEqual(CATALOG.map(c=>viewOf(bodyId(c.norad))),['world','world','world','world','world','hour','day']);
  // CelesTrak's elements of 29 September 2026 give the periods the catalog states, to a minute.
  const lines=readFileSync('tests/fixtures/celestrak-2026-09-29.tle','utf8').trim().split('\n');
  for(let i=0;i+2<lines.length;i+=3){const e=registerElements(lines.slice(i,i+3).join('\n')+'\n','fixture'),body=bodyId(e.norad),c=CATALOG.find(x=>x.norad===e.norad);
    assert.ok(Math.abs(periodOf(body)-c.period)<1,`${c.code}: ${periodOf(body)} minutes a lap, the catalog says ${c.period}`);
    assert.equal(chartFor(periodOf(body)),viewOf(body));}
  assert.equal(viewOf('sun'),'hour');assert.equal(viewOf('sat:99999'),'world');
});
