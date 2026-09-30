// The home station: the wearer's own place, drawn on the chart as one more
// station of the network. From it come the day's rise and set of the Sun or
// Moon, and the next pass of a satellite overhead.
import {Body,Observer,SearchRiseSet} from 'astronomy-engine';
import {position,MINUTE} from './ephemeris.js';
import {direction,dot,RAD} from './geometry.js';
import {elementsFor} from './satellites.js';

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

// Passes over home in the next day, sampled every 20 seconds: the first
// minute in view (AOS), the last (LOS) and the greatest elevation. A
// satellite's elements only reach so far, so the search stops where they do.
const passCache=new Map();
export function passes(body,home,from,span=24*60*MINUTE){
  // New elements for the same satellite start a fresh search.
  const key=`${body}/${elementsFor(body)?.epoch??''}/${home.lat}/${home.lon}`,hit=passCache.get(key);
  if(hit&&from>=hit.from&&from<=hit.from+span/2)return hit.list;
  const list=[],step=MINUTE/3;let open=null;
  for(let t=from;t<=from+span;t+=step){
    let p;try{p=position(body,t);}catch{break;}
    const el=elevation(home,p);
    if(el>=PASS_MASK){if(!open)open={aos:t,los:t,peak:el};open.los=t;open.peak=Math.max(open.peak,el);}
    else if(open){list.push(open);open=null;}
  }
  if(open)list.push({...open,open:true});
  passCache.set(key,{from,list});if(passCache.size>16)passCache.delete(passCache.keys().next().value);
  return list;
}
// The pass in progress at epoch, or the next one after it.
export const nextPass=(body,home,epoch)=>passes(body,home,epoch).find(p=>p.los>=epoch)||null;
