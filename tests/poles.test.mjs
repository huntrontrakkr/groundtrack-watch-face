// The hour chart near the poles. A chart that would reach within ten
// degrees of a pole is a polar chart (native/src/c/chart.c place()), north up
// at its middle, its ground read off the map pack's polar caps; and the
// pack is pole to pole for the charts short of that. (A flat chart cut at
// 79°N drew its last row again and again, in stripes; one reaching a pole
// draws its meridians apart.)
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerElements,addSatellite,bodyId,checksum,propagatePosition} from '../src/satellites.js';
import {W} from '../src/plates.js';
import {renderer} from './core-fixture.mjs';

// CelesTrak's elements of 2 October 2026: GLONASS-K2, tilted 64.8°.
const GLO=bodyId(57517),lines=readFileSync(new URL('./fixtures/celestrak-2026-10-02.tle',import.meta.url),'utf8').trim().split('\n');
for(let i=0;i+2<lines.length;i+=3)if(Number(lines[i+1].slice(2,7))===57517)registerElements(lines.slice(i,i+3).join('\n')+'\n','fixture');
// Slow orbits over the poles, which the catalog has none of: a Molniya
// orbit (Meridian 7's of that day) stood upright, its high end in the north
// (99001) or the south (99002).
const sum=l=>l+checksum(l),NORTH=bodyId(99001),SOUTH=bodyId(99002);
for(const [n,perigee] of [[99001,'269.8252'],[99002,' 90.0000']]){
  addSatellite({norad:n,name:'Polar',code:'POL',period:717.8,ecc:.66});
  registerElements(`POLAR\n${sum(`1 ${n}U 14069A   26274.86311510  .00000249  00000+0  00000+0 0  999`)}\n${sum(`2 ${n}  89.5000 204.9765 6611590 ${perigee}  20.3127  2.00606791 8737`)}\n`,'fixture');
}
const at=iso=>Date.parse(iso),draw=async(body,iso,home)=>(await renderer()).render({body,epoch:at(iso),timeZone:'UTC',clock24:true,plate:'enroute',...(home?{home}:{})});
// How much of the frame from row y0 to y1, columns x0 to x1, is the pixel
// four rows above over again (four rows: the night's dots repeat by them).
// Nearly all of it where a row is drawn out in stripes (.93 and .95 here with
// the pack cut at 79°N and 66°S); about two thirds where there is a map.
const drawnOut=(out,x0,x1,y0,y1)=>{
  const px=(x,y)=>{const o=(y*W+x)*3;return out.buf[o]<<16|out.buf[o+1]<<8|out.buf[o+2];};let n=0;
  for(let y=y0+4;y<=y1;y++)for(let x=x0;x<x1;x++)if(px(x,y)===px(x,y-4))n++;
  return n/((x1-x0)*(y1-y0-3));
};

test('GLONASS keeps its hour chart where the orbit turns, north and south, with the map to the edge',async()=>{
  // Over Alaska and the Arctic, the hours 0.4.3 put on the world band.
  for(const iso of ['2026-10-02T19:20:00Z','2026-10-02T20:20:00Z']){
    const out=await draw(GLO,iso);assert.equal(out.world,false,iso);
    assert.ok(drawnOut(out,0,200,16,200)<.85,`${iso}: ${drawnOut(out,0,200,16,200)}`);
  }
  // South of Africa, Antarctica's coast along the bottom.
  const south=await draw(GLO,'2026-10-02T13:40:00Z');
  assert.equal(south.world,false);
  assert.ok(drawnOut(south,0,200,190,210)<.85,`south: ${drawnOut(south,0,200,190,210)}`);
});

// The ground under a place (its class's low nibble: 0 water, 1 land, 3 to
// 7 land's tints, 8 on the depths), from the place drawn as home.
const ground=async(body,iso,lat,lon)=>{
  const {theCore}=await import('./core-fixture.mjs'),core=await theCore(),out=await draw(body,iso,{code:'HOM',name:'Home',lat,lon});
  assert.ok(out.home,`${body} ${iso}: ${lat}, ${lon} not drawn`);
  const g=core.classAt(out.slot,out.home.x,out.home.y)&15;return {out,land:g===1||g>=3&&g<8};
};

