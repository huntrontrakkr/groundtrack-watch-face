import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EnrouteRenderer,SCALE,W} from '../src/enroute-render.js';
import {decodeRelief} from '../src/relief.js';
import {MINUTE} from '../src/ephemeris.js';

const atlas=new Uint8Array(readFileSync('public/land.bin')),meters=decodeRelief(new Uint8Array(readFileSync('public/relief.bin')));
const HOUR=Date.parse('2019-06-05T12:00:00Z');
const state=(m,tape)=>({body:'iss',epoch:HOUR+m*MINUTE,timeZone:'UTC',clock24:false,plate:'enroute',tape});

test('on the tape the index stands still and the hours ride past, this hour pinned at the left',()=>{
  const r=new EnrouteRenderer(atlas,meters);
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

test('with the world sliding too, the satellite stays under the index',()=>{
  const r=new EnrouteRenderer(atlas,meters);
  for(const m of [0,17,33,59]){const out=r.render(state(m,'slide'));assert.ok(Math.abs(out.marker.x-W/2)<=1.5,`minute ${m}: ${out.marker.x}`);}
  // The fixed ruler is unchanged by default.
  const fixed=r.render({...state(24),tape:undefined});assert.ok(fixed.figure.index.x>SCALE.x0&&fixed.figure.index.x<W/2);
});
