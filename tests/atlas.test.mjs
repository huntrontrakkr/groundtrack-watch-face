import test from 'node:test';
import assert from 'node:assert/strict';
import {V,F,EDGES,forwardFace,inverseFace,faceOf,flatPoint} from '../src/fuller.js';
import {unfold,across,joined,mapTrack} from '../src/unfold.js';
import {atlasCamera,localNorth} from '../src/atlas-camera.js';
import {dot,norm,direction} from '../src/geometry.js';
import {sampleTrack,MINUTE} from '../src/ephemeris.js';
import {groundTone,lightPixel} from '../src/atlas-render.js';
import {numeral} from '../src/art-render.js';
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
test('Fuller faces form a regular icosahedron in the inherited geographic orientation',()=>{
  assert.equal(V.length,12);assert.equal(F.length,20);
  for(const f of F)for(const [a,b] of EDGES)assert.ok(Math.abs(dot(V[f[a]],V[f[b]])-1/Math.sqrt(5))<1e-12);
  assert.ok(distance(V[2],norm([.518837,.835420,.181332]))<2e-6);
  for(let f=0;f<20;f++)for(let i=0;i<3;i++)assert.ok(distance(forwardFace(f,V[F[f][i]]),[0,1,2].map(k=>+(k===i)))<1e-12);
});
test('nonlinear Fuller projection roundtrips the sphere, including poles and date line',()=>{
  for(let lat=-90;lat<=90;lat+=3)for(let lon=-180;lon<=180;lon+=7){
    const d=direction(lat,lon),f=faceOf(d),w=forwardFace(f,d);
    assert.ok(Math.min(...w)>-1e-10);assert.ok(distance(d,inverseFace(f,w))<2e-10);
  }
  const weights=[.73,.19,.08],d=norm(weights.map((_,k)=>weights.reduce((s,w,i)=>s+w*V[F[0][i]][k],0)));
  assert.ok(distance(forwardFace(0,d),weights)>.001,'Must not regress to gnomonic barycentrics');
});
test('all true unfolded joins map the same geographic edge without a gap',()=>{
  const atlas=unfold(0,7);let joins=0,seams=0;
  for(const tile of atlas.tiles)for(let e=0;e<3;e++){
    const link=tile.links[e];if(!link.tile)continue;
    const expected=across(tile,e);
    if(link.seam){seams++;assert.ok(!joined(tile,link.tile));continue;}
    assert.equal(link.tile.face,expected.face);joins++;
    const [a,b]=EDGES[e];
    for(const t of [.03,.25,.5,.87]){
      const va=V[F[tile.face][a]],vb=V[F[tile.face][b]],theta=Math.acos(dot(va,vb));
      const d=va.map((q,k)=>(q*Math.sin((1-t)*theta)+vb[k]*Math.sin(t*theta))/Math.sin(theta));
      assert.ok(distance(flatPoint(forwardFace(tile.face,d),tile.tri),flatPoint(forwardFace(link.tile.face,d),link.tile.tri))<1e-9);
    }
  }
  assert.ok(joins>100);assert.ok(seams>0,'Five triangles cannot be silently welded into a six-triangle planar vertex');
});
test('the archived ISS path breaks at incompatible copies and never bridges a cut',()=>{
  const start=Date.parse('2019-06-05T12:00Z'),samples=sampleTrack('iss',start,start+60*MINUTE,MINUTE/4),atlas=unfold(faceOf(samples[120].dir),14),path=mapTrack(atlas,samples);
  assert.ok(path.some(p=>p.cut));
  for(let i=1;i<path.length;i++)assert.equal(path[i].cut,!joined(path[i-1].tile,path[i].tile));
});
test('focused camera covers the display and advances between the two hour stations',()=>{
  for(const [body,date] of [['moon','2026-09-16T08:00Z'],['sun','2026-09-27T08:00Z'],['iss','2019-06-05T12:00Z']]){
    const c=atlasCamera(body,Date.parse(date),60);
    assert.equal(c.end-c.start,60*MINUTE);assert.ok(c.track[0].y>c.track.at(-1).y);
    for(let y=0;y<228;y+=9)for(let x=0;x<200;x+=9){
      const p=c.at(x+.5,y+.5);assert.ok(p,`${body}: atlas uncovered at ${x},${y}`);
      const q=c.projectIn(p.tile,p.dir);assert.ok(Math.hypot(q.x-x-.5,q.y-y-.5)<1e-7);
    }
    const p=c.track[120]||c.track[30],n=localNorth(c,p);assert.ok(Math.abs(Math.hypot(n.x,n.y)-1)<1e-9);
  }
});
test('flat fields are solid; dither is restricted to the lighting transition',()=>{
  assert.equal(groundTone(true,1),1);assert.equal(groundTone(true,-1),0);assert.equal(groundTone(true,1,true),0);
  assert.equal(groundTone(false,1),0);assert.equal(groundTone(false,-1),0);
  for(let y=0;y<32;y++)for(let x=0;x<32;x++){assert.equal(lightPixel(1,x,y),true);assert.equal(lightPixel(0,x,y),false);}
  const nearTerminator=groundTone(true,0);assert.ok(nearTerminator>0&&nearTerminator<1);
  let count=0;for(let y=0;y<32;y++)for(let x=0;x<32;x++)count+=+lightPixel(nearTerminator,x,y);
  assert.equal(count,512);
});
test('closed numeral counters stay available for legibility in exaggerated towers',()=>{
  for(const value of ['0','6','8','9','08','18','20'])assert.ok(numeral(value).counters.some(Boolean));
  for(const value of ['1','2','3','5','7'])assert.ok(!numeral(value).counters.some(Boolean));
});
