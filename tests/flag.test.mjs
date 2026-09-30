import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EnrouteRenderer,PLATES,W} from '../src/enroute-render.js';
import {decodeRelief} from '../src/relief.js';
import {MINUTE} from '../src/ephemeris.js';

const atlas=new Uint8Array(readFileSync('public/land.bin')),meters=decodeRelief(new Uint8Array(readFileSync('public/relief.bin')));
const overlap=(a,b)=>!(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y);

test('the minute flag flies between the route and the hour figures, all hour',()=>{
  for(const [body,hour] of [['sun',Date.parse('2026-09-27T08:00:00Z')],['moon',Date.parse('2026-09-15T12:00:00Z')]]){
    const r=new EnrouteRenderer(atlas,meters);
    for(let m=0;m<60;m+=3){
      const out=r.render({body,epoch:hour+m*MINUTE,timeZone:'UTC',clock24:true,plate:'enroute',readout:'flag'}),{readout:flag,box,nextBox,index}=out.figure;
      assert.ok(flag&&flag.h===11,`${body} ${m}`);
      // Above the route, under the figures, clear of both, and on the face.
      assert.ok(flag.y+flag.h<=out.marker.y-12&&flag.x>=0&&flag.x+flag.w<=W,`${body} ${m}`);
      for(const b of [box,nextBox])assert.ok(!overlap(flag,b),`${body} ${m}: flag on a figure`);
      // The staff stands on the body: the flag's near edge is at the body.
      assert.ok(Math.min(Math.abs(flag.x-out.marker.x),Math.abs(flag.x+flag.w-out.marker.x))<=2,`${body} ${m}`);
      // The minutes are reversed out: paper pixels inside the flag.
      const ink=PLATES.enroute.route[0].join();let paper=0,inked=0;
      for(let y=flag.y;y<flag.y+flag.h;y++)for(let x=flag.x;x<flag.x+flag.w;x++){const c=[...out.buf.slice((y*W+x)*3,(y*W+x)*3+3)].join();if(c===ink)inked++;else paper++;}
      assert.ok(inked>paper&&paper>8,`${body} ${m}`);
    }
  }
});

test('on a slow orbit’s steep route the flag leans out on the figures’ side, clear of the figures',async()=>{
  const {registerNominal}=await import('../src/nominal.js');registerNominal();
  const r=new EnrouteRenderer(atlas,meters),day=Date.parse('2026-09-27T00:00:00Z');
  for(let h=0;h<12;h++){
    const out=r.render({body:'sat:36585',epoch:day+h*3600000+24*MINUTE,timeZone:'UTC',clock24:true,plate:'enroute',readout:'flag'}),{readout:flag,box,nextBox}=out.figure;
    assert.ok(flag&&flag.x>=0&&flag.x+flag.w<=W&&flag.y>=0,`hour ${h}`);
    for(const b of [box,nextBox])assert.ok(!overlap(flag,b),`hour ${h}: flag on a figure`);
    // The flag stands off the route: none of the hour's track runs through it.
    const through=r.camera.track.filter(p=>p.hour&&p.x>=flag.x&&p.x<flag.x+flag.w&&p.y>=flag.y&&p.y<flag.y+flag.h).length;
    assert.equal(through,0,`hour ${h}: route through the flag`);
  }
});
