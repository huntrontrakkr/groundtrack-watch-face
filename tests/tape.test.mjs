import test from 'node:test';
import assert from 'node:assert/strict';
import {SCALE,W} from '../src/plates.js';
import {MINUTE} from '../src/ephemeris.js';
import {renderer} from './core-fixture.mjs';

const HOUR=Date.parse('2019-06-05T12:00:00Z');
const state=(m,tape)=>({body:'iss',epoch:HOUR+m*MINUTE,timeZone:'UTC',clock24:false,plate:'enroute',tape});

test('on the tape the index stands still and the hours ride past, this hour pinned at the left',async()=>{
  const r=await renderer();
  for(let m=0;m<60;m+=3){
    const out=r.render(state(m,'tape')),{index,box,nextBox,hour,next}=out.figure;
    assert.deepEqual([index.x,index.y],[W/2,SCALE.baseline]);assert.equal(hour,'12');assert.equal(next,'1');
    // This hour is always readable, whole, at or right of the left edge,
    // and never runs into the next hour's figure.
    assert.ok(box.x>=4&&box.y>=4&&box.y+box.h<=SCALE.baseline-6,`minute ${m}`);
    if(nextBox)assert.ok(box.x+box.w+8<=nextBox.x,`minute ${m}`);
    // Until it is pushed, this hour rides its own mark: 3 px a minute left.
    const mark=W/2-m*3;if(mark-box.w/2>=4&&(!nextBox||box.x+box.w+8<nextBox.x))assert.ok(Math.abs(box.x+box.w/2-mark)<=1,`minute ${m}`);
  }
  // The next hour arrives from the right as the hour ends.
  assert.equal(r.render(state(20,'tape')).figure.nextBox,null);
  assert.ok(r.render(state(50,'tape')).figure.nextBox.x<W);
});

test('with the world sliding too, the satellite stays under the index',async()=>{
  const r=await renderer();
  for(const m of [0,17,33,59]){const out=r.render(state(m,'slide'));assert.ok(Math.abs(out.marker.x-W/2)<=1.5,`minute ${m}: ${out.marker.x}`);}
  // The fixed ruler is unchanged by default.
  const fixed=r.render({...state(24),tape:undefined});assert.ok(fixed.figure.index.x>SCALE.x0&&fixed.figure.index.x<W/2);
});

test('the sliding world leaves the tape\'s panel as the tape alone draws it, and keeps its date, every minute',async()=>{
  // (The band's columns come round as it slides; the panel's must not: the
  // tape's labels a little past its ends once came back in at the far side,
  // "45 45", and the date went missing the minute the satellite stood at
  // the centre.)
  const r=await renderer(),PANEL=67;
  for(const hour of [0,5,11]){
    let dated=0;
    for(let m=0;m<60;m++){
      const epoch=HOUR+hour*3600000+m*MINUTE,tape=Buffer.from(r.render({...state(0,'tape'),epoch}).frame),slide=Buffer.from(r.render({...state(0,'slide'),epoch}).frame);
      assert.ok(tape.subarray(0,PANEL*W).equals(slide.subarray(0,PANEL*W)),`hour ${hour} minute ${m}: the panel differs`);
      // The date's row of lettering, under the panel (ink on the plate's space).
      const s=r.scene,row=slide.subarray((s.height.baseline-6)*W,(s.height.baseline+1)*W),ground=row[W-1];
      if(row.subarray(0,W/2).some(v=>v!==ground))dated++;
    }
    assert.equal(dated,60,`hour ${hour}: the date is drawn in ${dated} of its 60 minutes`);
  }
});
