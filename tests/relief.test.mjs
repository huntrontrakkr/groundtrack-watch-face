import test from 'node:test';
import assert from 'node:assert/strict';
import {mixDisplayColor,quantizeImage,coastDistance,soften} from '../src/color-mix.js';
import {atlasCamera} from '../src/atlas-camera.js';
import {dot} from '../src/geometry.js';
import {sunVolumeHit} from '../src/art-light.js';
import {glyphGeometry,sculptureGeometry} from '../src/art-render.js';

test('color mixing keeps native colors exact and neutral colors neutral',()=>{
  for(let r=0;r<256;r+=85)for(let g=0;g<256;g+=85)for(let b=0;b<256;b+=85)for(let y=0;y<4;y++)for(let x=0;x<4;x++)assert.deepEqual(mixDisplayColor([r,g,b],x,y),[r,g,b]);
  for(let v=0;v<256;v+=7)for(let y=0;y<4;y++)for(let x=0;x<4;x++){
    const c=mixDisplayColor([v,v,v],x,y);assert.equal(c[0],c[1]);assert.equal(c[1],c[2]);assert.ok(c.every(k=>k%85===0));
  }
});
test('spatial mixtures recover intermediate luminance better than hard quantization',()=>{
  const linear=v=>(v/255)**2.2;
  for(const v of [40,110,135,198,218,237]){
    let mean=0;for(let y=0;y<4;y++)for(let x=0;x<4;x++)mean+=linear(mixDisplayColor([v,v,v],x,y)[0])/16;
    const naive=linear(mixDisplayColor([v,v,v],0,0,false)[0]),goal=linear(v);
    assert.ok(Math.abs(mean-goal)<Math.abs(naive-goal),`${v}: mixture ${mean} should improve on ${naive}`);
    assert.ok(Math.abs(mean-goal)<.025);
  }
});
test('one shade never becomes opposing hue confetti and is stable between frames',()=>{
  for(const target of [[213,211,192],[111,149,136],[209,151,113],[10,86,100],[61,90,94]]){
    const colors=new Map();for(let y=0;y<16;y++)for(let x=0;x<16;x++){const c=mixDisplayColor(target,x,y);colors.set(c.join(','),c);assert.deepEqual(c,mixDisplayColor(target,x+16,y+16));}
    assert.ok(colors.size<=2);
    if(colors.size===2){const [a,b]=[...colors.values()],delta=a.map((v,k)=>v-b[k]);assert.ok(!delta.some(v=>v<0)||!delta.some(v=>v>0));}
  }
  const data=Uint8ClampedArray.from({length:4*11*7},(_,i)=>(i*37)%256),source={data,width:11,height:7};
  const a=quantizeImage(source),b=quantizeImage(source);assert.deepEqual(a,b);
  for(let i=0;i<a.length;i++)assert.equal(i%4===3?a[i]:a[i]%85,i%4===3?255:0);
});
test('shore distance and shadow penumbra preserve uniform fields and symmetries',()=>{
  const w=19,h=19,mask=Uint8Array.from({length:w*h},(_,i)=>+(Math.hypot(i%w-9,Math.floor(i/w)-9)<6)),d=coastDistance(mask,w,h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){assert.equal(d[y*w+x]>0,!!mask[y*w+x]);assert.ok(Math.abs(d[y*w+x]-d[x*w+y])<1e-5);}
  assert.ok(soften(new Float32Array(w*h).fill(.75),w,h).every(v=>v===.75));
  const soft=soften(mask,w,h);assert.equal(soft[9*w+9],1);assert.equal(soft[0],0);assert.ok(soft.some(v=>v>0&&v<1));
});
test('pitched Fuller camera roundtrips real geography without affine distortion',()=>{
  for(const [body,date] of [['moon','2026-09-15T12:00Z'],['sun','2026-09-27T08:00Z'],['iss','2019-06-05T12:00Z']]){
    const c=atlasCamera(body,Date.parse(date),60,'wide',{cx:124,cy:129,width:114,height:160,minWidth:.14,aspect:1,perspective:.0009});
    for(let y=1;y<228;y+=11)for(let x=1;x<200;x+=13){const p=c.at(x,y);assert.ok(p);const q=c.projectIn(p.tile,p.dir);assert.ok(Math.hypot(q.x-x,q.y-y)<1e-6);}
    assert.ok(c.track[0].y>c.track.at(-1).y);
  }
});
test('optical numeral correction retains a physical plane and correct shadow coordinates',()=>{
  const c=atlasCamera('moon',Date.parse('2026-09-15T12:00Z'),60),p=c.at(75,150),local=c.forTower(p.dir,p.tile,true),plane=local.plane(p.dir,.01);
  assert.ok(Math.abs(dot(plane.u,plane.dualU)-1)<1e-12);assert.ok(Math.abs(dot(plane.v,plane.dualU))<1e-12);
  assert.ok(Math.abs(dot(plane.v,plane.dualV)-1)<1e-12);assert.ok(Math.abs(dot(plane.u,plane.dualV))<1e-12);
  for(const [u,v] of [[0,0],[.01,.02],[-.015,.01]]){const q=local.projectWorld(plane.at(u,v)),inverse=plane.inverse(q.x,q.y);assert.ok(Math.hypot(inverse.x-u,inverse.y-v)<.00002);}
  const glyph=glyphGeometry(local,p.dir,'8',.01);
  const sculpture=sculptureGeometry(local,p.dir,'8',.01);
  assert.ok(sculpture.fragments.every(f=>Math.abs(Math.hypot(...f.normal)-1)<1e-10));
  // A point directly beneath a solid part must hit; beneath its empty
  // counter must not. Use nearly tangent local geometry for this ray test.
  const at=(u,v)=>{const w=glyph.plane.at((u+.5-glyph.mask.w/2)*glyph.sx,(glyph.mask.h/2-v-.5)*glyph.sy);const length=Math.hypot(...w);return w.map(q=>q/length);};
  let hit=false,clear=false;
  for(let v=0;v<glyph.mask.h;v++)for(let u=0;u<glyph.mask.w;u++){
    if(glyph.mask.bits[v*glyph.mask.w+u])hit ||= sunVolumeHit(at(u,v),p.dir,glyph);
    if(glyph.mask.counters[v*glyph.mask.w+u])clear ||= !sunVolumeHit(at(u,v),p.dir,glyph);
  }
  assert.ok(hit);assert.ok(clear);
});