test('an hour over either pole keeps its hour chart, the map under it',async()=>{
  // The North Pole is sea, the South Pole ice on land.
  // (The hours that cross them: the hours before and after are polar
  // charts too.)
  for(const iso of ['2026-10-02T23:20:00Z','2026-10-03T00:20:00Z','2026-10-03T03:20:00Z'])assert.equal((await draw(NORTH,iso)).world,false,iso);
  for(const iso of ['2026-10-02T11:20:00Z','2026-10-02T12:20:00Z','2026-10-02T15:20:00Z'])assert.equal((await draw(SOUTH,iso)).world,false,iso);
  for(const iso of ['2026-10-03T01:20:00Z','2026-10-03T02:20:00Z']){const {out,land}=await ground(NORTH,iso,89.99,0);assert.equal(out.world,false,iso);assert.equal(land,false,iso);}
  for(const iso of ['2026-10-02T13:20:00Z','2026-10-02T14:20:00Z']){const {out,land}=await ground(SOUTH,iso,-89.99,0);assert.equal(out.world,false,iso);assert.equal(land,true,iso);}
  // And places about each hour's middle, wherever the world's land bits
  // (public/land.bin, 0.25°) are one thing for a degree round: the chart's
  // ground there is the same.
  const bits=new Uint8Array(readFileSync(new URL('../public/land.bin',import.meta.url))),landAt=(lat,lon)=>{const i=Math.min(719,Math.floor((90-lat)*4))*1440+((Math.floor((lon+180)*4))%1440+1440)%1440;return (bits[i>>3]>>(i&7)&1)===1;};
  let checked=0;
  for(const [body,iso] of [[NORTH,'2026-10-02T23:20:00Z'],[NORTH,'2026-10-03T01:20:00Z'],[NORTH,'2026-10-03T03:20:00Z'],[SOUTH,'2026-10-02T11:20:00Z'],[SOUTH,'2026-10-02T13:20:00Z'],[SOUTH,'2026-10-02T15:20:00Z'],[GLO,'2026-10-02T19:20:00Z'],[GLO,'2026-10-02T20:20:00Z']]){
    const mid=propagatePosition(body,at(iso)+10*60e3);
    for(const [dl,dn] of [[2,0],[-2,0],[0,6],[0,-6],[4,4],[-4,-4]]){
      const lat=Math.max(-89.5,Math.min(89.5,mid.lat+dl)),lon=mid.lon+dn,want=landAt(lat,lon);
      let one=true;for(let a=-.5;a<=.5;a+=.25)for(let o=-.5/Math.cos(lat*Math.PI/180);o<=.5/Math.cos(lat*Math.PI/180);o+=.25)if(landAt(lat+a,lon+o)!==want)one=false;
      if(!one)continue;
      const out=await draw(body,iso,{code:'HOM',name:'Home',lat,lon});if(!out.home)continue;
      const {theCore}=await import('./core-fixture.mjs'),g=(await theCore()).classAt(out.slot,out.home.x,out.home.y)&15;
      assert.equal(g===1||g>=3&&g<8,want,`${body} ${iso}: ${lat.toFixed(1)}, ${lon.toFixed(1)}`);checked++;
    }
  }
  assert.ok(checked>=20,`only ${checked} places checked`);
});

test('a polar chart has north up at its middle',async()=>{
  // Home three degrees north of the hour's middle stands above it.
  for(const [body,iso] of [[NORTH,'2026-10-02T23:20:00Z'],[SOUTH,'2026-10-02T11:20:00Z'],[GLO,'2026-10-02T20:20:00Z']]){
    // (The hour began at :00.)
    const t=at(iso)-20*60e3,mid=propagatePosition(body,t+1800e3),out=await draw(body,iso,{code:'HOM',name:'Home',lat:mid.lat+3,lon:mid.lon});
    const [s0,s1]=out.stationsOnRoute,mx=(s0.x+s1.x)/2,my=(s0.y+s1.y)/2;
    assert.ok(out.home,`${body}: home not drawn`);
    const dx=out.home.x-mx,dy=out.home.y-my;
    assert.ok(dy<-10&&Math.abs(dx)<-dy/3,`${body}: home at ${dx.toFixed(0)}, ${dy.toFixed(0)} from the middle`);
  }
});
