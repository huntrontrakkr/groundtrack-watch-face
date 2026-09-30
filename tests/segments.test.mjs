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
