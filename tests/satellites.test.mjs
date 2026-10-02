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
  const {chartFor,plotFor,swiftest,standsStill,periodOf,viewOf,plotOf,CATALOG,GROUPS,bodyId,registerElements,catalogEntry,addSatellite,forgetSatellites,addedSatellites,codeFor}=await import('../src/satellites.js');
  const {readFileSync}=await import('node:fs');
  assert.deepEqual([90,226,359,361,718,1300,1436,1500,1600].map(p=>chartFor(p)),['world','world','world','hour','hour','hour','day','day','hour']);
  assert.deepEqual([25544,48274,20580,49260,43013,36585,42738].map(n=>viewOf(bodyId(n))),['world','world','world','world','world','hour','day']);
  // What the Plotboard shows: the hour's run of anything somewhere fast (a
  // low orbit; an oval one, by its low end), the whole day of the rest.
  assert.deepEqual([93,288,359,361,718,1436,20504].map(p=>plotFor(p)),['hour','hour','hour','day','day','day','day']);
  assert.equal(Math.round(swiftest(717.8,0.661)),110);
  assert.deepEqual([plotFor(717.8,0.661),chartFor(717.8,0.661),plotFor(1639,0.833),chartFor(1436,0.6),plotFor(2873,0.465)],['hour','hour','hour','hour','day']);
  assert.deepEqual(['sun','moon','sat:25544','sat:36585','sat:42738','sat:40296','sat:54755','sat:60133'].map(plotOf),['day','day','hour','day','day','hour','hour','day']);
  assert.deepEqual(['sat:54755','sat:8820','sat:40296','sat:25867'].map(viewOf),['world','world','hour','hour']);
  // One that stands still over the equator has its day's chart alone: a
  // day to the lap, round and untilted.
  assert.deepEqual([standsStill(1436.1,0.0001,0.04),standsStill(1436.1,0.0001,3.7),standsStill(1436.3,0.075,39),standsStill(718,0,0.1)],[true,false,false,false]);
  assert.deepEqual(['sat:60133','sat:39070','sat:42738'].map(viewOf),['still','day','day']);
  // The catalog: each satellite once, in a group the page lists, with a
  // code the watch can letter; and as CelesTrak had them on 2 October 2026,
  // each of the period and the charts the catalog states.
  assert.equal(new Set(CATALOG.map(c=>c.code)).size,CATALOG.length);
  for(const c of CATALOG){assert.match(c.code,/^[A-Z0-9]{3}$/);assert.ok(GROUPS.some(g=>g[0]===c.group),c.code);assert.ok(c.name&&c.note,c.code);}
  for(const g of GROUPS)assert.ok(CATALOG.some(c=>c.group===g[0]),g[1]);
  {const l=readFileSync('tests/fixtures/celestrak-2026-10-02.tle','utf8').trim().split('\n');let n=0;
  for(let i=0;i+2<l.length;i+=3,n++){const e=registerElements(l.slice(i,i+3).join('\n')+'\n','fixture'),c=catalogEntry(bodyId(e.norad)),p=2*Math.PI/e.satrec.no;
    assert.ok(Math.abs(p-c.period)/p<0.003,`${c.code}: ${p} minutes a lap, the catalog says ${c.period}`);
    assert.deepEqual([standsStill(p,e.satrec.ecco,e.satrec.inclo*180/Math.PI)?'still':chartFor(p,e.satrec.ecco),plotFor(p,e.satrec.ecco)],[viewOf(bodyId(e.norad)),plotOf(bodyId(e.norad))],c.code);}
  assert.equal(n,CATALOG.length);}
  // A satellite from elsewhere: kept with a code from its name, charted by
  // its orbit; the catalog's own are not added again; nonsense is refused.
  forgetSatellites();
  assert.deepEqual(addSatellite({norad:33591,name:'NOAA 19',period:101.9}),{norad:33591,name:'NOAA 19',code:'NOA',period:101.9,symbol:'satellite',group:'yours',note:''});
  assert.equal(addSatellite({norad:25544,name:'x',period:93}).code,'ISS');
  assert.deepEqual([viewOf('sat:33591'),plotOf('sat:33591'),addedSatellites().length,codeFor('  [x] '),codeFor('--')],['world','hour',1,'X','SAT']);
  assert.throws(()=>addSatellite({norad:-4,name:'x',period:90}));assert.throws(()=>addSatellite({norad:7,name:'x',period:1}));assert.throws(()=>addSatellite({norad:7,name:'x',period:90,ecc:1.2}));
  forgetSatellites();assert.equal(catalogEntry('sat:33591'),undefined);
  // CelesTrak's elements of 29 September 2026 give the periods the catalog states, to a minute.
  const lines=readFileSync('tests/fixtures/celestrak-2026-09-29.tle','utf8').trim().split('\n');
  for(let i=0;i+2<lines.length;i+=3){const e=registerElements(lines.slice(i,i+3).join('\n')+'\n','fixture'),body=bodyId(e.norad),c=CATALOG.find(x=>x.norad===e.norad);
    assert.ok(Math.abs(periodOf(body)-c.period)<1,`${c.code}: ${periodOf(body)} minutes a lap, the catalog says ${c.period}`);
    assert.equal(chartFor(periodOf(body)),viewOf(body));}
  // (The seven are on September's sets again, for the tests after.)
  assert.equal(viewOf('sun'),'hour');assert.equal(viewOf('sat:99999'),'world');
});
