// Sun and Moon as Chebyshev segments, one per UTC day, fitted to Astronomy
// Engine. The browser, the phone and the watch all take their positions from
// these, so they agree to the bit: the phone fits them and sends the watch a
// couple of months' worth, and the watch evaluates them with the same
// arithmetic (native/src/c/segments.c). Against Astronomy Engine they are
// within 1e-7° in latitude and 5e-6° in longitude.
//
// A segment holds, as float32 coefficients over the day (u = -1 at 00:00 UTC,
// +1 at 24:00): the subsolar and sublunar latitude and longitude (longitude
// unwrapped: it may leave -180..180), the Moon's lit fraction and its phase
// angle (Astronomy Engine's MoonPhase, unwrapped; waxing below 180 mod 360),
// and the Sun's and Moon's distance in km. Segment bytes (little-endian):
// i32 day (days since 1970-01-01), then per series its coefficients as f32,
// in SERIES order.
import {Body,GeoVector,RotateVector,Rotation_EQJ_EQD,EquatorFromVector,SiderealTime,Illumination,MoonPhase} from 'astronomy-engine';
import {elementsFor,propagatePosition,FRESH} from './satellites.js';

export const DAY=86400000;
export const SERIES=[['sunLat',10],['sunLon',10],['moonLat',10],['moonLon',10],['moonFraction',8],['moonPhase',8],['sunDistance',4],['moonDistance',8]];
export const SEGMENT_BYTES=4+4*SERIES.reduce((n,[,k])=>n+k,0);

const wrap=l=>((l+540)%360)-180;
// The exact values Astronomy Engine gives, for fitting.
function exact(t){
  const date=new Date(t),out={};
  for(const [key,body] of [['sun',Body.Sun],['moon',Body.Moon]]){
    const eq=EquatorFromVector(RotateVector(Rotation_EQJ_EQD(date),GeoVector(body,date,true)));
    out[key+'Lat']=eq.dec;out[key+'Lon']=wrap((eq.ra-SiderealTime(date))*15);out[key+'Distance']=eq.dist*149597870.7;
  }
  out.moonFraction=Illumination(Body.Moon,date).phase_fraction;out.moonPhase=MoonPhase(date);
  return out;
}
// Chebyshev coefficients from samples at Chebyshev nodes, rounded to f32.
function fit(values,n,m){
  const c=[];
  for(let j=0;j<n;j++){let s=0;for(let k=0;k<m;k++)s+=values[k]*Math.cos(j*Math.PI*(k+.5)/m);c.push(s*2/m);}
  c[0]/=2;return c.map(Math.fround);
}
export function fitSegment(day){
  const m=24,start=day*DAY,nodes=[];
  for(let k=0;k<m;k++){const u=Math.cos(Math.PI*(k+.5)/m);nodes.push({k,u,v:exact(start+(u+1)/2*DAY)});}
  // Unwrap the angles in time order (nodes are at most 2.5 hours apart, well
  // under half a turn for either body).
  const inTime=[...nodes].sort((a,b)=>a.u-b.u);
  for(const key of ['sunLon','moonLon','moonPhase'])for(let i=1;i<inTime.length;i++){
    const a=inTime[i-1].v[key];let b=inTime[i].v[key];while(b-a>180)b-=360;while(b-a<-180)b+=360;inTime[i].v[key]=b;
  }
  const seg={day};
  for(const [key,n] of SERIES)seg[key]=fit(nodes.map(q=>q.v[key]),n,m);
  return seg;
}
// Clenshaw's recurrence, in this order (the C evaluator follows it exactly).
export function chebyshev(c,u){
  let b1=0,b2=0;
  for(let j=c.length-1;j>=1;j--){const t=2*u*b1-b2+c[j];b2=b1;b1=t;}
  return u*b1-b2+c[0];
}
// u for a time in whole seconds within the segment's day.
export const dayU=(seg,seconds)=>(seconds-seg.day*86400)/43200-1;

export function encodeSegment(seg){
  const bytes=new Uint8Array(SEGMENT_BYTES),view=new DataView(bytes.buffer);let o=0;
  view.setInt32(o,seg.day,true);o+=4;
  for(const [key] of SERIES)for(const v of seg[key]){view.setFloat32(o,v,true);o+=4;}
  return bytes;
}
export function decodeSegment(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let o=0;const seg={day:view.getInt32(0,true)};o=4;
  for(const [key,n] of SERIES){seg[key]=[];for(let j=0;j<n;j++){seg[key].push(view.getFloat32(o,true));o+=4;}}
  return seg;
}

