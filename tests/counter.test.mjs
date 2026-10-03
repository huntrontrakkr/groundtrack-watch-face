// The counter readout: this hour's large figure becomes the time, its
// minutes beside it in the numeral style chosen, as the panel clock and the
// callout compose them; and a satellite's estimated sunlight in the corner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {renderer} from './core-fixture.mjs';
import {elementsFor} from '../src/satellites.js';
import {PLATES,W,H} from '../src/plates.js';
import {registerLiveFixture} from './tle-fixture.mjs';
import {registerNominal} from '../src/nominal.js';

registerNominal();registerLiveFixture();
const at=Date.parse('2026-09-30T13:00:00Z');
const charts=[{body:'sun'},{body:'moon'},{body:'sat:36585'},{body:'sat:42738',span:'hour'},{body:'sat:25544',projection:'fuller'},{body:'sat:36585',projection:'fuller'}];
const pixels=(frame,b)=>{const out=[];for(let y=b.y;y<b.y+b.h;y++)out.push(...frame.slice(y*W+b.x,y*W+b.x+b.w));return out;};

test('the counter readout puts the minutes beside this hour\'s figure on every hour chart, in each numeral style',async()=>{
  const r=await renderer();
  for(const plate of ['enroute','console','survey','operations'])for(const c of charts)for(const numerals of ['even','accent','mono','plain','colon']){
    const state={...c,epoch:at+24*60000,timeZone:'UTC',clock24:true,plate,numerals};
    const off=r.render({...state,readout:'flag'}),on=r.render({...state,readout:'counter'});
    const label=`${plate} ${JSON.stringify(c)} ${numerals}`;
    assert.equal(on.figure.readout?.kind,'counter',label);
    const b=on.figure.readout;
    // The time stands where the hour figure stood, within the frame, and wider than the hour alone.
    assert.ok(b.w>0&&b.h>=24&&b.x>=0&&b.y>=0&&b.x+b.w<=W&&b.y+b.h<=H,`${label}: ${JSON.stringify(b)}`);
    assert.ok(b.w>off.figure.box.w+12,`${label}: the minutes add nothing`);
    assert.equal(b.x,on.scene.figureBoxes[0].x,`${label}: the counter is not at the hour figure's place`);
    // Another minute changes only the counter's digits; the hour figure's own pixels stay.
    const later=r.render({...state,epoch:at+37*60000,readout:'counter'});
    assert.notDeepEqual(pixels(later.frame,b),pixels(on.frame,b),`${label}: the minutes do not change`);
    assert.equal(later.figure.readout.x,b.x,`${label}: the counter moved`);
  }
});

test('the counter uses the smaller figures where the time will not fit, and the world band keeps its own time',async()=>{
  const r=await renderer();
  // Two figures of 72 px and the minutes beside them fit the chart in
  // every style (four outlined figures just so); the counter is at the
  // large sizes, and the next hour's figure has stepped clear of it.
  for(const numerals of ['even','plain','colon','mono','accent']){
    const out=r.render({body:'sun',epoch:at+24*60000,timeZone:'UTC',clock24:true,plate:'enroute',numerals,readout:'counter'});
    assert.equal(out.scene.counter,2,numerals);
    const a=out.figure.readout,b=out.scene.figureBoxes[1];
    assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,`${numerals}: the next hour's figure lies under the time`);
  }
  // On the world band the counter asked for is the ruler's flag.
  const world=r.render({body:'sat:25544',epoch:at+24*60000,timeZone:'UTC',clock24:true,plate:'enroute',readout:'counter'});
  assert.equal(world.scene.counter,0);assert.ok(world.scene.flags&16,'the ruler\'s flag stands in');
  // A bare hour chart has the time in full beside the body instead.
  const bare=r.render({body:'sun',epoch:at+24*60000,timeZone:'UTC',clock24:true,plate:'enroute',readout:'counter',bare:true});
  assert.equal(bare.scene.counter,0);assert.equal(bare.figure.readout?.kind,'callout');
});

test('satellite sunlight is selectable on each chart and old elements take precedence',async()=>{
  const r=await renderer();
  for(const c of [{body:'sat:25544'},{body:'sat:25544',projection:'fuller'},{body:'sat:36585'},{body:'sat:42738'}]){
    const fresh=r.render({...c,epoch:at,timeZone:'UTC',clock24:true,plate:'operations',corner:'light'});
    assert.ok(fresh.scene.minutes.every(m=>/^(?:[A-Z0-9]{1,3} )?(SUNLIT|ECLIPSE)$/.test(m.corner)));
  }
  const old=r.render({body:'sat:25544',epoch:elementsFor('sat:25544').epoch+60*3600000,timeZone:'UTC',clock24:true,plate:'operations',corner:'light'});
  assert.ok(old.scene.minutes.every(m=>m.corner.startsWith('EL OLD')));
});
