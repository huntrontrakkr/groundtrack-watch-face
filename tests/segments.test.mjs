// The Sun and Moon segments: close to Astronomy Engine, and evaluated by the
// watch's C to exactly the same bits as by the JavaScript.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {Body,GeoVector,RotateVector,Rotation_EQJ_EQD,EquatorFromVector,SiderealTime,Illumination,MoonPhase} from 'astronomy-engine';
import {segmentFor,segmentPosition,segmentMoonLight,encodeSegment,decodeSegment,SEGMENT_BYTES} from '../src/segments.js';

const wrap=l=>((l+540)%360)-180;
const times=[];for(let t=Date.parse('2025-01-01T00:00:00Z');t<Date.parse('2027-01-01T00:00:00Z');t+=7*3600000+13*60000+17000)times.push(t);

test('segments stay within a few metres of Astronomy Engine',()=>{
  let lat=0,lon=0,fraction=0;
  for(const t of times.filter((_,i)=>i%5===0)){
    const date=new Date(t);
    for(const [k,b] of [['sun',Body.Sun],['moon',Body.Moon]]){
      const eq=EquatorFromVector(RotateVector(Rotation_EQJ_EQD(date),GeoVector(b,date,true))),p=segmentPosition(k,t);
      lat=Math.max(lat,Math.abs(p.lat-eq.dec));lon=Math.max(lon,Math.abs(wrap(p.lon-wrap((eq.ra-SiderealTime(date))*15))));
    }
    const m=segmentMoonLight(t);fraction=Math.max(fraction,Math.abs(m.fraction-Illumination(Body.Moon,date).phase_fraction));
    assert.equal(m.waxing,MoonPhase(date)<180,new Date(t).toISOString());
  }
  // 5e-5° is about 5 m on the ground, 0.0005 px on the hour chart.
  assert.ok(lat<5e-5&&lon<5e-5,`lat ${lat}, lon ${lon}`);assert.ok(fraction<1e-6,`fraction ${fraction}`);
});

test('segments survive their bytes',()=>{
  const seg=segmentFor(Date.parse('2026-09-29T12:00:00Z')),bytes=encodeSegment(seg);
  assert.equal(bytes.length,SEGMENT_BYTES);assert.deepEqual(decodeSegment(bytes),seg);
});

let cc=true;try{execFileSync('make',['-s','-C','native/host','segments_test'],{stdio:'pipe'});}catch{cc=false;}
test('the sunlight estimate uses satellite height, and Earth shadow rather than ground night',{skip:!cc&&'no C compiler'},()=>{
  const cases=[[410,1,false],[410,-1,true],[410,-.2,false],[410,-.8,true],[35786,-.98,false],[35786,-.999,true]];
  // Independent apparent-disc geometry: the Sun is fully behind Earth's
  // disc, away from the narrow boundary where a spherical cone is approximate.
  for(const altitude of [410,20200,35786])for(let angle=0;angle<=90;angle+=.5){
    const separation=angle*Math.PI/180,earth=Math.asin(6371/(6371+altitude)),solar=.00465;
    if(Math.abs(earth-solar-separation)<.001)continue;
    cases.push([altitude,-Math.cos(separation),separation+solar<earth]);
  }
  const got=execFileSync('native/host/segments_test',{input:cases.map(([h,d])=>`shadow ${h} ${d}`).join('\n')+'\n'}).toString().trim().split('\n');
  assert.deepEqual(got,cases.map(([, ,dark])=>dark?'1':'0'));
});
test('the watch evaluates segments to the same bits',{skip:!cc&&'no C compiler'},()=>{
  const bits=v=>{const d=new DataView(new ArrayBuffer(8));d.setFloat64(0,v);return d.getBigUint64(0).toString(16).padStart(16,'0');};
  const hex=b=>Buffer.from(b).toString('hex');
  const lines=[],expected=[];
  for(const t of times){
    const s=Math.floor(t/1000),seg=segmentFor(t),a=segmentPosition('sun',t),b=segmentPosition('moon',t),m=segmentMoonLight(t);
    lines.push(`${hex(encodeSegment(seg))} ${s}`);
    expected.push(`${bits(a.lat)} ${bits(a.lon)} ${bits(b.lat)} ${bits(b.lon)} ${bits(m.fraction)} ${m.waxing?1:0}`);
  }
  const got=execFileSync('native/host/segments_test',{input:lines.join('\n')+'\n'}).toString().trim().split('\n').map(l=>l.trim());
  assert.equal(got.length,expected.length);
  let differ=0,first=null;for(let i=0;i<got.length;i++)if(got[i]!==expected[i]){differ++;first??=`${new Date(times[i]).toISOString()}: C ${got[i]} JS ${expected[i]}`;}
  assert.equal(differ,0,`${differ} of ${got.length} differ; first ${first}`);
});

