// The home station: the wearer's own place, drawn on the chart as one more
// station of the network. From it come the day's rise and set of the Sun or
// Moon, and the next pass of a satellite overhead.
import {Body,Observer,SearchRiseSet} from 'astronomy-engine';
import {position,MINUTE} from './ephemeris.js';
import {direction,dot,RAD} from './geometry.js';
import {elementsFor} from './satellites.js';
import {clockParts} from './render.js';

const EARTH=6371;
// A pass counts from 10° above the horizon, where a satellite clears
// buildings and trees and is worth looking up for.
export const PASS_MASK=10;
// Preset homes, one for each clock zone of the study.
export const HOMES={
  'America/New_York':{code:'HOM',name:'New York',lat:40.71,lon:-74.01},
  UTC:{code:'HOM',name:'Greenwich',lat:51.48,lon:0},
  'Europe/London':{code:'HOM',name:'London',lat:51.51,lon:-0.13},
  'Asia/Kolkata':{code:'HOM',name:'Kolkata',lat:22.57,lon:88.36}
};

// The next rise and set of the Sun or Moon within the local day that starts
// at dayStart. Either may be missing in polar summer or winter, and the
// Moon skips one rise or set about once a month.
const riseSets=new Map();
export function riseSet(body,home,dayStart){
  const key=`${body}/${home.lat}/${home.lon}/${dayStart}`;
  if(!riseSets.has(key)){
    const target=body==='sun'?Body.Sun:Body.Moon,observer=new Observer(home.lat,home.lon,0),from=new Date(dayStart);
    const find=d=>{const t=SearchRiseSet(target,observer,d,from,1);return t&&t.date.getTime()<dayStart+24*3600000?t.date.getTime():null;};
    riseSets.set(key,{rise:find(1),set:find(-1)});
    if(riseSets.size>64)riseSets.delete(riseSets.keys().next().value);
  }
  return riseSets.get(key);
}

// Elevation of a sub-point at altitude, seen from home, in degrees.
export function elevation(home,p){
  const h=direction(home.lat,home.lon),r=EARTH+p.altitude,s=p.dir.map((v,k)=>v*r-h[k]*EARTH),d=Math.hypot(...s);
  return Math.asin(dot(s,h)/d)/RAD;
}
// Ground range, in degrees of arc, within which a satellite at altitude
// stands above the pass mask: its acquisition circle for home.
export function reach(altitude,mask=PASS_MASK){
  const m=mask*RAD;return (Math.acos(EARTH*Math.cos(m)/(EARTH+altitude))-m)/RAD;
}

// Passes over home, sampled every 20 seconds on the clock's own 20-second
// marks: the first sample in view (AOS), the last (LOS) and the greatest
// elevation. The search runs over fixed blocks, each twelve hours from
// midnight UTC and searched 36 hours ahead, so the same moment always gets
// the same answer, whoever asks and whatever was asked before; the phone
// sends the watch these same lists. A satellite's elements only reach so
// far, so a search stops where they do.
export const PASS_BLOCK=12*60*MINUTE,PASS_SPAN=36*60*MINUTE,PASS_AHEAD=24*60*MINUTE;
const passCache=new Map();
export function passes(body,home,from){
  const block=Math.floor(from/PASS_BLOCK)*PASS_BLOCK;
  // New elements for the same satellite start a fresh search.
  const key=`${body}/${elementsFor(body)?.epoch??''}/${home.lat}/${home.lon}/${block}`,hit=passCache.get(key);
  if(hit)return hit;
  const list=[],step=MINUTE/3;let open=null;
  for(let t=block;t<=block+PASS_SPAN;t+=step){
    let p;try{p=position(body,t);}catch{break;}
    const el=elevation(home,p);
    if(el>=PASS_MASK){if(!open)open={aos:t,los:t,peak:el};open.los=t;open.peak=Math.max(open.peak,el);}
    else if(open){list.push(open);open=null;}
  }
  if(open)list.push({...open,open:true});
  passCache.set(key,list);if(passCache.size>16)passCache.delete(passCache.keys().next().value);
  return list;
}
// The pass in progress at epoch, or the next one rising within a day.
export const nextPass=(body,home,epoch)=>passes(body,home,epoch).find(p=>p.los>=epoch&&p.aos<=epoch+PASS_AHEAD)||null;

// A block's passes for the watch, as the phone sends them: the block's first
// second (i32), its count (u8), then per pass AOS and LOS in Unix seconds
// (i32 each), the greatest elevation rounded to a degree (i16), and AOS and
// LOS as minutes of the local day (u16 each), as passText sets them.
export const PASS_BYTES=14;
export function encodePassBlock(body,home,block,timeZone){
  const list=passes(body,home,block),bytes=new Uint8Array(5+PASS_BYTES*list.length),view=new DataView(bytes.buffer);
  view.setInt32(0,block/1000,true);view.setUint8(4,list.length);
  const minutes=t=>{const q=clockParts(t,timeZone);return Number(q.h)*60+Number(q.m);};
  list.forEach((p,i)=>{const o=5+PASS_BYTES*i;view.setInt32(o,p.aos/1000,true);view.setInt32(o+4,p.los/1000,true);view.setInt16(o+8,Math.round(p.peak),true);view.setUint16(o+10,minutes(p.aos),true);view.setUint16(o+12,minutes(p.los),true);});
  return bytes;
}
