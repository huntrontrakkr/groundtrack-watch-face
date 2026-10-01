import test from 'node:test';
import assert from 'node:assert/strict';
import {W,H} from '../src/plates.js';
import {MINUTE} from '../src/ephemeris.js';
import {HOMES} from '../src/home.js';
import {renderer,theCore} from './core-fixture.mjs';

const SUN=Date.parse('2026-09-27T08:24:00Z'),MOON=Date.parse('2026-09-19T09:24:00Z'),ISS=Date.parse('2019-06-05T12:24:00Z');
const home=HOMES['America/New_York'];
const ink=(out,box)=>{let n=0;for(let y=box.y;y<box.y+box.h;y++)for(let x=box.x;x<box.x+box.w;x++){const i=(y*W+x)*3;if(out.buf[i]!==out.buf[(H-1)*W*3]||out.buf[i+1]!==out.buf[(H-1)*W*3+1])n++;}return n;};

test('the margins give the weekday with the date, and the corner its chosen text',async()=>{
  const r=await renderer();
  // Sunday 27 September 2026, New York.
  const out=r.render({body:'sun',epoch:SUN,timeZone:'America/New_York',clock24:true,plate:'enroute',home});
  const left=r.core.textBox('SUN 27 SEP',6,H-5);assert.ok(out.margins.some(b=>b.x===left.x&&b.w===left.w),'the weekday date at the left');
  assert.equal(out.scene.minutes[24].corner,'DAY 270');
  // The ground point, the minute's: the Sun at 08:24 UTC stands near 1N 054E.
  const point=r.render({body:'sun',epoch:SUN,timeZone:'America/New_York',clock24:true,plate:'enroute',home,corner:'point'});
  assert.match(point.scene.minutes[24].corner,/^\d\d[NS] \d{3}[EW]$/);
  const sun=point.marker;assert.equal(point.scene.minutes[24].corner,`${String(Math.round(Math.abs(sun.lat))).padStart(2,'0')}${sun.lat<0?'S':'N'} ${String(Math.round(Math.abs(sun.lon))).padStart(3,'0')}${sun.lon<0?'W':'E'}`);
  // The Moon's light, on the Moon's charts; elsewhere the day of the year.
  const moon=r.render({body:'moon',epoch:MOON,timeZone:'America/New_York',clock24:true,plate:'enroute',home,corner:'light'});
  assert.match(moon.scene.minutes[24].corner,/^\d{1,3}% WA[XN]$/);
  assert.equal(r.render({body:'sun',epoch:SUN,timeZone:'America/New_York',clock24:true,plate:'enroute',home,corner:'light'}).scene.minutes[24].corner,'DAY 270');
});

test('on the world band the line over it gives the date, and the satellite\'s height or ground point',async()=>{
  const r=await renderer();
  const out=r.render({body:'iss',epoch:ISS,timeZone:'UTC',clock24:true,plate:'crt'});
  // The 2019 archive's elements are its own hour's: not old.
  assert.match(out.scene.minutes[24].corner,/^ISS \d{3} KM$/);
  assert.match(r.render({body:'iss',epoch:ISS,timeZone:'UTC',clock24:true,plate:'crt',corner:'point'}).scene.minutes[24].corner,/^ISS \d\d[NS] \d{3}[EW]$/);
  // Elements more than two days old (CelesTrak's of 29 September) are
  // noted, the height kept; younger, not.
  const {registerLiveFixture}=await import('./tle-fixture.mjs');registerLiveFixture();
  const {elementsFor}=await import('../src/satellites.js'),epoch=elementsFor('sat:25544').epoch;
  const at=t=>r.render({body:'sat:25544',epoch:Math.floor((epoch+t)/3600000)*3600000+24*MINUTE,timeZone:'UTC',clock24:true,plate:'crt'}).scene.minutes[24].corner;
  assert.match(at(30*3600000),/^ISS \d{3} KM$/);
  assert.match(at(60*3600000),/^EL OLD \d{3} KM$/);
});

test('the watch\'s own state takes the corner while it lasts',async()=>{
  const r=await renderer(),core=await theCore();
  const state={body:'sun',epoch:SUN,timeZone:'America/New_York',clock24:true,plate:'enroute',home};
  const plain=r.render(state),box=r.core.textBox('NO LINK',W-6-r.core.textWidth('NO LINK'),H-5);
  try{
    core.status('NO LINK');const lost=r.render(state);
    let differ=0;for(let i=0;i<plain.buf.length;i+=3)if(plain.buf[i]!==lost.buf[i]||plain.buf[i+1]!==lost.buf[i+1]||plain.buf[i+2]!==lost.buf[i+2]){const p=i/3,x=p%W,y=Math.floor(p/W);assert.ok(y>=H-14,`(${x},${y}) changed off the bottom margin`);differ++;}
    assert.ok(differ>0&&ink(lost,box)>0,'NO LINK lettered in the corner');
  }finally{core.status('');}
  assert.deepEqual([...r.render(state).buf],[...plain.buf],'cleared, the corner is the day of the year again');
});
