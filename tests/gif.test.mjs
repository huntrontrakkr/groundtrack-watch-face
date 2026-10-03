// The store's animated screenshots (tools/gif.mjs): decoded again (by a
// decoder written from the format, not from the encoder), every frame is
// the frame given, looping, at its delay; and the committed reels are the
// watch's size and timing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {encodeGIF,decodeGIF} from '../tools/gif.mjs';
import {W,H} from '../src/plates.js';

test('a GIF decodes to the frames it was made of',()=>{
  // Noise in many colours (the code table fills and clears), and flat frames.
  let s=7;const r=()=>{s=(s*1103515245+12345)%2147483648;return s;};
  const w=61,h=37,frames=[];
  for(let f=0;f<3;f++){const b=new Uint8Array(w*h*3);for(let i=0;i<w*h;i++){const c=f===2?5:r()%(f?200:3);b[3*i]=c;b[3*i+1]=c*7&255;b[3*i+2]=c*13&255;}frames.push(b);}
  const d=decodeGIF(encodeGIF(frames,w,h,50));
  assert.equal(d.loops,0);assert.equal(d.frames.length,3);
  d.frames.forEach((f,k)=>{assert.equal(f.delay,50);assert.ok(Buffer.from(f.rgb).equals(Buffer.from(frames[k])),`frame ${k}`);});
});

test('each face opens its store gallery with a reel: the watch\'s screen, half a second a frame',()=>{
  for(const face of ['enroute','fuller']){
    const dir=`docs/screenshots/store/${face}`,gifs=readdirSync(dir).filter(f=>f.endsWith('.gif'));
    assert.deepEqual(gifs,['emery_00_reel.gif'],face);
    const d=decodeGIF(new Uint8Array(readFileSync(`${dir}/${gifs[0]}`)));
    assert.deepEqual([d.width,d.height,d.loops],[W,H,0]);
    assert.ok(d.frames.length>=10&&d.frames.every(f=>f.delay===50),face);
  }
});
