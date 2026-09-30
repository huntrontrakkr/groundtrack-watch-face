import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EnrouteRenderer,nauticalZone,NUMERALS} from '../src/enroute-render.js';
import {decodeRelief} from '../src/relief.js';

const atlas=new Uint8Array(readFileSync('public/land.bin')),meters=decodeRelief(new Uint8Array(readFileSync('public/relief.bin')));
const SUN=Date.parse('2026-09-27T08:24:00Z'),MOON=Date.parse('2026-09-15T12:24:00Z');

test('nautical zones are 15° wide and lettered A–M east, N–Y west, Z at Greenwich',()=>{
  const at=lon=>{const z=nauticalZone(lon);return `${z.hours}${z.letter}`;};
  assert.deepEqual([0,7.4,-7.4,7.6,-75,139,135,-150,172.4,-172.4,179,-179,360-75].map(at),['0Z','0Z','0Z','1A','-5R','9I','9I','-10W','11L','-11X','12M','-12Y','-5R']);
  // No J, and every zone has its own letter.
  const letters=new Set();for(let h=-12;h<=12;h++)letters.add(nauticalZone(h*15-(h===12?1:0)).letter);assert.equal(letters.size,25);assert.ok(!letters.has('J'));
});

test('the margin can give the time in the zone under the body; the Sun’s is always near noon',()=>{
  const r=new EnrouteRenderer(atlas,meters);
  for(let h=0;h<24;h+=3){
    const out=r.render({body:'sun',epoch:SUN+h*3600000,timeZone:'UTC',clock24:true,plate:'enroute',zone:'body'}),t=out.zulu.text,minutes=Number(t.slice(0,2))*60+Number(t.slice(2,4));
    assert.match(t,/^\d{4}[A-IK-Z]$/);assert.ok(Math.abs(minutes-720)<=46,`${h}: ${t}`);
  }
  const moon=r.render({body:'moon',epoch:MOON,timeZone:'UTC',clock24:true,plate:'enroute',zone:'body'}),z=nauticalZone(moon.marker.lon);
  assert.equal(moon.zulu.text.slice(-1),z.letter);
  assert.match(r.render({body:'moon',epoch:MOON,timeZone:'UTC',clock24:true,plate:'enroute'}).zulu.text,/^1224Z$/);
});

test('every callout style sets the time on one baseline, and four figures read as one time',()=>{
  const r=new EnrouteRenderer(atlas,meters),base={body:'moon',epoch:MOON,timeZone:'UTC',clock24:true,plate:'enroute',readout:true};
  const boxes={};
  for(const numerals of NUMERALS){const out=r.render({...base,numerals});boxes[numerals]=out.figure.readout;assert.ok(out.figure.readout,numerals);}
  assert.equal(r.render({...base,numerals:'even'}).figure.time,'1224');assert.equal(r.render({...base,numerals:'colon'}).figure.time,'12:24');
  // All styles share the hour figure's baseline.
  const bottoms=new Set(Object.values(boxes).map(b=>b.y+b.h));assert.equal(bottoms.size,1,JSON.stringify(boxes));
});