// Segments are fitted on first use and kept.
const cache=new Map();
export function segmentFor(t){
  const day=Math.floor(t/DAY);
  let seg=cache.get(day);
  if(!seg){seg=fitSegment(day);cache.set(day,seg);if(cache.size>64)cache.delete(cache.keys().next().value);}
  return seg;
}
// A body's position at t (milliseconds; whole seconds are what the watch
// can ask for, and all it is ever asked for).
export function segmentPosition(body,t){
  const seg=segmentFor(t),u=dayU(seg,Math.floor(t/1000)),lat=chebyshev(seg[body+'Lat'],u),lon=wrap(chebyshev(seg[body+'Lon'],u));
  return {lat,lon,distance:chebyshev(seg[body+'Distance'],u)};
}
export function segmentMoonLight(t){
  const seg=segmentFor(t),u=dayU(seg,Math.floor(t/1000)),phase=chebyshev(seg.moonPhase,u);
  return {fraction:chebyshev(seg.moonFraction,u),waxing:((phase%360)+360)%360<180};
}

// Satellites the same way: their SGP4 positions from the phone's element
// set as segments, which the browser draws from too, so the watch and the
// browser agree to the bit. A segment spans an hour for a low orbit (a
// period under 225 minutes, SGP4's own boundary) and six hours otherwise,
// with the sub-satellite latitude and unwrapped longitude (14 terms each)
// and the altitude in km (8). SGP4's geodetic latitude is itself only good to
// about 5e-5°; the segments are within about 0.03° of it for the ISS and
// 0.005° for GPS, a small fraction of a pixel on their charts.
export const SAT_SERIES=[['lat',14],['lon',14],['altitude',8]];
export const SAT_SEGMENT_BYTES=12+4*SAT_SERIES.reduce((n,[,k])=>n+k,0);
export function satelliteSpan(body){return 2*Math.PI/elementsFor(body).satrec.no<225?3600:21600;}
export function fitSatelliteSegment(body,start,span){
  const m=22,nodes=[];
  for(let k=0;k<m;k++){const u=Math.cos(Math.PI*(k+.5)/m),p=propagatePosition(body,(start+(u+1)/2*span)*1000);nodes.push({u,v:{lat:p.lat,lon:p.lon,altitude:p.altitude}});}
  const inTime=[...nodes].sort((a,b)=>a.u-b.u);
  for(let i=1;i<inTime.length;i++){const a=inTime[i-1].v.lon;let b=inTime[i].v.lon;while(b-a>180)b-=360;while(b-a<-180)b+=360;inTime[i].v.lon=b;}
  const seg={body,start,span,epoch:elementsFor(body).epoch};
  for(const [key,n] of SAT_SERIES)seg[key]=fit(nodes.map(q=>q.v[key]),n,m);
  return seg;
}
export function encodeSatelliteSegment(seg){
  const bytes=new Uint8Array(SAT_SEGMENT_BYTES),view=new DataView(bytes.buffer);let o=0;
  view.setInt32(o,Number(seg.body.slice(4)),true);view.setInt32(o+4,seg.start,true);view.setInt32(o+8,seg.span,true);o=12;
  for(const [key] of SAT_SERIES)for(const v of seg[key]){view.setFloat32(o,v,true);o+=4;}
  return bytes;
}
const satellites=new Map();
export function satelliteSegmentFor(body,t){
  const span=satelliteSpan(body),start=Math.floor(t/1000/span)*span,key=`${body}/${elementsFor(body).epoch}/${start}`;
  let seg=satellites.get(key);
  if(!seg){seg=fitSatelliteSegment(body,start,span);satellites.set(key,seg);if(satellites.size>512)satellites.delete(satellites.keys().next().value);}
  return seg;
}
// A satellite's position at t (milliseconds, whole seconds as the watch
// asks), refused more than three days from its elements' epoch, as SGP4's.
export function satelliteSegmentPosition(body,t){
  const e=elementsFor(body);if(!e)throw new RangeError(`No elements loaded for ${body}`);
  if(Math.abs(t-e.epoch)>FRESH)throw new RangeError(`Elements for ${e.catalog?.code||body} are more than three days from this time`);
  const seg=satelliteSegmentFor(body,t),u=(Math.floor(t/1000)-seg.start)/(seg.span/2)-1;
  return {lat:chebyshev(seg.lat,u),lon:wrap(chebyshev(seg.lon,u)),altitude:chebyshev(seg.altitude,u)};
}