// Sine and cosine: the watch's C computes the JavaScript's bits.
let fm=true;try{execFileSync('make',['-s','-C','native/host','fmath_test'],{stdio:'pipe'});}catch{fm=false;}
test('the watch computes sines, arcsines, arctangents, square roots and remainders to the same bits',{skip:!fm&&'no C compiler'},async()=>{
  const {sin,cos,asin,acos,atan,atan2}=await import('../src/fmath.js');
  const bits=v=>{const d=new DataView(new ArrayBuffer(8));d.setFloat64(0,v);return d.getBigUint64(0).toString(16).padStart(16,'0');};
  const xs=[0,-0,1e-300,Math.PI/4,Math.PI/2,Math.PI,2*Math.PI,-Math.PI];let s=20260930;const r=()=>{s=(s*1103515245+12345)%2147483648;return s/2147483648;};
  for(let i=0;i<60000;i++)xs.push(i%3?(r()*2-1)*Math.PI:(r()*2-1)*720);
  for(let v=-400;v<=400;v++)xs.push(v,v+.5);
  // Each with a second argument for atan2, across signs, zeros and scales.
  const cs=[1,-1,0,-0,1e-9,-3e7];xs.push(800,-800,799.9999999,-400,400);
  const pairs=xs.map((x,i)=>[x,i<cs.length*4?cs[i%cs.length]:(r()*2-1)*10**Math.floor(r()*8-3)]);
  const text=pairs.map(([x,c])=>`${x.toPrecision(17)} ${c.toPrecision(17)}`).join('\n'),parsed=text.split('\n').map(l=>l.split(' ').map(Number));
  const got=execFileSync('native/host/fmath_test',{input:text,maxBuffer:1<<26}).toString().split('\n');
  let differ=0,first=null;parsed.forEach(([x,c],i)=>{
    const s=Math.max(-1,Math.min(1,x/800)),want=`${bits(sin(x))} ${bits(cos(x))} ${bits(Math.sqrt(Math.abs(x)))} ${bits(x%7.25)} ${bits((x*97)%5)} ${bits(asin(s))} ${bits(acos(s))} ${bits(atan2(x,c))} ${bits(atan(x))} `;
    if(got[i]!==want){differ++;first??=`${x} ${c}: C ${got[i]} JS ${want}`;}
  });
  assert.equal(differ,0,first);
  // And within an ulp of the engine's own.
  const near=(f,g)=>Math.abs(f-g)<=Math.abs(g)*2.3e-16+1e-300;
  for(const [x,c] of parsed.slice(0,4000)){
    const s=Math.max(-1,Math.min(1,x/800));
    for(const [f,g] of [[sin(x),Math.sin(x)],[cos(x),Math.cos(x)],[asin(s),Math.asin(s)],[acos(s),Math.acos(s)],[atan2(x,c),Math.atan2(x,c)],[atan(x),Math.atan(x)]])assert.ok(near(f,g),`${x} ${c}: ${f} ${g}`);
  }
});

test('the watch evaluates satellite segments to the same bits',{skip:!cc&&'no C compiler'},async()=>{
  const {registerElements,bodyId}=await import('../src/satellites.js');
  const {satelliteSegmentFor,satelliteSegmentPosition,encodeSatelliteSegment}=await import('../src/segments.js');
  const {fixtureTLE}=await import('./tle-fixture.mjs');
  const bits=v=>{const d=new DataView(new ArrayBuffer(8));d.setFloat64(0,v);return d.getBigUint64(0).toString(16).padStart(16,'0');};
  const now=Date.parse('2026-09-27T13:00:00Z'),lines=[],expected=[];
  for(const norad of [25544,36585]){
    registerElements(fixtureTLE(now,norad),'test');
    for(let t=now-7200000;t<now+2*86400000;t+=3*3600000+17*60000+13000){
      const s=Math.floor(t/1000),p=satelliteSegmentPosition(bodyId(norad),t);
      lines.push(`sat ${Buffer.from(encodeSatelliteSegment(satelliteSegmentFor(bodyId(norad),t))).toString('hex')} ${s}`);
      expected.push(`${bits(p.lat)} ${bits(p.lon)} ${bits(p.altitude)}`);
    }
  }
  const got=execFileSync('native/host/segments_test',{input:lines.join('\n')+'\n'}).toString().trim().split('\n').map(l=>l.trim());
  assert.deepEqual(got,expected);
});
